/// <reference types="vite/client" />
import rawAsset from './ba-samples.b64?raw';
import { channels } from './model';

export type BaChannel = typeof channels[number];
export type BaSignal = {
  id: string;
  trialId: string;
  replayBlob: string;
  rate: number;
  originMs: number;
  count: number;
  thresholdMv?: Readonly<Partial<Record<BaChannel, number>>>;
  values: Readonly<Partial<Record<BaChannel, Float64Array>>>;
};

const waveChannels = ['BB', 'TB', 'AD', 'MD'] as const;
const count = 10296;
const decoded = Uint8Array.from(atob(rawAsset), (character) => character.charCodeAt(0));
if (decoded.byteLength !== waveChannels.length * count * 8) throw new Error('Incomplete BA EMG asset');
const view = new DataView(decoded.buffer);
const values = Object.fromEntries(waveChannels.map((channel, row) => [
  channel,
  Float64Array.from({ length: count }, (_, index) => view.getFloat64((row * count + index) * 8, true)),
])) as Record<typeof waveChannels[number], Float64Array>;

const st09: BaSignal = {
  id: 'ba-st09-01',
  trialId: 'ST09-BA-paretic-01',
  replayBlob: '9117a3ca4bbab32127285f06d78c4cbf9bf8e1e8',
  rate: 1000,
  originMs: -504,
  count,
  values,
};

export function baSignal(id: string | null, trialId: string) {
  return id === st09.id && trialId === st09.trialId ? st09 : null;
}

export function rmsEnvelope(samples: Float64Array, rate: number) {
  const span = Math.max(1, Math.round(0.05 * rate));
  const half = Math.floor(span / 2);
  const sum = new Float64Array(samples.length + 1);
  const valid = new Uint32Array(samples.length + 1);
  for (let index = 0; index < samples.length; index++) {
    const sample = samples[index];
    const finite = Number.isFinite(sample);
    sum[index + 1] = sum[index] + (finite ? sample * sample : 0);
    valid[index + 1] = valid[index] + Number(finite);
  }
  return Float64Array.from(samples, (_, index) => {
    const left = Math.max(0, index - half);
    const right = Math.min(samples.length, index - half + span);
    return valid[right] - valid[left] === right - left
      ? Math.sqrt(Math.max(0, (sum[right] - sum[left]) / (right - left)))
      : NaN;
  });
}

export type WaveformTrack = {
  raw: Float64Array;
  rms: Float64Array;
  peak: number;
  threshold: number | null;
};

export function waveformTrack(samples: Float64Array, rate: number, threshold?: number): WaveformTrack {
  const validThreshold = threshold !== undefined && Number.isFinite(threshold) && threshold > 0 ? threshold : null;
  const max = samples.reduce((peak, sample) => Number.isFinite(sample) ? Math.max(peak, Math.abs(sample)) : peak, validThreshold ?? 0);
  const peak = max > 0 ? Number(max.toPrecision(3)) * 1.06 : 1;
  return { raw: samples, rms: rmsEnvelope(samples, rate), peak, threshold: validThreshold };
}

const basis = new Map<number, { cosine: Float64Array; sine: Float64Array }[]>();
function spectralPower(samples: Float64Array) {
  if (samples.length < 32) return null;
  const size = Math.min(512, 2 ** Math.floor(Math.log2(samples.length)));
  let weights = basis.get(size);
  if (!weights) {
    const taper = Float64Array.from({ length: size }, (_, index) =>
      0.5 - 0.5 * Math.cos(2 * Math.PI * index / (size - 1)));
    weights = Array.from({ length: size / 2 + 1 }, (_, bin) => {
      const phase = 2 * Math.PI * bin / size;
      return {
        cosine: Float64Array.from(taper, (value, index) => value * Math.cos(phase * index)),
        sine: Float64Array.from(taper, (value, index) => value * Math.sin(phase * index)),
      };
    });
    basis.set(size, weights);
  }

  const power = new Float64Array(weights.length);
  let windows = 0;
  for (let start = 0; start + size <= samples.length; start += size / 2) {
    const window = samples.subarray(start, start + size);
    if (!window.every(Number.isFinite)) continue;
    windows++;
    const mean = window.reduce((sum, value) => sum + value, 0) / size;
    for (let bin = 0; bin < weights.length; bin++) {
      const { cosine, sine } = weights[bin];
      let real = 0;
      let imaginary = 0;
      for (let index = 0; index < size; index++) {
        const sample = window[index] - mean;
        real += sample * cosine[index];
        imaginary += sample * sine[index];
      }
      const factor = bin === 0 || bin === size / 2 ? 1 : 2;
      power[bin] += factor * (real * real + imaginary * imaginary);
    }
  }
  return windows > 0 ? power : null;
}

export function baSignalMetrics(signal: BaSignal | null, channel: BaChannel, startMs: number, endMs: number) {
  const wave = signal?.values[channel];
  if (!signal || !wave || endMs <= startMs) return null;
  const first = Math.max(0, Math.ceil((startMs - signal.originMs) * signal.rate / 1000 - 1e-8));
  const last = Math.min(wave.length, Math.ceil((endMs - signal.originMs) * signal.rate / 1000 - 1e-8));
  const samples = wave.subarray(first, last);
  let finite = 0;
  let squares = 0;
  let absolute = 0;
  for (const sample of samples) {
    if (!Number.isFinite(sample)) continue;
    finite++;
    squares += sample * sample;
    absolute += Math.abs(sample);
  }
  if (!finite) return null;

  const power = spectralPower(samples);
  const total = power?.reduce((sum, value) => sum + value, 0) ?? 0;
  let median: number | null = null;
  if (power && total > 0) {
    let accumulated = 0;
    const bin = power.findIndex((value) => (accumulated += value) >= total / 2);
    if (bin >= 0) median = bin * (signal.rate / 2) / (power.length - 1);
  }

  const threshold = signal.thresholdMv?.[channel];
  let activations: number | null = null;
  if (threshold !== undefined) {
    activations = 0;
    const envelope = rmsEnvelope(wave, signal.rate);
    let above = first > 0 && envelope[first - 1] > threshold;
    for (const value of envelope.subarray(first, last)) {
      const next = value > threshold;
      if (next && !above) activations++;
      above = next;
    }
  }
  return { rms: Math.sqrt(squares / finite), mav: absolute / finite, median, activations, power };
}

