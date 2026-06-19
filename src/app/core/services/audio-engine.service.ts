import { Injectable, signal } from '@angular/core';

import {
  ANALYSER_FFT_SIZE,
  AdsrEnvelopeConfig,
  AudioAnalysisFrame,
  DEFAULT_SYNTH_PATCH,
  DistortionConfig,
  DrumSound,
  EMPTY_ANALYSIS_FRAME,
  FilterConfig,
  OscillatorConfig,
  ReverbConfig,
  SynthPatch
} from '../../shared/models/audio-engine.models';
import { DrumSynthesizer } from '../audio/drum-synthesizer';
import { EffectRack } from '../audio/effect-rack';
import { clamp } from '../audio/music-math';
import { PeriodicWaveFactory } from '../audio/periodic-wave.factory';
import { SynthVoice } from '../audio/synth-voice';

const MAX_POLYPHONY = 16;
const MIN_NOTE_DURATION_SECONDS = 0.01;
const MASTER_SMOOTHING_SECONDS = 0.012;

@Injectable({ providedIn: 'root' })
export class AudioEngineService {
  private audioContext: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private analyser: AnalyserNode | null = null;
  private recordingDestination: MediaStreamAudioDestinationNode | null = null;
  private waveFactory: PeriodicWaveFactory | null = null;
  private effectRack: EffectRack | null = null;
  private voiceBus: GainNode | null = null;
  private drumSynthesizer: DrumSynthesizer | null = null;
  private frequencyBuffer: Uint8Array<ArrayBuffer> = new Uint8Array(0);
  private timeDomainBuffer: Uint8Array<ArrayBuffer> = new Uint8Array(0);
  private readonly voicesByNote = new Map<number, SynthVoice[]>();
  private readonly voiceOrder: SynthVoice[] = [];

  readonly isInitialized = signal(false);
  readonly isRunning = signal(false);
  readonly analysisFrame = signal<AudioAnalysisFrame>(EMPTY_ANALYSIS_FRAME);
  readonly patch = signal<SynthPatch>(DEFAULT_SYNTH_PATCH);
  readonly activeVoiceCount = signal(0);
  readonly bpm = signal(120);

  initialize(): void {
    if (this.audioContext !== null) {
      return;
    }

    const audioContext = new AudioContext({ latencyHint: 'interactive' });

    const masterGain = audioContext.createGain();
    masterGain.gain.value = this.patch().masterGain;

    const analyser = audioContext.createAnalyser();
    analyser.fftSize = ANALYSER_FFT_SIZE;
    analyser.smoothingTimeConstant = 0.8;
    analyser.minDecibels = -90;
    analyser.maxDecibels = -10;

    const recordingDestination = audioContext.createMediaStreamDestination();

    masterGain.connect(analyser);
    analyser.connect(audioContext.destination);
    masterGain.connect(recordingDestination);

    const effectRack = new EffectRack(audioContext, this.patch().effectRack);
    const voiceBus = audioContext.createGain();
    voiceBus.gain.value = 1;
    voiceBus.connect(effectRack.input);
    effectRack.output.connect(masterGain);

    this.audioContext = audioContext;
    this.masterGain = masterGain;
    this.analyser = analyser;
    this.recordingDestination = recordingDestination;
    this.waveFactory = new PeriodicWaveFactory(audioContext);
    this.effectRack = effectRack;
    this.voiceBus = voiceBus;
    this.drumSynthesizer = new DrumSynthesizer(audioContext, masterGain);
    this.frequencyBuffer = new Uint8Array(analyser.frequencyBinCount);
    this.timeDomainBuffer = new Uint8Array(analyser.fftSize);

    this.isInitialized.set(true);
    this.isRunning.set(audioContext.state === 'running');
  }

  async resume(): Promise<void> {
    const audioContext = this.requireContext();
    if (audioContext.state !== 'running') {
      await audioContext.resume();
    }
    this.isRunning.set(audioContext.state === 'running');
  }

  async suspend(): Promise<void> {
    const audioContext = this.requireContext();
    if (audioContext.state === 'running') {
      await audioContext.suspend();
    }
    this.isRunning.set(false);
  }

  noteOn(
    midiNote: number,
    velocity = 1,
    when?: number,
    glideFromMidi?: number,
    glideSeconds?: number
  ): void {
    this.spawnVoice(midiNote, velocity, when, glideFromMidi, glideSeconds);
  }

  noteOff(midiNote: number, when?: number): void {
    if (this.audioContext === null) {
      return;
    }
    const voices = this.voicesByNote.get(midiNote);
    if (voices === undefined) {
      return;
    }
    const releaseTime = Math.max(
      this.audioContext.currentTime,
      when ?? this.audioContext.currentTime
    );
    for (const voice of voices) {
      voice.release(releaseTime);
    }
  }

  playNote(midiNote: number, durationSeconds: number, velocity = 1, when?: number): void {
    if (this.audioContext === null) {
      return;
    }
    const voice = this.spawnVoice(midiNote, velocity, when);
    if (voice === null) {
      return;
    }
    const releaseTime =
      Math.max(this.audioContext.currentTime, when ?? this.audioContext.currentTime) +
      Math.max(MIN_NOTE_DURATION_SECONDS, durationSeconds);
    voice.release(releaseTime);
  }

  playDrum(sound: DrumSound, velocity = 1, when?: number): void {
    if (this.audioContext === null || this.drumSynthesizer === null) {
      return;
    }
    const triggerTime = Math.max(
      this.audioContext.currentTime,
      when ?? this.audioContext.currentTime
    );
    this.drumSynthesizer.trigger(sound, clamp(velocity, 0.05, 1), triggerTime);
  }

  allNotesOff(): void {
    if (this.audioContext === null) {
      return;
    }
    const now = this.audioContext.currentTime;
    for (const voice of [...this.voiceOrder]) {
      voice.forceStop(now);
      this.removeVoice(voice);
    }
  }

  updateOscillator(id: string, changes: Partial<Omit<OscillatorConfig, 'id'>>): void {
    this.patch.update((patch) => ({
      ...patch,
      oscillators: patch.oscillators.map((oscillator) =>
        oscillator.id === id ? { ...oscillator, ...changes } : oscillator
      )
    }));
  }

  setEnvelope(changes: Partial<AdsrEnvelopeConfig>): void {
    this.patch.update((patch) => ({
      ...patch,
      envelope: { ...patch.envelope, ...changes }
    }));
  }

  setFilter(changes: Partial<FilterConfig>): void {
    this.patch.update((patch) => ({
      ...patch,
      effectRack: {
        ...patch.effectRack,
        filter: { ...patch.effectRack.filter, ...changes }
      }
    }));
    this.effectRack?.apply(this.patch().effectRack);
  }

  setReverb(changes: Partial<ReverbConfig>): void {
    this.patch.update((patch) => ({
      ...patch,
      effectRack: {
        ...patch.effectRack,
        reverb: { ...patch.effectRack.reverb, ...changes }
      }
    }));
    this.effectRack?.apply(this.patch().effectRack);
  }

  setDistortion(changes: Partial<DistortionConfig>): void {
    this.patch.update((patch) => ({
      ...patch,
      effectRack: {
        ...patch.effectRack,
        distortion: { ...patch.effectRack.distortion, ...changes }
      }
    }));
    this.effectRack?.apply(this.patch().effectRack);
  }

  setMasterGain(value: number): void {
    const level = clamp(value, 0, 1);
    this.patch.update((patch) => ({ ...patch, masterGain: level }));
    if (this.masterGain !== null && this.audioContext !== null) {
      this.masterGain.gain.setTargetAtTime(
        level,
        this.audioContext.currentTime,
        MASTER_SMOOTHING_SECONDS
      );
    }
  }

  setBpm(value: number): void {
    this.bpm.set(clamp(Math.round(value), 20, 999));
  }

  captureAnalysisFrame(): AudioAnalysisFrame {
    if (this.analyser === null || this.audioContext === null) {
      return this.analysisFrame();
    }

    this.analyser.getByteFrequencyData(this.frequencyBuffer);
    this.analyser.getByteTimeDomainData(this.timeDomainBuffer);

    const frame: AudioAnalysisFrame = {
      frequencyData: this.frequencyBuffer,
      timeDomainData: this.timeDomainBuffer,
      rms: this.computeRms(this.timeDomainBuffer),
      peakFrequencyHz: this.computePeakFrequency(this.frequencyBuffer),
      bassEnergy: this.computeBandEnergy(this.frequencyBuffer, 20, 250),
      midEnergy: this.computeBandEnergy(this.frequencyBuffer, 250, 4000),
      trebleEnergy: this.computeBandEnergy(this.frequencyBuffer, 4000, 16000)
    };

    this.analysisFrame.set(frame);
    return frame;
  }

  getCurrentTime(): number {
    return this.audioContext?.currentTime ?? 0;
  }

  getMasterInput(): GainNode {
    if (this.masterGain === null) {
      throw new Error('AudioEngineService not initialized');
    }
    return this.masterGain;
  }

  getRecordingStream(): MediaStream {
    if (this.recordingDestination === null) {
      throw new Error('AudioEngineService not initialized');
    }
    return this.recordingDestination.stream;
  }

  getSampleRate(): number {
    return this.requireContext().sampleRate;
  }

  async dispose(): Promise<void> {
    if (this.audioContext === null) {
      return;
    }
    this.allNotesOff();
    this.effectRack?.dispose();
    await this.audioContext.close();
    this.audioContext = null;
    this.masterGain = null;
    this.analyser = null;
    this.recordingDestination = null;
    this.waveFactory = null;
    this.effectRack = null;
    this.voiceBus = null;
    this.drumSynthesizer = null;
    this.frequencyBuffer = new Uint8Array(0);
    this.timeDomainBuffer = new Uint8Array(0);
    this.voicesByNote.clear();
    this.voiceOrder.length = 0;
    this.activeVoiceCount.set(0);
    this.isInitialized.set(false);
    this.isRunning.set(false);
    this.analysisFrame.set(EMPTY_ANALYSIS_FRAME);
  }

  private spawnVoice(
    midiNote: number,
    velocity: number,
    when?: number,
    glideFromMidi?: number,
    glideSeconds?: number
  ): SynthVoice | null {
    if (this.audioContext === null || this.waveFactory === null || this.voiceBus === null) {
      return null;
    }
    const patch = this.patch();
    const enabledOscillators = patch.oscillators.filter((config) => config.enabled);
    if (enabledOscillators.length === 0) {
      return null;
    }

    const startTime = Math.max(
      this.audioContext.currentTime,
      when ?? this.audioContext.currentTime
    );
    this.stealOldestVoicesIfNeeded();

    const voice = new SynthVoice({
      context: this.audioContext,
      waveFactory: this.waveFactory,
      destination: this.voiceBus,
      oscillators: enabledOscillators,
      envelope: patch.envelope,
      midiNote,
      velocity: clamp(velocity, 0.05, 1),
      startTime,
      glideFromMidi,
      glideSeconds,
      onComplete: (ended) => this.removeVoice(ended)
    });
    this.registerVoice(voice);
    return voice;
  }

  private registerVoice(voice: SynthVoice): void {
    this.voiceOrder.push(voice);
    const list = this.voicesByNote.get(voice.midiNote) ?? [];
    list.push(voice);
    this.voicesByNote.set(voice.midiNote, list);
    this.activeVoiceCount.set(this.voiceOrder.length);
  }

  private removeVoice(voice: SynthVoice): void {
    const orderIndex = this.voiceOrder.indexOf(voice);
    if (orderIndex >= 0) {
      this.voiceOrder.splice(orderIndex, 1);
    }
    const list = this.voicesByNote.get(voice.midiNote);
    if (list !== undefined) {
      const listIndex = list.indexOf(voice);
      if (listIndex >= 0) {
        list.splice(listIndex, 1);
      }
      if (list.length === 0) {
        this.voicesByNote.delete(voice.midiNote);
      }
    }
    this.activeVoiceCount.set(this.voiceOrder.length);
  }

  private stealOldestVoicesIfNeeded(): void {
    if (this.audioContext === null) {
      return;
    }
    while (this.voiceOrder.length >= MAX_POLYPHONY) {
      const oldest = this.voiceOrder[0];
      oldest.forceStop(this.audioContext.currentTime);
      this.removeVoice(oldest);
    }
  }

  private requireContext(): AudioContext {
    if (this.audioContext === null) {
      throw new Error('AudioEngineService not initialized');
    }
    return this.audioContext;
  }

  private computeRms(timeDomainData: Uint8Array<ArrayBuffer>): number {
    if (timeDomainData.length === 0) {
      return 0;
    }
    let sumOfSquares = 0;
    for (let index = 0; index < timeDomainData.length; index += 1) {
      const normalized = (timeDomainData[index] - 128) / 128;
      sumOfSquares += normalized * normalized;
    }
    return Math.sqrt(sumOfSquares / timeDomainData.length);
  }

  private computePeakFrequency(frequencyData: Uint8Array<ArrayBuffer>): number {
    if (this.audioContext === null || frequencyData.length === 0) {
      return 0;
    }
    let peakIndex = 0;
    let peakValue = 0;
    for (let index = 0; index < frequencyData.length; index += 1) {
      if (frequencyData[index] > peakValue) {
        peakValue = frequencyData[index];
        peakIndex = index;
      }
    }
    const binWidthHz = this.audioContext.sampleRate / ANALYSER_FFT_SIZE;
    return peakIndex * binWidthHz;
  }

  private computeBandEnergy(
    frequencyData: Uint8Array<ArrayBuffer>,
    lowHz: number,
    highHz: number
  ): number {
    if (this.audioContext === null || frequencyData.length === 0) {
      return 0;
    }
    const binWidthHz = this.audioContext.sampleRate / ANALYSER_FFT_SIZE;
    const startBin = Math.max(0, Math.floor(lowHz / binWidthHz));
    const endBin = Math.min(frequencyData.length - 1, Math.ceil(highHz / binWidthHz));
    if (endBin < startBin) {
      return 0;
    }
    let sum = 0;
    for (let index = startBin; index <= endBin; index += 1) {
      sum += frequencyData[index];
    }
    return sum / ((endBin - startBin + 1) * 255);
  }
}
