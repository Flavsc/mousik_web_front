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
import { VisualEngineService } from '../../core/services/visual-engine.service';
import { OscillatorConfig } from '../../shared/models/audio-engine.models';

const METER_SEGMENTS = 24;

interface TestKey {
  readonly label: string;
  readonly midiNote: number;
}

@Component({
  selector: 'mousik-workspace',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './mousik-workspace.component.html',
  styleUrl: './mousik-workspace.component.scss'
})
export class MousikWorkspaceComponent implements OnDestroy {
  protected readonly audioEngine = inject(AudioEngineService);
  protected readonly visualEngine = inject(VisualEngineService);

  private readonly sceneCanvas =
    viewChild.required<ElementRef<HTMLCanvasElement>>('sceneCanvas');
  private detachFrameCallback: (() => void) | null = null;

  protected readonly testKeys: readonly TestKey[] = [
    { label: 'C3', midiNote: 48 },
    { label: 'D#3', midiNote: 51 },
    { label: 'F3', midiNote: 53 },
    { label: 'G3', midiNote: 55 },
    { label: 'A#3', midiNote: 58 },
    { label: 'C4', midiNote: 60 },
    { label: 'D#4', midiNote: 63 },
    { label: 'G4', midiNote: 67 }
  ];

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

  protected readonly bassMeter = computed(() =>
    this.buildAsciiMeter(this.audioEngine.analysisFrame().bassEnergy)
  );

  protected readonly midMeter = computed(() =>
    this.buildAsciiMeter(this.audioEngine.analysisFrame().midEnergy)
  );

  protected readonly trebleMeter = computed(() =>
    this.buildAsciiMeter(this.audioEngine.analysisFrame().trebleEnergy)
  );

  protected readonly envelopeReadout = computed(() => {
    const envelope = this.audioEngine.patch().envelope;
    return `A${envelope.attackSeconds} D${envelope.decaySeconds} S${envelope.sustainLevel} R${envelope.releaseSeconds}`;
  });

  protected readonly filterReadout = computed(() => {
    const filter = this.audioEngine.patch().effectRack.filter;
    return `${filter.type.toUpperCase()} ${filter.frequencyHz}HZ Q${filter.q}`;
  });

  protected readonly reverbReadout = computed(() => {
    const reverb = this.audioEngine.patch().effectRack.reverb;
    return `${reverb.decaySeconds}S PRE${Math.round(reverb.preDelaySeconds * 1000)}MS WET${reverb.wetLevel}`;
  });

  protected readonly distortionReadout = computed(() => {
    const distortion = this.audioEngine.patch().effectRack.distortion;
    return `CHEBYSHEV N${distortion.polynomialOrder} DRV${distortion.drive} WET${distortion.wetLevel}`;
  });

  constructor() {
    afterNextRender(() => {
      this.visualEngine.initialize(this.sceneCanvas().nativeElement);
      this.visualEngine.startRenderLoop();
      this.detachFrameCallback = this.visualEngine.registerFrameCallback(() => {
        this.audioEngine.captureAnalysisFrame();
      });
    });
  }

  protected async activateAudio(): Promise<void> {
    this.audioEngine.initialize();
    await this.audioEngine.resume();
  }

  protected pressKey(midiNote: number): void {
    if (!this.audioEngine.isRunning()) {
      return;
    }
    this.audioEngine.noteOn(midiNote, 1);
  }

  protected releaseKey(midiNote: number): void {
    if (!this.audioEngine.isInitialized()) {
      return;
    }
    this.audioEngine.noteOff(midiNote);
  }

  protected formatOscillator(config: OscillatorConfig): string {
    const detune = config.detuneCents >= 0 ? `+${config.detuneCents}` : `${config.detuneCents}`;
    const phase = (config.phaseOffsetRadians / Math.PI).toFixed(2);
    return `${config.waveform.toUpperCase()} ${detune}CT PH${phase}PI OCT${config.octaveShift} G${config.gain}`;
  }

  ngOnDestroy(): void {
    this.detachFrameCallback?.();
    this.audioEngine.allNotesOff();
    this.visualEngine.dispose();
  }

  private buildAsciiMeter(level: number): string {
    const clamped = Math.min(1, Math.max(0, level));
    const filled = Math.round(clamped * METER_SEGMENTS);
    return `[${'#'.repeat(filled).padEnd(METER_SEGMENTS, '.')}]`;
  }
}
