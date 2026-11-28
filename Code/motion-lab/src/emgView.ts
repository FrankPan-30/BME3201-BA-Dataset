import { channels, duration } from './model';

const rate = 512;
const sampleCount = duration * rate;
const windowSize = 256;
const frequencyStep = rate / windowSize;
const threshold = 0.14;
const traceWidth = 1000;
const bandCount = 113;
export const channelColors = ['#4F5BD5', '#8A6FD8', '#3FA7D6', '#E0A458', '#4F5BD5', '#8A6FD8'];

const gaussian = (time: number, middle: number, width: number) =>
  Math.exp(-0.5 * ((time - middle) / width) ** 2);

export function channelStatus(channel: number, time: number) {
  if (channel === 5 && time >= 10.1 && time < 10.85) return 'channelOff';
  if (channel === 4 && time >= 6.4 && time < 7.2) return 'channelPoor';
  return 'channelOkay';
}

function emg(time: number, channel: number) {
  const state = channelStatus(channel, time);
  if (state === 'channelOff') return 0;
  const envelope = 0.022 + (0.30 + channel * 0.033) * gaussian(time, 3.8 + channel * 0.06, 0.61)
    + (0.68 - channel * 0.060) * gaussian(time, 6.9 - channel * 0.11, 0.96)
    + 0.19 * gaussian(time, 11.9 + channel * 0.13, 0.72)
    + 0.11 * gaussian(time, 4.96, 0.17);
  const phase = 2 * Math.PI * time;
  const oscillation = 0.63 * Math.sin(phase * (62 + channel * 5.4) + 2.6 * Math.sin(time * 8))
    + 0.25 * Math.sin(phase * (95 + channel * 7.3))
    + 0.12 * Math.cos(phase * (149 + channel * 8.1) + 2 * Math.sin(time * 11));
  return envelope * oscillation + (state === 'channelPoor' ? 0.05 * Math.sin(time * 137) : 0);
}

const basis = Array.from({ length: bandCount }, (_, bin) => {
  const point = (index: number) => 2 * Math.PI * bin * index / windowSize;
  const taper = (index: number) => 0.5 - 0.5 * Math.cos(2 * Math.PI * index / (windowSize - 1));
  return {
    cosine: Float64Array.from({ length: windowSize }, (_, i) => taper(i) * Math.cos(point(i))),
    sine: Float64Array.from({ length: windowSize }, (_, i) => taper(i) * Math.sin(point(i))),
  };
});

function powerSums(input: Float64Array) {
  const snapshots = [new Float64Array(bandCount)];
  for (let start = 0; start + windowSize <= input.length; start += windowSize) {
    const previous = snapshots[snapshots.length - 1];
    const next = Float64Array.from(previous);
    for (let bin = 0; bin < bandCount; bin++) {
      const { cosine, sine } = basis[bin];
      let real = 0;
      let imaginary = 0;
      for (let i = 0; i < windowSize; i++) {
        real += input[start + i] * cosine[i];
        imaginary += input[start + i] * sine[i];
      }
      next[bin] += real * real + imaginary * imaginary;
    }
    snapshots.push(next);
  }
  return snapshots;
}

const position = (index: number) => (index / (sampleCount - 1) * traceWidth).toFixed(1);

function generateTrack(channel: number) {
  const raw = Float64Array.from({ length: sampleCount }, (_, i) => emg(i / rate, channel));
  const squares = new Float64Array(sampleCount + 1);
  const absolute = new Float64Array(sampleCount + 1);
  for (let i = 0; i < raw.length; i++) {
    squares[i + 1] = squares[i] + raw[i] * raw[i];
    absolute[i + 1] = absolute[i] + Math.abs(raw[i]);
  }

  const rmsCurve = Float64Array.from({ length: sampleCount }, (_, i) => {
    const end = i + 1;
    const start = Math.max(0, end - Math.round(rate * 0.16));
    return Math.sqrt((squares[end] - squares[start]) / (end - start));
  });

  const bands: { from: number; to: number }[] = [];
  let pending: number | null = null;
  for (let i = 0; i < rmsCurve.length; i++) {
    if (rmsCurve[i] >= threshold && pending === null) pending = i;
    if (rmsCurve[i] < threshold && pending !== null) {
      if (i - pending >= rate * 0.11) bands.push({ from: pending / rate, to: i / rate });
      pending = null;
    }
  }
  if (pending !== null) bands.push({ from: pending / rate, to: duration });

  const rawPoints: string[] = [];
  for (let start = 0; start < raw.length; start += 8) {
    let min = start;
    let max = start;
    for (let i = start + 1; i < Math.min(start + 8, raw.length); i++) {
      if (raw[i] < raw[min]) min = i;
      if (raw[i] > raw[max]) max = i;
    }
    const indices = min < max ? [min, max] : [max, min];
    for (const i of indices) rawPoints.push((rawPoints.length ? 'L' : 'M') + position(i) + ',' + (20 - raw[i] * 20).toFixed(2));
  }
  const envelope = Array.from({ length: 1100 }, (_, i) => {
    const sample = Math.round(i / 1099 * (sampleCount - 1));
    return (i ? 'L' : 'M') + position(sample) + ',' + (20 - rmsCurve[sample] * 20).toFixed(2);
  }).join(' ');

  return { path: rawPoints.join(' '), envelope, bands, squares, absolute, powers: powerSums(raw) };
}

export const emgTracks = channels.map((_, index) => generateTrack(index));
export const thresholdY = 20 - threshold * 20;

export function monitorAt(channel: number, time: number) {
  const track = emgTracks[channel];
  const samples = Math.min(sampleCount, Math.max(0, Math.floor(time * rate)));
  if (samples === 0) return { rms: null, mav: null, median: null, activations: 0, power: track.powers[0] };

  const power = track.powers[Math.floor(samples / windowSize)];
  const total = power.reduce((sum, value) => sum + value, 0);
  let running = 0;
  let median: number | null = null;
  if (total > 0) {
    for (let bin = 0; bin < power.length; bin++) {
      running += power[bin];
      if (running >= total / 2) {
        median = bin * frequencyStep;
        break;
      }
    }
  }
  return {
    rms: Math.sqrt(track.squares[samples] / samples),
    mav: track.absolute[samples] / samples,
    median,
    activations: track.bands.filter((band) => band.from <= time).length,
    power,
  };
}

export function spectrumPath(power: Float64Array) {
  const peak = Math.max(...power);
  if (peak === 0) return '';
  return Array.from(power, (value, index) => {
    const x = index / (power.length - 1) * 640;
    const db = Math.max(-60, 10 * Math.log10(value / peak));
    const y = -db / 60 * 184;
    return (index ? 'L' : 'M') + x.toFixed(1) + ',' + y.toFixed(1);
  }).join(' ');
}

