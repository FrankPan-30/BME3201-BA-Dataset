import { baPhases, type BaEvent, type BaPhase } from '../ba.ts';
import { segmentIds, toSample, type PoseSource, type SegmentId, type Side, type Status } from './PoseSource.ts';
import { livePoseConfig } from './poseConfig.ts';
import { object, readCalibration, readPoseRow, readSide, seekPoseFrame, type PoseRow, type PoseCalibrationInput, type RestWindow } from './poseRecord.ts';

export type LiveHeader = { side: Side; segments: SegmentId[]; calibration?: PoseCalibrationInput; rest?: RestWindow };
export type LivePacket = { type: 'pose'; pose: PoseRow } | { type: 'event'; event: BaEvent };

export function readLiveHeader(value: unknown): LiveHeader {
  const h = object(value);
  if (h.schema !== 'motion-lab-imu-live/v1' || !Array.isArray(h.segments) ||
      !h.segments.length || !h.segments.every((id) => segmentIds.includes(id))) throw new Error('Invalid live IMU header');
  let rest: RestWindow | undefined;
  if (h.rest !== undefined) {
    if (!Array.isArray(h.rest) || h.rest.length !== 2 || !h.rest.every(Number.isFinite) || h.rest[1] <= h.rest[0]) {
      throw new Error('Invalid live rest interval');
    }
    rest = [h.rest[0], h.rest[1]];
  }
  return { side: readSide(h.side), segments: [...new Set(h.segments as SegmentId[])], rest, calibration: readCalibration(h.calibration) };
}

export function readLivePacket(value: unknown): LivePacket {
  const row = object(value);
  const isPhase = row.kind === 'phase-start' || row.kind === 'phase-end';
  if (isPhase || row.kind === 'trial-end') {
    if (typeof row.t !== 'number' || !Number.isFinite(row.t)) throw new Error('Invalid event timestamp');
    const atMs = Math.round(row.t * 1000);
    if (row.kind === 'trial-end') return { type: 'event', event: { kind: 'trial-end', atMs } };
    if (!baPhases.includes(row.phase as BaPhase)) throw new Error('Invalid movement phase');
    return { type: 'event', event: { kind: row.kind as 'phase-start' | 'phase-end', phase: row.phase as BaPhase, atMs } };
  }
  return { type: 'pose', pose: readPoseRow(row) };
}

export function createLivePose(
  side: Side, segments: readonly SegmentId[], now = () => performance.now(),
  config: { bufferSeconds: number; maxSamples: number; dropoutMs: number; playbackDelaySec: number } = livePoseConfig,
) {
  const inventory = new Set(segments);
  const capacity = config.maxSamples;
  const buffer = new Array<PoseRow>(capacity);
  const seen: Partial<Record<SegmentId, number>> = {};
  let first = 0;
  let count = 0;
  let latestAt = -Infinity;
  let displayedTime = -Infinity;

  const rowAt = (i: number) => i >= 0 && i < count ? buffer[(first + i) % capacity] : undefined;
  const newest = () => rowAt(count - 1);
  const onlineStatus = (): Status => Object.fromEntries(segmentIds.map((id) => [
    id, !inventory.has(id) ? 'missing' : (now() - (seen[id] ?? -Infinity) <= config.dropoutMs ? 'ok' : 'lost'),
  ])) as Status;

  function getFrameAt(t: number) {
    const frame = seekPoseFrame(t, [], inventory, (time) => {
      let low = 0;
      let high = count;
      while (low < high) {
        const pivot = low + Math.floor((high - low) / 2);
        if (rowAt(pivot)!.t < time) low = pivot + 1;
        else high = pivot;
      }
      return [rowAt(low - 1), rowAt(low)];
    });
    const status = onlineStatus();
    for (const id of segmentIds) {
      if (status[id] !== 'ok') {
        frame.status[id] = status[id];
        delete frame.q[id];
      }
    }
    return frame;
  }

  const source: PoseSource = {
    side,
    get hasData() { return Object.values(seen).length > 0; },
    get status() { return onlineStatus(); },
    getFrameAt,
    getPoseAt: (t) => toSample(getFrameAt(t)),
  };

  return {
    source,
    push(row: PoseRow) {
      if (row.t <= (newest()?.t ?? -Infinity)) return false;
      const q = Object.fromEntries(segments.flatMap((id) => row.q[id] ? [[id, row.q[id]]] : []));
      const currentTime = now();
      for (const id of segments) if (q[id]) seen[id] = currentTime;
      if (count === capacity) { first = (first + 1) % capacity; count--; }
      buffer[(first + count) % capacity] = { t: row.t, q };
      count++;
      while (count > 1 && row.t - rowAt(0)!.t > config.bufferSeconds) {
        first = (first + 1) % capacity;
        count--;
      }
      latestAt = currentTime;
      return true;
    },
    time() {
      const last = newest();
      if (!last) return null;
      const age = Math.max(0, now() - latestAt);
      displayedTime = Math.max(displayedTime, rowAt(0)!.t, Math.min(last.t, last.t + age / 1000 - config.playbackDelaySec));
      return { t: displayedTime, running: age <= config.dropoutMs };
    },
    rows() {
      return Array.from({ length: count }, (_, index) => rowAt(index)!);
    },
  };
}
