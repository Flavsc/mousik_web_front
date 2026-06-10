import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  inject,
  viewChild
} from '@angular/core';

import { SequencerService } from '../../core/services/sequencer.service';
import { SequencerNote } from '../../shared/models/audio-engine.models';
import { clamp } from '../../core/audio/music-math';

const TOP_MIDI_NOTE = 72;
const BOTTOM_MIDI_NOTE = 48;
const VELOCITY_WHEEL_STEP = 0.05;
const NOTE_NAMES = [
  'C',
  'C#',
  'D',
  'D#',
  'E',
  'F',
  'F#',
  'G',
  'G#',
  'A',
  'A#',
  'B'
] as const;

interface RollRow {
  readonly midiNote: number;
  readonly label: string;
  readonly isBlackKey: boolean;
}

interface DragState {
  readonly pointerId: number;
  readonly noteId: string;
  readonly mode: 'move' | 'resize';
  readonly grabBeatOffset: number;
}

function buildRows(): readonly RollRow[] {
  const rows: RollRow[] = [];
  for (let midiNote = TOP_MIDI_NOTE; midiNote >= BOTTOM_MIDI_NOTE; midiNote -= 1) {
    const name = NOTE_NAMES[midiNote % 12];
    const octave = Math.floor(midiNote / 12) - 1;
    rows.push({
      midiNote,
      label: `${name}${octave}`,
      isBlackKey: name.includes('#')
    });
  }
  return rows;
}

@Component({
  selector: 'mousik-piano-roll',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './piano-roll.component.html',
  styleUrl: './piano-roll.component.scss'
})
export class PianoRollComponent {
  protected readonly sequencer = inject(SequencerService);

  private readonly gridElement = viewChild.required<ElementRef<HTMLDivElement>>('grid');
  private dragState: DragState | null = null;

  protected readonly rows = buildRows();
  protected readonly rowHeightPercent = 100 / this.rows.length;

  protected readonly playheadPercent = computed(
    () => (this.sequencer.playheadBeat() / this.sequencer.loopBeats) * 100
  );

  protected noteLeftPercent(note: SequencerNote): number {
    return (note.startBeat / this.sequencer.loopBeats) * 100;
  }

  protected noteWidthPercent(note: SequencerNote): number {
    return (note.lengthBeats / this.sequencer.loopBeats) * 100;
  }

  protected noteTopPercent(note: SequencerNote): number {
    return ((TOP_MIDI_NOTE - note.midiNote) / this.rows.length) * 100;
  }

  protected onGridPointerDown(event: PointerEvent): void {
    if (event.button !== 0) {
      return;
    }
    const target = event.target as HTMLElement;
    if (target.closest('.roll__note') !== null) {
      return;
    }
    this.sequencer.addNote(this.midiNoteFromClientY(event.clientY), this.beatFromClientX(event.clientX));
  }

  protected onNotePointerDown(event: PointerEvent, note: SequencerNote, mode: 'move' | 'resize'): void {
    if (event.button !== 0) {
      return;
    }
    event.stopPropagation();
    (event.target as HTMLElement).setPointerCapture(event.pointerId);
    this.dragState = {
      pointerId: event.pointerId,
      noteId: note.id,
      mode,
      grabBeatOffset: this.beatFromClientX(event.clientX) - note.startBeat
    };
  }

  protected onNotePointerMove(event: PointerEvent): void {
    const dragState = this.dragState;
    if (dragState === null || dragState.pointerId !== event.pointerId) {
      return;
    }
    const note = this.sequencer.notes().find((candidate) => candidate.id === dragState.noteId);
    if (note === undefined) {
      return;
    }
    const pointerBeat = this.beatFromClientX(event.clientX);
    if (dragState.mode === 'move') {
      this.sequencer.moveNote(
        note.id,
        this.midiNoteFromClientY(event.clientY),
        pointerBeat - dragState.grabBeatOffset
      );
      return;
    }
    this.sequencer.resizeNote(note.id, pointerBeat - note.startBeat);
  }

  protected onNotePointerUp(event: PointerEvent): void {
    if (this.dragState !== null && this.dragState.pointerId === event.pointerId) {
      this.dragState = null;
    }
  }

  protected onNoteContextMenu(event: MouseEvent, noteId: string): void {
    event.preventDefault();
    event.stopPropagation();
    this.sequencer.removeNote(noteId);
  }

  protected onNoteWheel(event: WheelEvent, note: SequencerNote): void {
    event.preventDefault();
    const direction = event.deltaY < 0 ? 1 : -1;
    this.sequencer.setNoteVelocity(note.id, note.velocity + direction * VELOCITY_WHEEL_STEP);
  }

  protected velocityReadout(note: SequencerNote): string {
    return Math.round(note.velocity * 100).toString();
  }

  private beatFromClientX(clientX: number): number {
    const rect = this.gridElement().nativeElement.getBoundingClientRect();
    const ratio = clamp((clientX - rect.left) / rect.width, 0, 1);
    return ratio * this.sequencer.loopBeats;
  }

  private midiNoteFromClientY(clientY: number): number {
    const rect = this.gridElement().nativeElement.getBoundingClientRect();
    const ratio = clamp((clientY - rect.top) / rect.height, 0, 0.999);
    const rowIndex = Math.floor(ratio * this.rows.length);
    return TOP_MIDI_NOTE - rowIndex;
  }
}
