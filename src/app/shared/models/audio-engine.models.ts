export type OscillatorWaveform = 'sine' | 'square' | 'sawtooth' | 'triangle';

export type DrumSound =
  | 'kick'
  | 'snare'
  | 'clap'
  | 'hat-closed'
  | 'hat-open'
  | 'tom-low'
  | 'tom-high'
  | 'cymbal';

export interface OscillatorConfig {
  readonly id: string;
  readonly waveform: OscillatorWaveform;
  readonly detuneCents: number;
  readonly phaseOffsetRadians: number;
  readonly gain: number;
  readonly octaveShift: number;
  readonly enabled: boolean;
}

export interface AdsrEnvelopeConfig {
  readonly attackSeconds: number;
  readonly decaySeconds: number;
  readonly sustainLevel: number;
  readonly releaseSeconds: number;
}

export interface FilterConfig {
  readonly type: BiquadFilterType;
  readonly frequencyHz: number;
  readonly q: number;
  readonly gainDb: number;
  readonly enabled: boolean;
}

export interface ReverbConfig {
  readonly decaySeconds: number;
  readonly preDelaySeconds: number;
  readonly wetLevel: number;
  readonly enabled: boolean;
}

export interface DistortionConfig {
  readonly drive: number;
  readonly polynomialOrder: number;
  readonly wetLevel: number;
  readonly enabled: boolean;
}

export interface EffectRackConfig {
  readonly filter: FilterConfig;
  readonly reverb: ReverbConfig;
  readonly distortion: DistortionConfig;
}

export interface SynthPatch {
  readonly oscillators: readonly OscillatorConfig[];
  readonly envelope: AdsrEnvelopeConfig;
  readonly effectRack: EffectRackConfig;
  readonly masterGain: number;
}

export interface SequencerNote {
  readonly id: string;
  readonly midiNote: number;
  readonly startBeat: number;
  readonly lengthBeats: number;
  readonly velocity: number;
}

export interface AudioAnalysisFrame {
  readonly frequencyData: Uint8Array<ArrayBuffer>;
  readonly timeDomainData: Uint8Array<ArrayBuffer>;
  readonly rms: number;
  readonly peakFrequencyHz: number;
  readonly bassEnergy: number;
  readonly midEnergy: number;
  readonly trebleEnergy: number;
}

export const ANALYSER_FFT_SIZE = 2048;

export const DEFAULT_SYNTH_PATCH: SynthPatch = {
  oscillators: [
    {
      id: 'osc-a',
      waveform: 'sawtooth',
      detuneCents: -7,
      phaseOffsetRadians: 0,
      gain: 0.5,
      octaveShift: 0,
      enabled: true
    },
    {
      id: 'osc-b',
      waveform: 'sawtooth',
      detuneCents: 7,
      phaseOffsetRadians: Math.PI / 2,
      gain: 0.5,
      octaveShift: 0,
      enabled: true
    },
    {
      id: 'osc-c',
      waveform: 'square',
      detuneCents: 0,
      phaseOffsetRadians: 0,
      gain: 0.35,
      octaveShift: -1,
      enabled: true
    }
  ],
  envelope: {
    attackSeconds: 0.01,
    decaySeconds: 0.18,
    sustainLevel: 0.65,
    releaseSeconds: 0.4
  },
  effectRack: {
    filter: {
      type: 'lowpass',
      frequencyHz: 9000,
      q: 0.9,
      gainDb: 0,
      enabled: true
    },
    reverb: {
      decaySeconds: 2.2,
      preDelaySeconds: 0.02,
      wetLevel: 0.25,
      enabled: true
    },
    distortion: {
      drive: 0.35,
      polynomialOrder: 5,
      wetLevel: 0.3,
      enabled: true
    }
  },
  masterGain: 0.8
};

export const EMPTY_ANALYSIS_FRAME: AudioAnalysisFrame = {
  frequencyData: new Uint8Array(ANALYSER_FFT_SIZE / 2),
  timeDomainData: new Uint8Array(ANALYSER_FFT_SIZE),
  rms: 0,
  peakFrequencyHz: 0,
  bassEnergy: 0,
  midEnergy: 0,
  trebleEnergy: 0
};
