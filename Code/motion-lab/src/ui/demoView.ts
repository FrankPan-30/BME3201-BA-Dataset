import { baPhases, createBaEvents, type BaEvent, type BaRecord } from '../ba';
import { baSignal, type BaChannel, type BaSignal } from '../baSignal';
import type { PoseData } from '../components/PosePanel';
import { toSample, type PoseFrame, type Side } from '../pose/PoseSource';
import { createMockPose } from '../pose/mockPose';
import { streamAvailable, type Gap, type Health, type Stream } from './liveFlow';

const reference = baSignal('ba-st09-01', 'ST09-BA-paretic-01')!;
export const demoBoundaries = [0, 900, 3850, 6800, 10296];
export const demoRecord: BaRecord = {
  id: 'ui-demo', method: 'ui-preview', originMs: 0, endMs: demoBoundaries[4], phaseBlob: '', trialBlob: '', signalId: null,
  phases: baPhases.map((code, index) => ({
    code, startMs: demoBoundaries[index], endMs: code === 'RETURN' ? null : demoBoundaries[index + 1], status: 'auto',
    startSource: 'ui-preview', endSource: 'ui-preview', notes: '',
  })),
};
const demoMotions: Record<Side, PoseData> = {
  right: createMockPose(demoRecord, 'right'),
  left: createMockPose(demoRecord, 'left'),
};
const lost = { trunk: 'lost', upperArm: 'lost', forearm: 'lost' } as const;
const thresholds: Partial<Record<BaChannel, number>> = { BB: .026, TB: .023, AD: .034, MD: .031 };
const phases = createBaEvents(demoRecord).filter((event) => event.kind !== 'trial-end');

export const hasGap = (gaps: readonly Gap[], stream: Stream, at: number) =>
  gaps.some((gap) => gap.stream === stream && at >= gap.from && (gap.to === null || at < gap.to));

export function demoSignal(startMs: number, endMs: number, gaps: readonly Gap[], calibrated: boolean, enabled: boolean): BaSignal | null {
  if (!enabled) return null;
  const count = Math.max(1, Math.ceil((endMs - startMs) * reference.rate / 1000));
  const values = Object.fromEntries(Object.entries(reference.values).map(([code, samples]) => [
    code, Float64Array.from({ length: count }, (_, index) => {
      const timeMs = startMs + index * 1000 / reference.rate;
      return hasGap(gaps, 'emg', timeMs) ? NaN : samples[(Math.floor(timeMs * reference.rate / 1000) + 504) % samples.length];
    }),
  ]));
  return { ...reference, id: 'ui-demo', trialId: 'ui-demo', originMs: startMs, count, values, thresholdMv: calibrated ? thresholds : undefined };
}

export function demoPose(health: Health, gaps: readonly Gap[], recorded: boolean, stationary: boolean, duration?: number, side: Side = 'right'): PoseData {
  const demoMotion = demoMotions[side];
  const base = demoMotion.source;
  const present = recorded
    ? !gaps.some((gap) => gap.stream === 'imu' && gap.from <= 0 && (gap.to ?? Infinity) >= (duration ?? Infinity))
    : streamAvailable(health, 'imu');
  const getFrameAt = (t: number): PoseFrame => {
    if (!present || hasGap(gaps, 'imu', t * 1000)) return { t, q: {}, status: lost };
    return { ...base.getFrameAt(stationary ? 0 : t % (demoRecord.endMs / 1000)), t };
  };
  return { ...demoMotion, source: { ...base, hasData: present, getFrameAt, getPoseAt: (t) => toSample(getFrameAt(t)) } };
}

export function demoEvents(t: number, end?: number): BaEvent[] {
  const events: BaEvent[] = phases.filter((event) => event.atMs <= t);
  if (end !== undefined && t >= end) {
    if (end > demoBoundaries[3]) events.push({ kind: 'phase-end', phase: 'RETURN', atMs: end });
    events.push({ kind: 'trial-end', atMs: end });
  }
  return events;
}
