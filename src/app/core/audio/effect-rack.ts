import {
  DistortionConfig,
  EffectRackConfig,
  FilterConfig,
  ReverbConfig
} from '../../shared/models/audio-engine.models';
import { clamp } from './music-math';
import { createPolynomialDistortionCurve } from './distortion-curve.factory';
import { createReverbImpulseResponse } from './impulse-response.factory';

const PARAM_SMOOTHING_SECONDS = 0.012;

export class EffectRack {
  readonly input: GainNode;
  readonly output: GainNode;

  private readonly context: BaseAudioContext;
  private readonly waveShaper: WaveShaperNode;
  private readonly distortionWet: GainNode;
  private readonly distortionDry: GainNode;
  private readonly distortionOut: GainNode;
  private readonly filter: BiquadFilterNode;
  private readonly filterWet: GainNode;
  private readonly filterBypass: GainNode;
  private readonly filterOut: GainNode;
  private readonly convolver: ConvolverNode;
  private readonly reverbWet: GainNode;
  private readonly reverbDry: GainNode;
  private lastDistortionKey = '';
  private lastReverbKey = '';

  constructor(context: BaseAudioContext, config: EffectRackConfig) {
    this.context = context;
    this.input = context.createGain();
    this.output = context.createGain();
    this.waveShaper = context.createWaveShaper();
    this.waveShaper.oversample = '4x';
    this.distortionWet = context.createGain();
    this.distortionDry = context.createGain();
    this.distortionOut = context.createGain();
    this.filter = context.createBiquadFilter();
    this.filterWet = context.createGain();
    this.filterBypass = context.createGain();
    this.filterOut = context.createGain();
    this.convolver = context.createConvolver();
    this.reverbWet = context.createGain();
    this.reverbDry = context.createGain();

    this.input.connect(this.waveShaper);
    this.waveShaper.connect(this.distortionWet);
    this.distortionWet.connect(this.distortionOut);
    this.input.connect(this.distortionDry);
    this.distortionDry.connect(this.distortionOut);

    this.distortionOut.connect(this.filter);
    this.filter.connect(this.filterWet);
    this.filterWet.connect(this.filterOut);
    this.distortionOut.connect(this.filterBypass);
    this.filterBypass.connect(this.filterOut);

    this.filterOut.connect(this.convolver);
    this.convolver.connect(this.reverbWet);
    this.reverbWet.connect(this.output);
    this.filterOut.connect(this.reverbDry);
    this.reverbDry.connect(this.output);

    this.apply(config);
  }

  apply(config: EffectRackConfig): void {
    this.applyDistortion(config.distortion);
    this.applyFilter(config.filter);
    this.applyReverb(config.reverb);
  }

  dispose(): void {
    this.input.disconnect();
    this.waveShaper.disconnect();
    this.distortionWet.disconnect();
    this.distortionDry.disconnect();
    this.distortionOut.disconnect();
    this.filter.disconnect();
    this.filterWet.disconnect();
    this.filterBypass.disconnect();
    this.filterOut.disconnect();
    this.convolver.disconnect();
    this.reverbWet.disconnect();
    this.reverbDry.disconnect();
    this.output.disconnect();
  }

  private applyDistortion(config: DistortionConfig): void {
    const curveKey = `${config.drive.toFixed(4)}|${Math.floor(config.polynomialOrder)}`;
    if (curveKey !== this.lastDistortionKey) {
      this.waveShaper.curve = createPolynomialDistortionCurve(
        config.drive,
        config.polynomialOrder
      );
      this.lastDistortionKey = curveKey;
    }
    const wetLevel = config.enabled ? clamp(config.wetLevel, 0, 1) : 0;
    this.setParam(this.distortionWet.gain, wetLevel);
    this.setParam(this.distortionDry.gain, 1 - wetLevel);
  }

  private applyFilter(config: FilterConfig): void {
    this.filter.type = config.type;
    this.setParam(this.filter.frequency, clamp(config.frequencyHz, 10, 20000));
    this.setParam(this.filter.Q, clamp(config.q, 0.0001, 30));
    this.setParam(this.filter.gain, clamp(config.gainDb, -40, 40));
    this.setParam(this.filterWet.gain, config.enabled ? 1 : 0);
    this.setParam(this.filterBypass.gain, config.enabled ? 0 : 1);
  }

  private applyReverb(config: ReverbConfig): void {
    const impulseKey = `${config.decaySeconds.toFixed(3)}|${config.preDelaySeconds.toFixed(3)}`;
    if (impulseKey !== this.lastReverbKey) {
      this.convolver.buffer = createReverbImpulseResponse(
        this.context,
        Math.max(0.05, config.decaySeconds),
        Math.max(0, config.preDelaySeconds)
      );
      this.lastReverbKey = impulseKey;
    }
    const wetLevel = config.enabled ? clamp(config.wetLevel, 0, 1) : 0;
    this.setParam(this.reverbWet.gain, wetLevel);
    this.setParam(this.reverbDry.gain, 1 - wetLevel);
  }

  private setParam(param: AudioParam, value: number): void {
    param.setTargetAtTime(value, this.context.currentTime, PARAM_SMOOTHING_SECONDS);
  }
}
