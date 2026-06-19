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
import {
  AdsrEnvelopeConfig,
  OscillatorConfig
} from '../../shared/models/audio-engine.models';

const BASE_MIDI = 48;
const LOOP_BEATS = 16;
const SCHEDULER_INTERVAL_MS = 25;
const SCHEDULE_HORIZON_SECONDS = 0.15;
const TRANSPORT_START_DELAY_SECONDS = 0.1;
const NOTE_VELOCITY = 0.95;
const NOTE_GATE_RATIO = 0.95;
const MIN_EVENT_BEATS = 0.1;
const OCTAVE_MIN = -2;
const OCTAVE_MAX = 2;
const GLIDE_SECONDS = 0.11;
const KEY_GLITCH_STRENGTH = 0.9;
const MORPH_GLITCH_STRENGTH = 0.55;
const LOOP_GLITCH_STRENGTH = 0.5;
const CONTROL_GLITCH_STRENGTH = 0.4;

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;

const MODES = ['BASS', 'LEAD', 'CHORD', 'DRUMS'] as const;
type GrooveboxMode = (typeof MODES)[number];

type DpadDirection = 'up' | 'down' | 'left' | 'right';

const ARROW_TO_DIRECTION = new Map<string, DpadDirection>([
  ['ArrowUp', 'up'],
  ['ArrowDown', 'down'],
  ['ArrowLeft', 'left'],
  ['ArrowRight', 'right']
]);

interface ChordShape {
  readonly label: string;
  readonly steps: readonly number[];
}

const CHORD_NOTE: ChordShape = { label: 'NOTE', steps: [0] };
const CHORD_7: ChordShape = { label: '7TH', steps: [0, 2, 4, 6] };
const CHORD_6: ChordShape = { label: '6TH', steps: [0, 2, 4, 5] };
const CHORD_SUS4: ChordShape = { label: 'SUS4', steps: [0, 3, 4] };
const CHORD_ADD9: ChordShape = { label: 'ADD9', steps: [0, 2, 4, 8] };
const CHORD_9: ChordShape = { label: '9TH', steps: [0, 2, 4, 6, 8] };
const CHORD_69: ChordShape = { label: '6/9', steps: [0, 2, 4, 5, 8] };
const CHORD_11: ChordShape = { label: '11TH', steps: [0, 2, 4, 6, 8, 10] };
const CHORD_7SUS4: ChordShape = { label: '7SUS4', steps: [0, 3, 4, 6] };

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

interface ModePatch {
  readonly oscA: Partial<Omit<OscillatorConfig, 'id'>>;
  readonly oscB: Partial<Omit<OscillatorConfig, 'id'>>;
  readonly oscC: Partial<Omit<OscillatorConfig, 'id'>>;
  readonly envelope: AdsrEnvelopeConfig;
}

const MODE_PATCHES: Record<GrooveboxMode, ModePatch> = {
  BASS: {
    oscA: { waveform: 'sine', detuneCents: 0, octaveShift: -1, gain: 0.6, enabled: true },
    oscB: { waveform: 'triangle', detuneCents: 0, octaveShift: -2, gain: 0.4, enabled: true },
    oscC: { waveform: 'square', detuneCents: 0, octaveShift: 0, gain: 0, enabled: false },
    envelope: { attackSeconds: 0.025, decaySeconds: 0.2, sustainLevel: 0.65, releaseSeconds: 0.5 }
  },
  LEAD: {
    oscA: { waveform: 'sawtooth', detuneCents: -6, octaveShift: 0, gain: 0.5, enabled: true },
    oscB: { waveform: 'sawtooth', detuneCents: 6, octaveShift: 0, gain: 0.5, enabled: true },
    oscC: { waveform: 'square', detuneCents: 0, octaveShift: 1, gain: 0.22, enabled: true },
    envelope: { attackSeconds: 0.045, decaySeconds: 0.28, sustainLevel: 0.78, releaseSeconds: 0.6 }
  },
  CHORD: {
    oscA: { waveform: 'sawtooth', detuneCents: -9, octaveShift: 0, gain: 0.4, enabled: true },
    oscB: { waveform: 'sawtooth', detuneCents: 9, octaveShift: 0, gain: 0.4, enabled: true },
    oscC: { waveform: 'triangle', detuneCents: 0, octaveShift: -1, gain: 0.35, enabled: true },
    envelope: { attackSeconds: 0.14, decaySeconds: 0.45, sustainLevel: 0.88, releaseSeconds: 1.0 }
  },
  DRUMS: {
    oscA: { waveform: 'square', detuneCents: 0, octaveShift: 0, gain: 0.5, enabled: true },
    oscB: { waveform: 'sine', detuneCents: 0, octaveShift: 1, gain: 0.3, enabled: true },
    oscC: { waveform: 'square', detuneCents: 0, octaveShift: 0, gain: 0, enabled: false },
    envelope: { attackSeconds: 0.004, decaySeconds: 0.16, sustainLevel: 0.0001, releaseSeconds: 0.16 }
  }
};

type LooperState = 'stopped' | 'recording' | 'playing' | 'overdub';

interface LooperEvent {
  readonly id: string;
  readonly degreeIndex: number;
  readonly steps: readonly number[];
  readonly startBeat: number;
  readonly durationBeats: number;
  readonly velocity: number;
}

interface PendingRecord {
  readonly degreeIndex: number;
  readonly steps: readonly number[];
  readonly startAbsoluteBeat: number;
  readonly startLoopBeat: number;
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

  protected readonly modeIndex = signal(2);
  protected readonly scaleIndex = signal(5);
  protected readonly rootIndex = signal(0);
  protected readonly octaveOffset = signal(0);
  protected readonly holdEnabled = signal(false);
  protected readonly activeDirections = signal<ReadonlySet<DpadDirection>>(new Set());
  protected readonly pressedDegrees = signal<ReadonlySet<number>>(new Set());
  protected readonly litControls = signal<ReadonlySet<ControlId>>(new Set());
  protected readonly looperState = signal<LooperState>('stopped');
  protected readonly looperEvents = signal<readonly LooperEvent[]>([]);

  private activePad: number | null = null;
  private soundingNotes: number[] = [];
  private readonly heldStack: number[] = [];
  private pendingRecord: PendingRecord | null = null;
  private patchApplied = false;
  private loopStartContextTime = 0;
  private scheduledUntilBeat = 0;
  private schedulerId: number | null = null;

  protected readonly mode = computed(() => MODES[this.modeIndex()]);
  protected readonly scale = computed(() => SCALES[this.scaleIndex()]);
  protected readonly rootName = computed(() => NOTE_NAMES[this.rootIndex()]);

  protected readonly chordShape = computed(() => this.resolveChord(this.activeDirections()));
  protected readonly chordReadout = computed(() => this.chordShape().label);

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
    return Array.from({ length: DEGREE_SHORTCUTS.length }, (_, degreeIndex) =>
      this.noteLabel(this.degreeStepMidi(degreeIndex))
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
    const direction = ARROW_TO_DIRECTION.get(event.key);
    if (direction !== undefined) {
      event.preventDefault();
      this.engageDirection(direction);
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
    const direction = ARROW_TO_DIRECTION.get(event.key);
    if (direction !== undefined) {
      this.disengageDirection(direction);
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

  protected isDirectionActive(direction: DpadDirection): boolean {
    return this.activeDirections().has(direction);
  }

  protected isComboActive(first: DpadDirection, second: DpadDirection): boolean {
    const directions = this.activeDirections();
    return directions.has(first) && directions.has(second);
  }

  protected shiftRoot(delta: number): void {
    this.rootIndex.update(
      (index) => (index + delta + NOTE_NAMES.length) % NOTE_NAMES.length
    );
    this.refreshChordVoices();
    this.visualEngine.triggerImpact(CONTROL_GLITCH_STRENGTH);
  }

  protected cycleScale(delta: number): void {
    this.scaleIndex.update((index) => (index + delta + SCALES.length) % SCALES.length);
    this.refreshChordVoices();
    this.visualEngine.triggerImpact(CONTROL_GLITCH_STRENGTH);
  }

  protected nudgeOctave(delta: number): void {
    this.octaveOffset.update((offset) =>
      Math.min(OCTAVE_MAX, Math.max(OCTAVE_MIN, offset + delta))
    );
    this.refreshChordVoices();
    this.visualEngine.triggerImpact(CONTROL_GLITCH_STRENGTH);
  }

  protected cycleMode(): void {
    this.modeIndex.update((index) => (index + 1) % MODES.length);
    this.applyModePatch();
    this.visualEngine.triggerImpact(CONTROL_GLITCH_STRENGTH);
  }

  protected toggleHold(): void {
    const enabling = !this.holdEnabled();
    this.holdEnabled.set(enabling);
    if (!enabling && this.activePad !== null && !this.pressedDegrees().has(this.activePad)) {
      this.finalizePending();
      this.stopSoundingAudio();
      this.activePad = null;
    }
  }

  protected async toggleLooper(): Promise<void> {
    const state = this.looperState();
    if (state === 'stopped') {
      await this.ensureAudio();
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
    this.pendingRecord = null;
    this.looperState.set('stopped');
  }

  protected onArrowPointerDown(event: PointerEvent, direction: DpadDirection): void {
    event.preventDefault();
    this.engageDirection(direction);
  }

  protected onArrowPointerUp(direction: DpadDirection): void {
    this.disengageDirection(direction);
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
    this.finalizePending();
    this.stopSoundingAudio();
    this.activePad = null;
    this.audioEngine.allNotesOff();
    this.visualEngine.dispose();
  }

  private engageDirection(direction: DpadDirection): void {
    if (this.activeDirections().has(direction)) {
      return;
    }
    this.activeDirections.update((directions) => {
      const next = new Set(directions);
      next.add(direction);
      return next;
    });
    this.refreshChordVoices();
  }

  private disengageDirection(direction: DpadDirection): void {
    if (!this.activeDirections().has(direction)) {
      return;
    }
    this.activeDirections.update((directions) => {
      const next = new Set(directions);
      next.delete(direction);
      return next;
    });
    this.refreshChordVoices();
  }

  private resolveChord(directions: ReadonlySet<DpadDirection>): ChordShape {
    const up = directions.has('up');
    const down = directions.has('down');
    const left = directions.has('left');
    const right = directions.has('right');
    if (up && right) {
      return CHORD_9;
    }
    if (down && right) {
      return CHORD_69;
    }
    if (up && left) {
      return CHORD_11;
    }
    if (down && left) {
      return CHORD_7SUS4;
    }
    if (up) {
      return CHORD_7;
    }
    if (down) {
      return CHORD_6;
    }
    if (left) {
      return CHORD_SUS4;
    }
    if (right) {
      return CHORD_ADD9;
    }
    return CHORD_NOTE;
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

  private async ensureAudio(): Promise<void> {
    this.audioEngine.initialize();
    await this.audioEngine.resume();
    if (!this.patchApplied) {
      this.applyModePatch();
      this.patchApplied = true;
    }
  }

  private applyModePatch(): void {
    const preset = MODE_PATCHES[this.mode()];
    this.audioEngine.updateOscillator('osc-a', preset.oscA);
    this.audioEngine.updateOscillator('osc-b', preset.oscB);
    this.audioEngine.updateOscillator('osc-c', preset.oscC);
    this.audioEngine.setEnvelope(preset.envelope);
  }

  private async pressDegree(degreeIndex: number): Promise<void> {
    if (this.pressedDegrees().has(degreeIndex)) {
      return;
    }
    this.pressedDegrees.update((degrees) => {
      const next = new Set(degrees);
      next.add(degreeIndex);
      return next;
    });
    this.heldStack.push(degreeIndex);
    await this.ensureAudio();
    if (!this.pressedDegrees().has(degreeIndex)) {
      return;
    }
    this.activatePad(degreeIndex);
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
    const stackIndex = this.heldStack.lastIndexOf(degreeIndex);
    if (stackIndex >= 0) {
      this.heldStack.splice(stackIndex, 1);
    }
    if (degreeIndex !== this.activePad) {
      return;
    }
    if (this.heldStack.length > 0) {
      this.activatePad(this.heldStack[this.heldStack.length - 1]);
      return;
    }
    if (this.holdEnabled()) {
      return;
    }
    this.finalizePending();
    this.stopSoundingAudio();
    this.activePad = null;
  }

  private activatePad(degreeIndex: number): void {
    const previousNotes = this.soundingNotes;
    this.finalizePending();
    this.stopSoundingAudio();
    const steps = this.chordShape().steps;
    const target = steps.map((step) => this.degreeStepMidi(degreeIndex + step));
    this.soundingNotes = target;
    this.activePad = degreeIndex;
    for (let index = 0; index < target.length; index += 1) {
      const glideFrom =
        previousNotes.length > 0
          ? previousNotes[Math.min(index, previousNotes.length - 1)]
          : undefined;
      this.audioEngine.noteOn(
        target[index],
        NOTE_VELOCITY,
        undefined,
        glideFrom,
        glideFrom === undefined ? undefined : GLIDE_SECONDS
      );
    }
    this.startPendingRecord(degreeIndex, steps);
    this.visualEngine.triggerImpact(KEY_GLITCH_STRENGTH);
  }

  private refreshChordVoices(): void {
    if (this.activePad === null || this.soundingNotes.length === 0) {
      return;
    }
    const pad = this.activePad;
    const target = this.chordShape().steps.map((step) => this.degreeStepMidi(pad + step));
    const toRemove = this.soundingNotes.filter((note) => !target.includes(note));
    const toAdd = target.filter((note) => !this.soundingNotes.includes(note));
    if (toRemove.length === 0 && toAdd.length === 0) {
      return;
    }
    for (const midiNote of toRemove) {
      this.audioEngine.noteOff(midiNote);
    }
    for (const midiNote of toAdd) {
      this.audioEngine.noteOn(midiNote, NOTE_VELOCITY);
    }
    this.soundingNotes = target;
    this.visualEngine.triggerImpact(MORPH_GLITCH_STRENGTH);
  }

  private stopSoundingAudio(): void {
    for (const midiNote of this.soundingNotes) {
      this.audioEngine.noteOff(midiNote);
    }
    this.soundingNotes = [];
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
      let cycleIndex = Math.ceil((this.scheduledUntilBeat - event.startBeat) / LOOP_BEATS);
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
    const durationSeconds = event.durationBeats * secondsPerBeat * NOTE_GATE_RATIO;
    for (const step of event.steps) {
      this.audioEngine.playNote(
        this.degreeStepMidi(event.degreeIndex + step),
        durationSeconds,
        event.velocity,
        when
      );
    }
    const delayMs = Math.max(0, (when - this.audioEngine.getCurrentTime()) * 1000);
    window.setTimeout(() => {
      if (this.looperState() !== 'stopped') {
        this.visualEngine.triggerImpact(LOOP_GLITCH_STRENGTH);
      }
    }, delayMs);
  }

  private startPendingRecord(degreeIndex: number, steps: readonly number[]): void {
    if (!this.isRecordingState()) {
      return;
    }
    this.pendingRecord = {
      degreeIndex,
      steps: [...steps],
      startAbsoluteBeat: this.currentAbsoluteBeat(),
      startLoopBeat: this.currentLoopBeat()
    };
  }

  private finalizePending(): void {
    const pending = this.pendingRecord;
    this.pendingRecord = null;
    if (pending === null || !this.isRecordingState()) {
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
        degreeIndex: pending.degreeIndex,
        steps: pending.steps,
        startBeat: pending.startLoopBeat,
        durationBeats,
        velocity: NOTE_VELOCITY
      }
    ]);
  }

  private isRecordingState(): boolean {
    const state = this.looperState();
    return state === 'recording' || state === 'overdub';
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

  private degreeStepMidi(step: number): number {
    const intervals = this.scale().intervals;
    return (
      BASE_MIDI +
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
