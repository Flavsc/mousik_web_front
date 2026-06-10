import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';

import { AudioEngineService } from '../../core/services/audio-engine.service';
import {
  AdsrEnvelopeConfig,
  OscillatorConfig,
  OscillatorWaveform
} from '../../shared/models/audio-engine.models';

const METER_SEGMENTS = 24;

type OscillatorNumberParam = 'detuneCents' | 'phaseOffsetRadians' | 'gain' | 'octaveShift';
type FilterNumberParam = 'frequencyHz' | 'q' | 'gainDb';
type ReverbNumberParam = 'decaySeconds' | 'preDelaySeconds' | 'wetLevel';
type DistortionNumberParam = 'drive' | 'polynomialOrder' | 'wetLevel';

const WAVEFORM_LABELS: Record<OscillatorWaveform, string> = {
  sine: 'SIN',
  square: 'SQR',
  sawtooth: 'SAW',
  triangle: 'TRI'
};

@Component({
  selector: 'mousik-synth-rack',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './synth-rack.component.html',
  styleUrl: './synth-rack.component.scss'
})
export class SynthRackComponent {
  protected readonly audioEngine = inject(AudioEngineService);

  protected readonly waveforms: readonly OscillatorWaveform[] = [
    'sine',
    'square',
    'sawtooth',
    'triangle'
  ];

  protected readonly filterTypes: readonly BiquadFilterType[] = [
    'lowpass',
    'highpass',
    'bandpass',
    'notch'
  ];

  protected readonly bassMeter = computed(() =>
    this.buildAsciiMeter(this.audioEngine.analysisFrame().bassEnergy)
  );

  protected readonly midMeter = computed(() =>
    this.buildAsciiMeter(this.audioEngine.analysisFrame().midEnergy)
  );

  protected readonly trebleMeter = computed(() =>
    this.buildAsciiMeter(this.audioEngine.analysisFrame().trebleEnergy)
  );

  protected waveformLabel(waveform: OscillatorWaveform): string {
    return WAVEFORM_LABELS[waveform];
  }

  protected filterTypeLabel(type: BiquadFilterType): string {
    if (type === 'lowpass') {
      return 'LP';
    }
    if (type === 'highpass') {
      return 'HP';
    }
    if (type === 'bandpass') {
      return 'BP';
    }
    if (type === 'notch') {
      return 'NT';
    }
    return type.toUpperCase();
  }

  protected phaseReadout(oscillator: OscillatorConfig): string {
    return `${(oscillator.phaseOffsetRadians / Math.PI).toFixed(2)}PI`;
  }

  protected toggleOscillator(oscillator: OscillatorConfig): void {
    this.audioEngine.updateOscillator(oscillator.id, { enabled: !oscillator.enabled });
  }

  protected setOscillatorWaveform(id: string, waveform: OscillatorWaveform): void {
    this.audioEngine.updateOscillator(id, { waveform });
  }

  protected setOscillatorNumber(
    id: string,
    param: OscillatorNumberParam,
    event: Event
  ): void {
    this.audioEngine.updateOscillator(id, {
      [param]: this.readNumber(event)
    } as Partial<Omit<OscillatorConfig, 'id'>>);
  }

  protected setEnvelopeParam(param: keyof AdsrEnvelopeConfig, event: Event): void {
    this.audioEngine.setEnvelope({
      [param]: this.readNumber(event)
    } as Partial<AdsrEnvelopeConfig>);
  }

  protected toggleFilter(): void {
    this.audioEngine.setFilter({
      enabled: !this.audioEngine.patch().effectRack.filter.enabled
    });
  }

  protected setFilterType(type: BiquadFilterType): void {
    this.audioEngine.setFilter({ type });
  }

  protected setFilterNumber(param: FilterNumberParam, event: Event): void {
    this.audioEngine.setFilter({ [param]: this.readNumber(event) });
  }

  protected toggleReverb(): void {
    this.audioEngine.setReverb({
      enabled: !this.audioEngine.patch().effectRack.reverb.enabled
    });
  }

  protected setReverbNumber(param: ReverbNumberParam, event: Event): void {
    this.audioEngine.setReverb({ [param]: this.readNumber(event) });
  }

  protected toggleDistortion(): void {
    this.audioEngine.setDistortion({
      enabled: !this.audioEngine.patch().effectRack.distortion.enabled
    });
  }

  protected setDistortionNumber(param: DistortionNumberParam, event: Event): void {
    this.audioEngine.setDistortion({ [param]: this.readNumber(event) });
  }

  protected setMasterGain(event: Event): void {
    this.audioEngine.setMasterGain(this.readNumber(event));
  }

  private readNumber(event: Event): number {
    return Number((event.target as HTMLInputElement).value);
  }

  private buildAsciiMeter(level: number): string {
    const clamped = Math.min(1, Math.max(0, level));
    const filled = Math.round(clamped * METER_SEGMENTS);
    return `[${'#'.repeat(filled).padEnd(METER_SEGMENTS, '.')}]`;
  }
}
