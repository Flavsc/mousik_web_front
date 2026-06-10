import { OscillatorWaveform } from '../../shared/models/audio-engine.models';

const MAX_HARMONICS = 64;
const MIN_FUNDAMENTAL_HZ = 20;

function harmonicAmplitude(waveform: OscillatorWaveform, harmonic: number): number {
  if (waveform === 'sine') {
    return harmonic === 1 ? 1 : 0;
  }
  if (waveform === 'square') {
    return harmonic % 2 === 1 ? 4 / (Math.PI * harmonic) : 0;
  }
  if (waveform === 'sawtooth') {
    const sign = harmonic % 2 === 1 ? 1 : -1;
    return sign * (2 / (Math.PI * harmonic));
  }
  if (harmonic % 2 === 0) {
    return 0;
  }
  const sign = ((harmonic - 1) / 2) % 2 === 0 ? 1 : -1;
  return sign * (8 / (Math.PI * Math.PI * harmonic * harmonic));
}

export class PeriodicWaveFactory {
  private readonly cache = new Map<string, PeriodicWave>();

  constructor(private readonly context: BaseAudioContext) {}

  create(
    waveform: OscillatorWaveform,
    phaseOffsetRadians: number,
    fundamentalHz: number
  ): PeriodicWave {
    const harmonicCount = this.resolveHarmonicCount(fundamentalHz);
    const cacheKey = `${waveform}|${harmonicCount}|${phaseOffsetRadians.toFixed(4)}`;
    const cached = this.cache.get(cacheKey);
    if (cached !== undefined) {
      return cached;
    }

    const real = new Float32Array(harmonicCount + 1);
    const imag = new Float32Array(harmonicCount + 1);
    for (let harmonic = 1; harmonic <= harmonicCount; harmonic += 1) {
      const amplitude = harmonicAmplitude(waveform, harmonic);
      if (amplitude === 0) {
        continue;
      }
      const rotation = harmonic * phaseOffsetRadians;
      real[harmonic] = amplitude * Math.sin(rotation);
      imag[harmonic] = amplitude * Math.cos(rotation);
    }

    const wave = this.context.createPeriodicWave(real, imag, { disableNormalization: false });
    this.cache.set(cacheKey, wave);
    return wave;
  }

  private resolveHarmonicCount(fundamentalHz: number): number {
    const nyquist = this.context.sampleRate / 2;
    const safeFundamental = Math.max(MIN_FUNDAMENTAL_HZ, fundamentalHz);
    return Math.max(1, Math.min(MAX_HARMONICS, Math.floor(nyquist / safeFundamental)));
  }
}
