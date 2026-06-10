const DECAY_FLOOR_GAIN = -6.907755278982137;

export function createReverbImpulseResponse(
  context: BaseAudioContext,
  decaySeconds: number,
  preDelaySeconds: number
): AudioBuffer {
  const sampleRate = context.sampleRate;
  const preDelaySamples = Math.max(0, Math.floor(preDelaySeconds * sampleRate));
  const decaySamples = Math.max(1, Math.floor(decaySeconds * sampleRate));
  const totalSamples = preDelaySamples + decaySamples;
  const buffer = context.createBuffer(2, totalSamples, sampleRate);

  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let index = preDelaySamples; index < totalSamples; index += 1) {
      const progress = (index - preDelaySamples) / decaySamples;
      const envelope = Math.exp(DECAY_FLOOR_GAIN * progress);
      data[index] = (Math.random() * 2 - 1) * envelope;
    }
  }
  return buffer;
}
