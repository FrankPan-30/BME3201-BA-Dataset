import { segmentIds, toSample, type Orientations, type PoseFrame, type PoseSource, type SegmentId, type SegmentQuats, type Side, type Status } from './PoseSource.ts';
import { calibrationToleranceDeg, interpolationGapSec } from './poseConfig.ts';
import { applyCalibration, calibrate, meanQuat, normalizeQuat, slerp, type Calibration } from './poseMath.ts';
import { jointAngles } from './jointAngles.ts';

export type PoseRow = { t: number; q: Orientations };
export type RestWindow = readonly [start: number, end: number];
export type PoseCalibrationInput = { neutral?: SegmentQuats; offsets?: SegmentQuats };
export type CalibrationResult = { calibration: Calibration | null; calibrationWarning: boolean };
export type PoseRecord = { trialId: string; side: Side; samples: PoseRow[]; calibration?: PoseCalibrationInput };

export function object(input: unknown) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Expected an object');
  return input as Record<string, unknown>;
}
export function readSide(value: unknown): Side {
  if (value !== 'left' && value !== 'right') throw new Error('Invalid arm side');
  return value;
}
export function readOrientations(raw: unknown): Orientations {
  const input = object(raw);
  const output: Orientations = {};
  for (const id of segmentIds) {
    const value = input[id];
    if (value === undefined || value === null) continue;
    if (!Array.isArray(value) || !value.every((item) => typeof item === 'number')) throw new Error('Invalid ' + id + ' quaternion');
    const q = normalizeQuat(value);
    if (!q || Math.abs(Math.hypot(...value) - 1) > .02) throw new Error('Expected a unit quaternion for ' + id);
    output[id] = q;
  }
  return output;
}
function readComplete(value: unknown): SegmentQuats | undefined {
  if (value === undefined) return undefined;
  const { trunk, upperArm, forearm } = readOrientations(value);
  if (!trunk || !upperArm || !forearm) throw new Error('Incomplete calibration');
  return { trunk, upperArm, forearm };
}
export function readCalibration(value: unknown): PoseCalibrationInput | undefined {
  if (value === undefined) return undefined;
  const input = object(value);
  const neutral = readComplete(input.neutral);
  const offsets = readComplete(input.offsets);
  if (!neutral && !offsets) throw new Error('Missing calibration input');
  return { neutral, offsets };
}
export function readPoseRow(value: unknown): PoseRow {
  const input = object(value);
  if (typeof input.t !== 'number' || !Number.isFinite(input.t)) throw new Error('Invalid timestamp');
  return { t: input.t, q: readOrientations(input.q) };
}

export function parsePoseRecord(value: unknown, expectedTrial: string): PoseRecord {
  const input = object(value);
  if (input.schema !== 'motion-lab-imu/v1' || input.trialId !== expectedTrial || !Array.isArray(input.samples)) {
    throw new Error('IMU record does not match the selected BA trial');
  }
  const side = readSide(input.side);
  const calibration = readCalibration(input.calibration);
  const samples = input.samples.map(readPoseRow);
  for (let i = 1; i < samples.length; i++) {
    if (samples[i].t <= samples[i - 1].t) throw new Error('Timestamps must increase');
  }
  return { trialId: expectedTrial, side, samples, calibration };
}

export function seekPoseFrame(
  t: number, rows: readonly PoseRow[], inventory: ReadonlySet<SegmentId>,
  getBounds: (t: number) => [PoseRow | undefined, PoseRow | undefined] = (time) => {
    let low = 0;
    let high = rows.length;
    while (low < high) {
      const mid = low + Math.floor((high - low) / 2);
      if (rows[mid].t < time) low = mid + 1;
      else high = mid;
    }
    return [rows[low - 1], rows[low]];
  },
): PoseFrame {
  const [before, after] = getBounds(t);
  const q: Orientations = {};
  const status = {} as Status;
  for (const id of segmentIds) {
    const left = before?.q[id];
    const right = after?.q[id];
    if (after && Math.abs(after.t - t) < 1e-8) q[id] = right;
    else if (before && Math.abs(before.t - t) < 1e-8) q[id] = left;
    else if (left && right && before && after && after.t - before.t <= interpolationGapSec) {
      q[id] = slerp(left, right, (t - before.t) / (after.t - before.t));
    }
    status[id] = q[id] ? 'ok' : inventory.has(id) ? 'lost' : 'missing';
  }
  return { t, q, status };
}

export function checkCalibration(
  rows: readonly PoseRow[], side: Side, rest?: RestWindow, inputs?: PoseCalibrationInput,
): CalibrationResult {
  const quiet = rest ? rows.filter((row) => row.t >= rest[0] && row.t < rest[1]) : [];
  const means = Object.fromEntries(segmentIds.map((id) => {
    const values = quiet.map((row) => row.q[id]).filter((q) => q !== undefined);
    return [id, meanQuat(values)];
  }));
  const reference = inputs?.neutral ?? (segmentIds.every((id) => means[id]) ? means as SegmentQuats : null);
  if (!reference) return { calibration: null, calibrationWarning: false };
  const calibration = calibrate(reference, side, inputs?.offsets);
  const expectations = { abduction: 0, flexion: 0, elbow: 90, trunkTilt: 0 } as const;
  const checks = [...quiet, { t: 0, q: reference }];
  const calibrationWarning = checks.some(({ q }) => {
    const angles = jointAngles(applyCalibration(q, calibration.offsets), side, calibration.heading);
    return Object.entries(expectations).some(([key, expected]) => {
      const value = angles[key as keyof typeof expectations];
      return value !== null && Math.abs(value - expected) > calibrationToleranceDeg;
    });
  });
  return { calibration, calibrationWarning };
}

export function createRecordedPose(record: PoseRecord, rest?: RestWindow) {
  const known = new Set(segmentIds.filter((id) => record.samples.some((sample) => sample.q[id])));
  const status = Object.fromEntries(segmentIds.map((id) => [id, known.has(id) ? 'ok' : 'missing'])) as Status;
  const getFrameAt = (t: number) => seekPoseFrame(t, record.samples, known);
  const source: PoseSource = {
    hasData: known.size > 0, side: record.side, status, getFrameAt, getPoseAt: (t) => toSample(getFrameAt(t)),
  };
  return { source, ...checkCalibration(record.samples, record.side, rest, record.calibration) };
}
