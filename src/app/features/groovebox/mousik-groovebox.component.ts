import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  OnDestroy,
  afterNextRender,
  computed,
  inject,
  signal,
  viewChild
} from '@angular/core';
import { RouterLink } from '@angular/router';

import { AudioEngineService } from '../../core/services/audio-engine.service';
import { VisualEngineService } from '../../core/services/visual-engine.service';
import { DrumSound } from '../../shared/models/audio-engine.models';

const LOOP_BEATS = 16;
const SCHEDULER_INTERVAL_MS = 25;
const SCHEDULE_HORIZON_SECONDS = 0.15;
const TRANSPORT_START_DELAY_SECONDS = 0.1;
const NOTE_VELOCITY = 0.95;
const NOTE_GATE_RATIO = 0.95;
const DRUM_EVENT_BEATS = 0.25;
const MIN_EVENT_BEATS = 0.1;
const OCTAVE_MIN = -2;
const OCTAVE_MAX = 2;
const KEY_GLITCH_STRENGTH = 0.9;
const LOOP_GLITCH_STRENGTH = 0.5;
const CONTROL_GLITCH_STRENGTH = 0.4;

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;

const MODES = ['BASS', 'LEAD', 'CHORD', 'DRUMS'] as const;
type GrooveboxMode = (typeof MODES)[number];

const MODE_BASE_MIDI: Record<GrooveboxMode, number> = {
  BASS: 36,
  LEAD: 72,
  CHORD: 48,
  DRUMS: 0
};

type ChordExtension = 'maj7' | 'min7' | 'sixth' | 'add9';

const EXTENSION_ADDED_INTERVALS: Record<ChordExtension, number> = {
  maj7: 11,
  min7: 10,
  sixth: 9,
  add9: 14
};

const EXTENSION_LABELS: Record<ChordExtension, string> = {
  maj7: 'MAJ7',
  min7: 'm7',
  sixth: '6',
  add9: 'ADD9'
};

const ARROW_TO_EXTENSION = new Map<string, ChordExtension>([
  ['ArrowUp', 'maj7'],
  ['ArrowDown', 'min7'],
  ['ArrowLeft', 'sixth'],
  ['ArrowRight', 'add9']
]);

const KEY_TO_DEGREE = new Map<string, number>([
  ['a', 0],
  ['s', 1],
  ['d', 2],
  ['f', 3],
  ['w', 4],
  ['e', 5],
  ['r', 6]
]);

const DEGREE_SHORTCUTS = ['A', 'S', 'D', 'F', 'W', 'E', 'R'] as const;
const DEGREE_NUMERALS = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'] as const;
const LOWER_ROW_DEGREES = [0, 1, 2, 3] as const;
const UPPER_ROW_DEGREES = [4, 5, 6] as const;

type ControlId =
  | 'rootDown'
  | 'rootUp'
  | 'scaleDown'
  | 'scaleUp'
  | 'octaveDown'
  | 'octaveUp'
  | 'mode'
  | 'hold'
  | 'looper'
  | 'clear';

const KEY_TO_CONTROL = new Map<string, ControlId>([
  ['z', 'rootDown'],
  ['x', 'rootUp'],
  ['c', 'scaleDown'],
  ['v', 'scaleUp'],
  ['n', 'octaveDown'],
  ['m', 'octaveUp'],
  ['b', 'mode'],
  ['h', 'hold']
]);

interface ScaleDefinition {
  readonly name: string;
  readonly intervals: readonly number[];
}

const SCALES: readonly ScaleDefinition[] = [
  { name: 'MAJOR', intervals: [0, 2, 4, 5, 7, 9, 11] },
  { name: 'DORIAN', intervals: [0, 2, 3, 5, 7, 9, 10] },
  { name: 'PHRYGIAN', intervals: [0, 1, 3, 5, 7, 8, 10] },
  { name: 'LYDIAN', intervals: [0, 2, 4, 6, 7, 9, 11] },
  { name: 'MIXOLYDIAN', intervals: [0, 2, 4, 5, 7, 9, 10] },
  { name: 'MINOR', intervals: [0, 2, 3, 5, 7, 8, 10] },
  { name: 'LOCRIAN', intervals: [0, 1, 3, 5, 6, 8, 10] }
];

const DRUM_PADS: readonly { readonly sound: DrumSound; readonly label: string }[] = [
  { sound: 'kick', label: 'KCK' },
  { sound: 'snare', label: 'SNR' },
  { sound: 'clap', label: 'CLP' },
  { sound: 'hat-closed', label: 'CHH' },
  { sound: 'hat-open', label: 'OHH' },
  { sound: 'tom-low', label: 'TOM' },
  { sound: 'cymbal', label: 'CYM' }
];

type LooperState = 'stopped' | 'recording' | 'playing' | 'overdub';

interface LooperEvent {
  readonly id: string;
  readonly degreeIndex: number;
  readonly mode: GrooveboxMode;
  readonly extension: ChordExtension | null;
  readonly startBeat: number;
  readonly durationBeats: number;
  readonly velocity: number;
}

interface PendingRecord {
  readonly startAbsoluteBeat: number;
  readonly startLoopBeat: number;
  readonly mode: GrooveboxMode;
  readonly extension: ChordExtension | null;
}

@Component({
  selector: 'mousik-groovebox',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  templateUrl: './mousik-groovebox.component.html',
  styleUrl: './mousik-groovebox.component.scss'
})
export class MousikGrooveboxComponent implements OnDestroy {
  protected readonly audioEngine = inject(AudioEngineService);
  protected readonly visualEngine = inject(VisualEngineService);

  private readonly backdropCanvas =
    viewChild.required<ElementRef<HTMLCanvasElement>>('backdropCanvas');

  protected readonly upperRowDegrees = UPPER_ROW_DEGREES;
  protected readonly lowerRowDegrees = LOWER_ROW_DEGREES;
  protected readonly degreeShortcuts = DEGREE_SHORTCUTS;
  protected readonly degreeNumerals = DEGREE_NUMERALS;

  protected readonly modeIndex = signal(0);
  protected readonly scaleIndex = signal(5);
  protected readonly rootIndex = signal(0);
  protected readonly octaveOffset = signal(0);
  protected readonly holdEnabled = signal(false);
  protected readonly heldExtensions = signal<readonly ChordExtension[]>([]);
  protected readonly pressedDegrees = signal<ReadonlySet<number>>(new Set());
  protected readonly litControls = signal<ReadonlySet<ControlId>>(new Set());
  protected readonly looperState = signal<LooperState>('stopped');
  protected readonly looperEvents = signal<readonly LooperEvent[]>([]);

  private readonly heldNotesByDegree = new Map<number, readonly number[]>();
  private readonly pendingRecords = new Map<number, PendingRecord>();
  private latchedNotes: readonly number[] = [];
  private loopStartContextTime = 0;
  private scheduledUntilBeat = 0;
  private schedulerId: number | null = null;

  protected readonly mode = computed(() => MODES[this.modeIndex()]);
  protected readonly scale = computed(() => SCALES[this.scaleIndex()]);
  protected readonly rootName = computed(() => NOTE_NAMES[this.rootIndex()]);

  protected readonly activeExtension = computed<ChordExtension | null>(() => {
    const extensions = this.heldExtensions();
    return extensions.length > 0 ? extensions[extensions.length - 1] : null;
  });

  protected readonly extensionReadout = computed(() => {
    if (this.mode() !== 'CHORD') {
      return '--';
    }
    const extension = this.activeExtension();
    return extension === null ? 'TRIAD' : EXTENSION_LABELS[extension];
  });

  protected readonly octaveReadout = computed(() => {
    const offset = this.octaveOffset();
    return offset > 0 ? `+${offset}` : `${offset}`;
  });

  protected readonly looperReadout = computed(() => {
    const state = this.looperState();
    if (state === 'recording') {
      return 'REC';
    }
    if (state === 'overdub') {
      return 'DUB';
    }
    return state === 'playing' ? 'PLAY' : 'STOP';
  });

  protected readonly contextReadout = computed(() =>
    this.audioEngine.isRunning() ? 'RUN' : 'HALT'
  );

  protected readonly padLabels = computed(() => {
    this.rootIndex();
    this.scaleIndex();
    this.octaveOffset();
    if (this.mode() === 'DRUMS') {
      return DRUM_PADS.map((pad) => pad.label);
    }
    return Array.from({ length: DEGREE_SHORTCUTS.length }, (_, degreeIndex) =>
      this.noteLabel(this.degreeStepMidi(this.mode(), degreeIndex))
    );
  });

  constructor() {
    afterNextRender(() => {
      this.visualEngine.initialize(this.backdropCanvas().nativeElement);
      this.visualEngine.startRenderLoop();
    });
  }

  @HostListener('window:keydown', ['$event'])
  onKeyDown(event: KeyboardEvent): void {
    if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) {
      return;
    }
    if (event.code === 'Space') {
      event.preventDefault();
      this.markControl('looper');
      void this.toggleLooper();
      return;
    }
    if (event.key === 'Backspace') {
      event.preventDefault();
      this.markControl('clear');
      this.clearLooper();
      return;
    }
    const extension = ARROW_TO_EXTENSION.get(event.key);
    if (extension !== undefined) {
      event.preventDefault();
      if (this.mode() === 'CHORD') {
        this.engageExtension(extension);
      }
      return;
    }
    const lowerKey = event.key.toLowerCase();
    const controlId = KEY_TO_CONTROL.get(lowerKey);
    if (controlId !== undefined) {
      event.preventDefault();
      this.markControl(controlId);
      this.applyControl(controlId);
      return;
    }
    const degreeIndex = KEY_TO_DEGREE.get(lowerKey);
    if (degreeIndex === undefined) {
      return;
    }
    event.preventDefault();
    void this.pressDegree(degreeIndex);
  }

  @HostListener('window:keyup', ['$event'])
  onKeyUp(event: KeyboardEvent): void {
    if (event.code === 'Space') {
      this.unmarkControl('looper');
      return;
    }
    if (event.key === 'Backspace') {
      this.unmarkControl('clear');
      return;
    }
    const extension = ARROW_TO_EXTENSION.get(event.key);
    if (extension !== undefined) {
      this.disengageExtension(extension);
      return;
    }
    const lowerKey = event.key.toLowerCase();
    const controlId = KEY_TO_CONTROL.get(lowerKey);
    if (controlId !== undefined) {
      this.unmarkControl(controlId);
      return;
    }
    const degreeIndex = KEY_TO_DEGREE.get(lowerKey);
    if (degreeIndex === undefined) {
      return;
    }
    this.releaseDegree(degreeIndex);
  }

  protected isControlLit(controlId: ControlId): boolean {
    return this.litControls().has(controlId);
  }

  protected shiftRoot(delta: number): void {
    this.rootIndex.update(
      (index) => (index + delta + NOTE_NAMES.length) % NOTE_NAMES.length
    );
    this.visualEngine.triggerImpact(CONTROL_GLITCH_STRENGTH);
  }

  protected cycleScale(delta: number): void {
    this.scaleIndex.update((index) => (index + delta + SCALES.length) % SCALES.length);
    this.visualEngine.triggerImpact(CONTROL_GLITCH_STRENGTH);
  }

  protected nudgeOctave(delta: number): void {
    this.octaveOffset.update((offset) =>
      Math.min(OCTAVE_MAX, Math.max(OCTAVE_MIN, offset + delta))
    );
    this.visualEngine.triggerImpact(CONTROL_GLITCH_STRENGTH);
  }

  protected cycleMode(): void {
    this.releaseAllDegrees();
    this.heldExtensions.set([]);
    this.modeIndex.update((index) => (index + 1) % MODES.length);
    this.visualEngine.triggerImpact(CONTROL_GLITCH_STRENGTH);
  }

  protected toggleHold(): void {
    const enabling = !this.holdEnabled();
    this.holdEnabled.set(enabling);
    if (!enabling) {
      this.releaseLatchedNotes();
    }
  }

  protected async toggleLooper(): Promise<void> {
    const state = this.looperState();
    if (state === 'stopped') {
      this.audioEngine.initialize();
      await this.audioEngine.resume();
      this.startTransport();
      this.looperState.set('recording');
      return;
    }
    if (state === 'recording') {
      this.looperState.set('playing');
      return;
    }
    this.looperState.set(state === 'playing' ? 'overdub' : 'playing');
  }

  protected clearLooper(): void {
    this.stopTransport();
    this.looperEvents.set([]);
    this.pendingRecords.clear();
    this.looperState.set('stopped');
  }

  protected onDpadPress(extension: ChordExtension): void {
    if (this.mode() === 'CHORD') {
      this.engageExtension(extension);
    }
  }

  protected onDpadRelease(extension: ChordExtension): void {
    this.disengageExtension(extension);
  }

  protected isExtensionLit(extension: ChordExtension): boolean {
    return this.mode() === 'CHORD' && this.heldExtensions().includes(extension);
  }

  protected onPadPointerDown(event: PointerEvent, degreeIndex: number): void {
    event.preventDefault();
    void this.pressDegree(degreeIndex);
  }

  protected onPadRelease(degreeIndex: number): void {
    this.releaseDegree(degreeIndex);
  }

  ngOnDestroy(): void {
    this.stopTransport();
    this.releaseAllDegrees();
    this.releaseLatchedNotes();
    this.audioEngine.allNotesOff();
    this.visualEngine.dispose();
  }

  private applyControl(controlId: ControlId): void {
    if (controlId === 'rootDown') {
      this.shiftRoot(-1);
      return;
    }
    if (controlId === 'rootUp') {
      this.shiftRoot(1);
      return;
    }
    if (controlId === 'scaleDown') {
      this.cycleScale(-1);
      return;
    }
    if (controlId === 'scaleUp') {
      this.cycleScale(1);
      return;
    }
    if (controlId === 'octaveDown') {
      this.nudgeOctave(-1);
      return;
    }
    if (controlId === 'octaveUp') {
      this.nudgeOctave(1);
      return;
    }
    if (controlId === 'mode') {
      this.cycleMode();
      return;
    }
    if (controlId === 'hold') {
      this.toggleHold();
    }
  }

  private markControl(controlId: ControlId): void {
    this.litControls.update((controls) => {
      const next = new Set(controls);
      next.add(controlId);
      return next;
    });
  }

  private unmarkControl(controlId: ControlId): void {
    this.litControls.update((controls) => {
      const next = new Set(controls);
      next.delete(controlId);
      return next;
    });
  }

  private startTransport(): void {
    this.loopStartContextTime =
      this.audioEngine.getCurrentTime() + TRANSPORT_START_DELAY_SECONDS;
    this.scheduledUntilBeat = 0;
    this.schedulerId = window.setInterval(
      () => this.scheduleWindow(),
      SCHEDULER_INTERVAL_MS
    );
  }

  private stopTransport(): void {
    if (this.schedulerId !== null) {
      window.clearInterval(this.schedulerId);
      this.schedulerId = null;
    }
  }

  private scheduleWindow(): void {
    if (this.looperState() === 'stopped') {
      return;
    }
    const secondsPerBeat = 60 / this.audioEngine.bpm();
    const now = this.audioEngine.getCurrentTime();
    const horizonBeat =
      (now + SCHEDULE_HORIZON_SECONDS - this.loopStartContextTime) / secondsPerBeat;
    if (horizonBeat <= this.scheduledUntilBeat) {
      return;
    }
    for (const event of this.looperEvents()) {
      let cycleIndex = Math.ceil(
        (this.scheduledUntilBeat - event.startBeat) / LOOP_BEATS
      );
      if (cycleIndex < 0) {
        cycleIndex = 0;
      }
      let absoluteBeat = cycleIndex * LOOP_BEATS + event.startBeat;
      while (absoluteBeat < horizonBeat) {
        if (absoluteBeat >= this.scheduledUntilBeat) {
          this.scheduleEvent(
            event,
            this.loopStartContextTime + absoluteBeat * secondsPerBeat,
            secondsPerBeat
          );
        }
        absoluteBeat += LOOP_BEATS;
      }
    }
    this.scheduledUntilBeat = horizonBeat;
  }

  private scheduleEvent(event: LooperEvent, when: number, secondsPerBeat: number): void {
    if (event.mode === 'DRUMS') {
      this.audioEngine.playDrum(DRUM_PADS[event.degreeIndex].sound, event.velocity, when);
    } else {
      const midiNotes = this.degreeMidiNotes(event.mode, event.degreeIndex, event.extension);
      const durationSeconds = event.durationBeats * secondsPerBeat * NOTE_GATE_RATIO;
      for (const midiNote of midiNotes) {
        this.audioEngine.playNote(midiNote, durationSeconds, event.velocity, when);
      }
    }
    const delayMs = Math.max(0, (when - this.audioEngine.getCurrentTime()) * 1000);
    window.setTimeout(() => {
      if (this.looperState() !== 'stopped') {
        this.visualEngine.triggerImpact(LOOP_GLITCH_STRENGTH);
      }
    }, delayMs);
  }

  private async pressDegree(degreeIndex: number): Promise<void> {
    if (this.pressedDegrees().has(degreeIndex)) {
      return;
    }
    this.audioEngine.initialize();
    await this.audioEngine.resume();

    this.pressedDegrees.update((degrees) => {
      const next = new Set(degrees);
      next.add(degreeIndex);
      return next;
    });
    this.visualEngine.triggerImpact(KEY_GLITCH_STRENGTH);

    const mode = this.mode();
    if (mode === 'DRUMS') {
      this.audioEngine.playDrum(DRUM_PADS[degreeIndex].sound, NOTE_VELOCITY);
      this.recordImmediateEvent(degreeIndex, mode);
      return;
    }

    const extension = mode === 'CHORD' ? this.activeExtension() : null;
    const midiNotes = this.degreeMidiNotes(mode, degreeIndex, extension);
    if (this.holdEnabled()) {
      this.releaseLatchedNotes();
    }
    for (const midiNote of midiNotes) {
      this.audioEngine.noteOn(midiNote, NOTE_VELOCITY);
    }
    this.heldNotesByDegree.set(degreeIndex, midiNotes);
    if (this.holdEnabled()) {
      this.latchedNotes = midiNotes;
    }
    this.startPendingRecord(degreeIndex, mode, extension);
  }

  private releaseDegree(degreeIndex: number): void {
    if (!this.pressedDegrees().has(degreeIndex)) {
      return;
    }
    this.pressedDegrees.update((degrees) => {
      const next = new Set(degrees);
      next.delete(degreeIndex);
      return next;
    });
    this.finalizePendingRecord(degreeIndex);
    const midiNotes = this.heldNotesByDegree.get(degreeIndex);
    this.heldNotesByDegree.delete(degreeIndex);
    if (this.holdEnabled() || midiNotes === undefined) {
      return;
    }
    for (const midiNote of midiNotes) {
      this.audioEngine.noteOff(midiNote);
    }
  }

  private releaseAllDegrees(): void {
    for (const degreeIndex of [...this.pressedDegrees()]) {
      this.releaseDegree(degreeIndex);
    }
  }

  private releaseLatchedNotes(): void {
    for (const midiNote of this.latchedNotes) {
      this.audioEngine.noteOff(midiNote);
    }
    this.latchedNotes = [];
  }

  private isRecordingState(): boolean {
    const state = this.looperState();
    return state === 'recording' || state === 'overdub';
  }

  private recordImmediateEvent(degreeIndex: number, mode: GrooveboxMode): void {
    if (!this.isRecordingState()) {
      return;
    }
    this.looperEvents.update((events) => [
      ...events,
      {
        id: crypto.randomUUID(),
        degreeIndex,
        mode,
        extension: null,
        startBeat: this.currentLoopBeat(),
        durationBeats: DRUM_EVENT_BEATS,
        velocity: NOTE_VELOCITY
      }
    ]);
  }

  private startPendingRecord(
    degreeIndex: number,
    mode: GrooveboxMode,
    extension: ChordExtension | null
  ): void {
    if (!this.isRecordingState()) {
      return;
    }
    this.pendingRecords.set(degreeIndex, {
      startAbsoluteBeat: this.currentAbsoluteBeat(),
      startLoopBeat: this.currentLoopBeat(),
      mode,
      extension
    });
  }

  private finalizePendingRecord(degreeIndex: number): void {
    const pending = this.pendingRecords.get(degreeIndex);
    if (pending === undefined) {
      return;
    }
    this.pendingRecords.delete(degreeIndex);
    if (this.looperState() === 'stopped') {
      return;
    }
    const durationBeats = Math.min(
      LOOP_BEATS,
      Math.max(MIN_EVENT_BEATS, this.currentAbsoluteBeat() - pending.startAbsoluteBeat)
    );
    this.looperEvents.update((events) => [
      ...events,
      {
        id: crypto.randomUUID(),
        degreeIndex,
        mode: pending.mode,
        extension: pending.extension,
        startBeat: pending.startLoopBeat,
        durationBeats,
        velocity: NOTE_VELOCITY
      }
    ]);
  }

  private engageExtension(extension: ChordExtension): void {
    this.heldExtensions.update((extensions) =>
      extensions.includes(extension) ? extensions : [...extensions, extension]
    );
    this.visualEngine.triggerImpact(CONTROL_GLITCH_STRENGTH);
  }

  private disengageExtension(extension: ChordExtension): void {
    this.heldExtensions.update((extensions) =>
      extensions.filter((held) => held !== extension)
    );
  }

  private currentAbsoluteBeat(): number {
    const secondsPerBeat = 60 / this.audioEngine.bpm();
    const beat =
      (this.audioEngine.getCurrentTime() - this.loopStartContextTime) / secondsPerBeat;
    return beat <= 0 ? 0 : beat;
  }

  private currentLoopBeat(): number {
    return this.currentAbsoluteBeat() % LOOP_BEATS;
  }

  private degreeMidiNotes(
    mode: GrooveboxMode,
    degreeIndex: number,
    extension: ChordExtension | null
  ): readonly number[] {
    if (mode !== 'CHORD') {
      return [this.degreeStepMidi(mode, degreeIndex)];
    }
    const midiNotes = [
      this.degreeStepMidi(mode, degreeIndex),
      this.degreeStepMidi(mode, degreeIndex + 2),
      this.degreeStepMidi(mode, degreeIndex + 4)
    ];
    if (extension !== null) {
      midiNotes.push(midiNotes[0] + EXTENSION_ADDED_INTERVALS[extension]);
    }
    return midiNotes;
  }

  private degreeStepMidi(mode: GrooveboxMode, step: number): number {
    const intervals = this.scale().intervals;
    return (
      MODE_BASE_MIDI[mode] +
      this.rootIndex() +
      12 * this.octaveOffset() +
      intervals[step % intervals.length] +
      12 * Math.floor(step / intervals.length)
    );
  }

  private noteLabel(midiNote: number): string {
    return `${NOTE_NAMES[midiNote % 12]}${Math.floor(midiNote / 12) - 1}`;
  }
}
