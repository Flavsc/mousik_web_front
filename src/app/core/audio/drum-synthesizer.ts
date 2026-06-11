import { DrumSound } from '../../shared/models/audio-engine.models';

const NOISE_BUFFER_SECONDS = 1.5;
const ENVELOPE_FLOOR = 0.0001;

export class DrumSynthesizer {
  private readonly noiseBuffer: AudioBuffer;

  constructor(
    private readonly context: BaseAudioContext,
    private readonly destination: AudioNode
  ) {
    this.noiseBuffer = this.createNoiseBuffer();
  }

  trigger(sound: DrumSound, velocity: number, when: number): void {
    if (sound === 'kick') {
      this.triggerPitchDrop(velocity, when, 150, 40, 0.4);
      return;
    }
    if (sound === 'tom-low') {
      this.triggerPitchDrop(velocity * 0.9, when, 120, 70, 0.3);
      return;
    }
    if (sound === 'tom-high') {
      this.triggerPitchDrop(velocity * 0.85, when, 220, 130, 0.25);
      return;
    }
    if (sound === 'snare') {
      this.triggerNoiseHit(velocity, when, 'bandpass', 1800, 0.18);
      this.triggerPitchDrop(velocity * 0.5, when, 190, 120, 0.12);
      return;
    }
    if (sound === 'clap') {
      this.triggerClap(velocity, when);
      return;
    }
    if (sound === 'hat-closed') {
      this.triggerNoiseHit(velocity * 0.7, when, 'highpass', 7500, 0.06);
      return;
    }
    if (sound === 'hat-open') {
      this.triggerNoiseHit(velocity * 0.65, when, 'highpass', 7000, 0.45);
      return;
    }
    this.triggerNoiseHit(velocity * 0.6, when, 'highpass', 5200, 0.9);
  }

  private triggerPitchDrop(
    velocity: number,
    when: number,
    startHz: number,
    endHz: number,
    decaySeconds: number
  ): void {
    const oscillator = this.context.createOscillator();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(startHz, when);
    oscillator.frequency.exponentialRampToValueAtTime(endHz, when + decaySeconds * 0.45);

    const gain = this.context.createGain();
    gain.gain.setValueAtTime(Math.max(ENVELOPE_FLOOR, velocity), when);
    gain.gain.exponentialRampToValueAtTime(ENVELOPE_FLOOR, when + decaySeconds);

    oscillator.connect(gain);
    gain.connect(this.destination);
    oscillator.start(when);
    oscillator.stop(when + decaySeconds + 0.05);
    oscillator.onended = () => {
      oscillator.disconnect();
      gain.disconnect();
    };
  }

  private triggerNoiseHit(
    velocity: number,
    when: number,
    filterType: BiquadFilterType,
    frequencyHz: number,
    decaySeconds: number
  ): void {
    const source = this.createNoiseSource();
    const filter = this.context.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.value = frequencyHz;
    filter.Q.value = 0.9;

    const gain = this.context.createGain();
    gain.gain.setValueAtTime(Math.max(ENVELOPE_FLOOR, velocity), when);
    gain.gain.exponentialRampToValueAtTime(ENVELOPE_FLOOR, when + decaySeconds);

    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.destination);
    source.start(when);
    source.stop(when + decaySeconds + 0.05);
    source.onended = () => {
      source.disconnect();
      filter.disconnect();
      gain.disconnect();
    };
  }

  private triggerClap(velocity: number, when: number): void {
    const source = this.createNoiseSource();
    const filter = this.context.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 1100;
    filter.Q.value = 1.4;

    const gain = this.context.createGain();
    const level = Math.max(ENVELOPE_FLOOR, velocity);
    const gainParam = gain.gain;
    gainParam.setValueAtTime(level, when);
    gainParam.exponentialRampToValueAtTime(level * 0.15, when + 0.02);
    gainParam.setValueAtTime(level, when + 0.03);
    gainParam.exponentialRampToValueAtTime(level * 0.15, when + 0.05);
    gainParam.setValueAtTime(level, when + 0.06);
    gainParam.exponentialRampToValueAtTime(ENVELOPE_FLOOR, when + 0.3);

    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.destination);
    source.start(when);
    source.stop(when + 0.35);
    source.onended = () => {
      source.disconnect();
      filter.disconnect();
      gain.disconnect();
    };
  }

  private createNoiseSource(): AudioBufferSourceNode {
    const source = this.context.createBufferSource();
    source.buffer = this.noiseBuffer;
    source.loop = true;
    return source;
  }

  private createNoiseBuffer(): AudioBuffer {
    const length = Math.floor(this.context.sampleRate * NOISE_BUFFER_SECONDS);
    const buffer = this.context.createBuffer(1, length, this.context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let index = 0; index < length; index += 1) {
      data[index] = Math.random() * 2 - 1;
    }
    return buffer;
  }
}
