import {
  AdsrEnvelopeConfig,
  OscillatorConfig
} from '../../shared/models/audio-engine.models';
import { clamp, midiNoteToFrequency } from './music-math';
import { PeriodicWaveFactory } from './periodic-wave.factory';

const ENVELOPE_FLOOR = 0.0001;
const MIN_RAMP_SECONDS = 0.003;
const STOP_PADDING_SECONDS = 0.06;
const FORCE_STOP_RAMP_SECONDS = 0.02;

export interface SynthVoiceOptions {
  readonly context: BaseAudioContext;
  readonly waveFactory: PeriodicWaveFactory;
  readonly destination: AudioNode;
  readonly oscillators: readonly OscillatorConfig[];
  readonly envelope: AdsrEnvelopeConfig;
  readonly midiNote: number;
  readonly velocity: number;
  readonly startTime: number;
  readonly onComplete: (voice: SynthVoice) => void;
}

export class SynthVoice {
  readonly midiNote: number;
  readonly startTime: number;

  private readonly context: BaseAudioContext;
  private readonly envelope: AdsrEnvelopeConfig;
  private readonly envelopeGain: GainNode;
  private readonly oscillators: OscillatorNode[] = [];
  private readonly oscillatorGains: GainNode[] = [];
  private readonly onComplete: (voice: SynthVoice) => void;
  private released = false;
  private completed = false;

  constructor(options: SynthVoiceOptions) {
    this.context = options.context;
    this.envelope = options.envelope;
    this.midiNote = options.midiNote;
    this.startTime = options.startTime;
    this.onComplete = options.onComplete;

    this.envelopeGain = options.context.createGain();
    this.envelopeGain.connect(options.destination);
    this.scheduleAttackAndDecay(options.velocity);

    const baseFrequency = midiNoteToFrequency(options.midiNote);
    for (const config of options.oscillators) {
      const frequency = baseFrequency * Math.pow(2, config.octaveShift);
      const oscillator = options.context.createOscillator();
      oscillator.setPeriodicWave(
        options.waveFactory.create(config.waveform, config.phaseOffsetRadians, frequency)
      );
      oscillator.frequency.setValueAtTime(frequency, options.startTime);
      oscillator.detune.setValueAtTime(config.detuneCents, options.startTime);

      const oscillatorGain = options.context.createGain();
      oscillatorGain.gain.value = clamp(config.gain, 0, 1);

      oscillator.connect(oscillatorGain);
      oscillatorGain.connect(this.envelopeGain);
      oscillator.start(options.startTime);

      this.oscillators.push(oscillator);
      this.oscillatorGains.push(oscillatorGain);
    }

    this.oscillators[0].onended = () => this.complete();
  }

  release(when: number): number {
    if (this.released) {
      return when;
    }
    this.released = true;

    const releaseStart = Math.max(when, this.context.currentTime);
    const releaseEnd =
      releaseStart + Math.max(MIN_RAMP_SECONDS, this.envelope.releaseSeconds);
    this.holdEnvelopeAt(releaseStart);
    this.envelopeGain.gain.exponentialRampToValueAtTime(ENVELOPE_FLOOR, releaseEnd);

    const stopTime = releaseEnd + STOP_PADDING_SECONDS;
    for (const oscillator of this.oscillators) {
      oscillator.stop(stopTime);
    }
    return releaseEnd;
  }

  forceStop(when: number): void {
    this.released = true;
    const stopStart = Math.max(when, this.context.currentTime);
    const rampEnd = stopStart + FORCE_STOP_RAMP_SECONDS;
    this.holdEnvelopeAt(stopStart);
    this.envelopeGain.gain.exponentialRampToValueAtTime(ENVELOPE_FLOOR, rampEnd);
    for (const oscillator of this.oscillators) {
      oscillator.stop(rampEnd + MIN_RAMP_SECONDS);
    }
  }

  private scheduleAttackAndDecay(velocity: number): void {
    const peakLevel = Math.max(ENVELOPE_FLOOR, velocity);
    const sustainLevel = Math.max(ENVELOPE_FLOOR, this.envelope.sustainLevel * peakLevel);
    const attackEnd =
      this.startTime + Math.max(MIN_RAMP_SECONDS, this.envelope.attackSeconds);
    const decayEnd = attackEnd + Math.max(MIN_RAMP_SECONDS, this.envelope.decaySeconds);

    const gainParam = this.envelopeGain.gain;
    gainParam.setValueAtTime(ENVELOPE_FLOOR, this.startTime);
    gainParam.exponentialRampToValueAtTime(peakLevel, attackEnd);
    gainParam.exponentialRampToValueAtTime(sustainLevel, decayEnd);
  }

  private holdEnvelopeAt(when: number): void {
    const gainParam = this.envelopeGain.gain;
    if (typeof gainParam.cancelAndHoldAtTime === 'function') {
      gainParam.cancelAndHoldAtTime(when);
      return;
    }
    gainParam.cancelScheduledValues(when);
    gainParam.setValueAtTime(Math.max(ENVELOPE_FLOOR, gainParam.value), when);
  }

  private complete(): void {
    if (this.completed) {
      return;
    }
    this.completed = true;
    for (const oscillator of this.oscillators) {
      oscillator.onended = null;
      oscillator.disconnect();
    }
    for (const oscillatorGain of this.oscillatorGains) {
      oscillatorGain.disconnect();
    }
    this.envelopeGain.disconnect();
    this.onComplete(this);
  }
}
