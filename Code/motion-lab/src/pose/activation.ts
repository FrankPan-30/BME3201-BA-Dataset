import { rmsEnvelope, type BaChannel, type BaSignal } from '../baSignal';
import { channels } from '../model';
import { activationSmoothingMs } from './poseConfig';

export type ActivationReader = (channel: BaChannel, atMs: number) => number | null;
export const noActivation: ActivationReader = () => null;

export function createActivationReader(signal: BaSignal | null): ActivationReader {
  if (!signal?.thresholdMv) return noActivation;
  const intensity = new Map<BaChannel, Float32Array>();
  const alpha = 1 - Math.exp(-1000 / (activationSmoothingMs * signal.rate));
  for (const channel of channels) {
    const threshold = signal.thresholdMv[channel];
    const values = signal.values[channel];
    if (threshold === undefined || !Number.isFinite(threshold) || threshold <= 0 || !values) continue;
    let value = 0;
    intensity.set(channel, Float32Array.from(rmsEnvelope(values, signal.rate), (rms) => {
      if (!Number.isFinite(rms)) { value = 0; return NaN; }
      value += (Math.min(1, rms / threshold) - value) * alpha;
      return value;
    }));
  }
  return (channel, atMs) => {
    const index = Math.round((atMs - signal.originMs) / 1000 * signal.rate);
    const value = intensity.get(channel)?.[index];
    return value !== undefined && Number.isFinite(value) ? value : null;
  };
}
