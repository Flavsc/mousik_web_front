import { Injectable, inject, signal } from '@angular/core';

import { SequencerNote } from '../../shared/models/audio-engine.models';
import { clamp } from '../audio/music-math';
import { AudioEngineService } from './audio-engine.service';
import { VisualEngineService } from './visual-engine.service';

const STEP_BEATS = 0.25;
const LOOP_BEATS = 8;
const SCHEDULER_INTERVAL_MS = 25;
const SCHEDULE_HORIZON_SECONDS = 0.15;
const START_DELAY_SECONDS = 0.1;
const NOTE_GATE_RATIO = 0.95;
const MIN_VELOCITY = 0.05;

const SEED_PATTERN: readonly SequencerNote[] = [
  { id: 'seed-01', midiNote: 48, startBeat: 0, lengthBeats: 0.75, velocity: 1 },
  { id: 'seed-02', midiNote: 48, startBeat: 1.5, lengthBeats: 0.25, velocity: 0.7 },
  { id: 'seed-03', midiNote: 51, startBeat: 2, lengthBeats: 0.75, velocity: 0.9 },
  { id: 'seed-04', midiNote: 48, startBeat: 3.5, lengthBeats: 0.25, velocity: 0.6 },
  { id: 'seed-05', midiNote: 55, startBeat: 4, lengthBeats: 0.75, velocity: 0.95 },
  { id: 'seed-06', midiNote: 53, startBeat: 5.5, lengthBeats: 0.25, velocity: 0.7 },
  { id: 'seed-07', midiNote: 51, startBeat: 6, lengthBeats: 0.5, velocity: 0.85 },
  { id: 'seed-08', midiNote: 50, startBeat: 7, lengthBeats: 1, velocity: 0.75 },
  { id: 'seed-09', midiNote: 60, startBeat: 1, lengthBeats: 0.5, velocity: 0.55 },
  { id: 'seed-10', midiNote: 63, startBeat: 1, lengthBeats: 0.5, velocity: 0.55 },
  { id: 'seed-11', midiNote: 67, startBeat: 1, lengthBeats: 0.5, velocity: 0.55 },
  { id: 'seed-12', midiNote: 60, startBeat: 5, lengthBeats: 0.5, velocity: 0.55 },
  { id: 'seed-13', midiNote: 63, startBeat: 5, lengthBeats: 0.5, velocity: 0.55 },
  { id: 'seed-14', midiNote: 67, startBeat: 5, lengthBeats: 0.5, velocity: 0.55 },
  { id: 'seed-15', midiNote: 72, startBeat: 6.5, lengthBeats: 0.25, velocity: 0.5 },
  { id: 'seed-16', midiNote: 70, startBeat: 7.5, lengthBeats: 0.5, velocity: 0.5 }
];

@Injectable({ providedIn: 'root' })
export class SequencerService {
  private readonly audioEngine = inject(AudioEngineService);
  private readonly visualEngine = inject(VisualEngineService);

  readonly loopBeats = LOOP_BEATS;
  readonly stepBeats = STEP_BEATS;

  readonly notes = signal<readonly SequencerNote[]>(SEED_PATTERN);
  readonly isPlaying = signal(false);
  readonly playheadBeat = signal(0);

  private schedulerId: number | null = null;
  private startContextTime = 0;
  private scheduledUntilBeat = 0;
  private detachFrameCallback: (() => void) | null = null;

  async play(): Promise<void> {
    if (this.isPlaying()) {
      return;
    }
    this.audioEngine.initialize();
    await this.audioEngine.resume();
    this.startContextTime = this.audioEngine.getCurrentTime() + START_DELAY_SECONDS;
    this.scheduledUntilBeat = 0;
    this.isPlaying.set(true);
    this.schedulerId = window.setInterval(
      () => this.scheduleWindow(),
      SCHEDULER_INTERVAL_MS
    );
    this.detachFrameCallback = this.visualEngine.registerFrameCallback(() =>
      this.updatePlayhead()
    );
    this.scheduleWindow();
  }

  stop(): void {
    if (this.schedulerId !== null) {
      window.clearInterval(this.schedulerId);
      this.schedulerId = null;
    }
    this.detachFrameCallback?.();
    this.detachFrameCallback = null;
    this.audioEngine.allNotesOff();
    this.isPlaying.set(false);
    this.playheadBeat.set(0);
  }

  setBpm(value: number): void {
    const anchorBeat = this.currentAbsoluteBeat();
    this.audioEngine.setBpm(value);
    if (this.isPlaying()) {
      const secondsPerBeat = 60 / this.audioEngine.bpm();
      this.startContextTime =
        this.audioEngine.getCurrentTime() - anchorBeat * secondsPerBeat;
    }
  }

  addNote(midiNote: number, startBeat: number): void {
    const quantizedStart = clamp(
      Math.floor(startBeat / STEP_BEATS) * STEP_BEATS,
      0,
      LOOP_BEATS - STEP_BEATS
    );
    const note: SequencerNote = {
      id: crypto.randomUUID(),
      midiNote,
      startBeat: quantizedStart,
      lengthBeats: STEP_BEATS,
      velocity: 1
    };
    this.notes.update((notes) => [...notes, note]);
    if (this.audioEngine.isRunning()) {
      this.audioEngine.playNote(midiNote, 0.18, 0.9);
    }
  }

  removeNote(id: string): void {
    this.notes.update((notes) => notes.filter((note) => note.id !== id));
  }

  moveNote(id: string, midiNote: number, startBeat: number): void {
    this.notes.update((notes) =>
      notes.map((note) => {
        if (note.id !== id) {
          return note;
        }
        const quantizedStart = clamp(
          Math.round(startBeat / STEP_BEATS) * STEP_BEATS,
          0,
          LOOP_BEATS - note.lengthBeats
        );
        return { ...note, midiNote, startBeat: quantizedStart };
      })
    );
  }

  resizeNote(id: string, lengthBeats: number): void {
    this.notes.update((notes) =>
      notes.map((note) => {
        if (note.id !== id) {
          return note;
        }
        const quantizedLength = clamp(
          Math.round(lengthBeats / STEP_BEATS) * STEP_BEATS,
          STEP_BEATS,
          LOOP_BEATS - note.startBeat
        );
        return { ...note, lengthBeats: quantizedLength };
      })
    );
  }

  setNoteVelocity(id: string, velocity: number): void {
    this.notes.update((notes) =>
      notes.map((note) =>
        note.id === id
          ? { ...note, velocity: clamp(Number(velocity.toFixed(2)), MIN_VELOCITY, 1) }
          : note
      )
    );
  }

  clearPattern(): void {
    this.notes.set([]);
  }

  private scheduleWindow(): void {
    if (!this.isPlaying()) {
      return;
    }
    const secondsPerBeat = 60 / this.audioEngine.bpm();
    const now = this.audioEngine.getCurrentTime();
    const horizonBeat =
      (now + SCHEDULE_HORIZON_SECONDS - this.startContextTime) / secondsPerBeat;

    while (this.scheduledUntilBeat < horizonBeat) {
      const absoluteBeat = this.scheduledUntilBeat;
      const patternBeat = absoluteBeat % LOOP_BEATS;
      for (const note of this.notes()) {
        if (note.startBeat === patternBeat) {
          const when = this.startContextTime + absoluteBeat * secondsPerBeat;
          if (when >= now) {
            this.audioEngine.playNote(
              note.midiNote,
              note.lengthBeats * secondsPerBeat * NOTE_GATE_RATIO,
              note.velocity,
              when
            );
          }
        }
      }
      this.scheduledUntilBeat += STEP_BEATS;
    }
  }

  private updatePlayhead(): void {
    if (!this.isPlaying()) {
      return;
    }
    const secondsPerBeat = 60 / this.audioEngine.bpm();
    const beat =
      (this.audioEngine.getCurrentTime() - this.startContextTime) / secondsPerBeat;
    this.playheadBeat.set(beat <= 0 ? 0 : beat % LOOP_BEATS);
  }

  private currentAbsoluteBeat(): number {
    if (!this.isPlaying()) {
      return 0;
    }
    const secondsPerBeat = 60 / this.audioEngine.bpm();
    return (this.audioEngine.getCurrentTime() - this.startContextTime) / secondsPerBeat;
  }
}
