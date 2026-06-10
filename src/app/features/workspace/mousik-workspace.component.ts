import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  afterNextRender,
  computed,
  inject,
  viewChild
} from '@angular/core';

import { AudioEngineService } from '../../core/services/audio-engine.service';
import { SequencerService } from '../../core/services/sequencer.service';
import { VideoRecorderService } from '../../core/services/video-recorder.service';
import { VisualEngineService } from '../../core/services/visual-engine.service';
import { PianoRollComponent } from './piano-roll.component';
import { SynthRackComponent } from './synth-rack.component';

@Component({
  selector: 'mousik-workspace',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PianoRollComponent, SynthRackComponent],
  templateUrl: './mousik-workspace.component.html',
  styleUrl: './mousik-workspace.component.scss'
})
export class MousikWorkspaceComponent implements OnDestroy {
  protected readonly audioEngine = inject(AudioEngineService);
  protected readonly visualEngine = inject(VisualEngineService);
  protected readonly sequencer = inject(SequencerService);
  protected readonly videoRecorder = inject(VideoRecorderService);

  private readonly sceneCanvas =
    viewChild.required<ElementRef<HTMLCanvasElement>>('sceneCanvas');

  protected readonly contextState = computed(() =>
    this.audioEngine.isRunning() ? 'RUN' : 'HALT'
  );

  protected readonly sampleRateReadout = computed(() =>
    this.audioEngine.isInitialized() ? `${this.audioEngine.getSampleRate()}` : '-----'
  );

  protected readonly rmsReadout = computed(() =>
    this.audioEngine.analysisFrame().rms.toFixed(3)
  );

  protected readonly peakReadout = computed(() =>
    Math.round(this.audioEngine.analysisFrame().peakFrequencyHz)
      .toString()
      .padStart(5, '0')
  );

  protected readonly recordReadout = computed(() => {
    const totalSeconds = Math.floor(this.videoRecorder.recordingSeconds());
    const minutes = Math.floor(totalSeconds / 60)
      .toString()
      .padStart(2, '0');
    const seconds = (totalSeconds % 60).toString().padStart(2, '0');
    return `${minutes}:${seconds}`;
  });

  protected readonly playheadReadout = computed(() => {
    const beat = this.sequencer.playheadBeat();
    const bar = Math.floor(beat / 4) + 1;
    const beatInBar = Math.floor(beat % 4) + 1;
    const sixteenth = Math.floor((beat % 1) / 0.25) + 1;
    return `${bar}.${beatInBar}.${sixteenth}`;
  });

  constructor() {
    afterNextRender(() => {
      this.visualEngine.initialize(this.sceneCanvas().nativeElement);
      this.visualEngine.startRenderLoop();
    });
  }

  protected async activateAudio(): Promise<void> {
    this.audioEngine.initialize();
    await this.audioEngine.resume();
  }

  protected async togglePlayback(): Promise<void> {
    if (this.sequencer.isPlaying()) {
      this.sequencer.stop();
      return;
    }
    await this.sequencer.play();
  }

  protected async toggleRecording(): Promise<void> {
    if (this.videoRecorder.isRecording()) {
      this.videoRecorder.stop();
      return;
    }
    await this.videoRecorder.start();
  }

  protected onBpmChange(event: Event): void {
    this.sequencer.setBpm(Number((event.target as HTMLInputElement).value));
  }

  protected clearPattern(): void {
    this.sequencer.clearPattern();
  }

  ngOnDestroy(): void {
    this.videoRecorder.cancel();
    this.sequencer.stop();
    this.audioEngine.allNotesOff();
    this.visualEngine.dispose();
  }
}
