import type { BaRecord } from '../ba';
import { toSample, type PoseFrame, type PoseSource, type Side } from './PoseSource.ts';
import { axisAngle, calibrate, identity, multiply, neutralPose, sideSign } from './poseMath.ts';

const ok = { trunk: 'ok', upperArm: 'ok', forearm: 'ok' } as const;
const rad = (degrees: number) => degrees / 180 * Math.PI;
const smooth = (x: number) => x * x * (3 - 2 * x);
const neutral = { trunk: identity, upperArm: neutralPose.upperArm, forearm: neutralPose.forearm };

export function createMockPose(record: BaRecord, side: Side) {
  const edge = (index: number, fallback: number) => (record.phases[index]?.startMs ?? fallback) / 1000;
  const start = edge(1, 0);
  const lift = edge(2, start * 1000 + (record.endMs - start * 1000) * .42);
  const end = record.endMs / 1000;
  const back = edge(3, lift * 1000 + (record.endMs - lift * 1000) * .53);
  // Time, shoulder flexion, outward abduction, elbow flexion, trunk forward lean.
  const keys = [
    [record.originMs / 1000, 0, 0, 90, 0], [start, 0, 0, 90, 0],
    [lift, 61, 12, 25, 4], [lift + (back - lift) * .45, 73, 34, 47, 6],
    [back, 52, 27, 58, 3], [end, 0, 0, 90, 0],
  ];

  function getFrameAt(t: number): PoseFrame {
    let next = keys.findIndex((key) => key[0] > t);
    if (next < 0) next = keys.length - 1;
    const a = keys[Math.max(0, next - 1)];
    const b = keys[next];
    const f = a[0] === b[0] ? 0 : smooth(Math.max(0, Math.min(1, (t - a[0]) / (b[0] - a[0]))));
    const at = (i: number) => rad(a[i] + (b[i] - a[i]) * f);
    const trunk = axisAngle([0, 1, 0], at(4));
    const upperArm = multiply(trunk, multiply(axisAngle([0, 1, 0], -at(1)), axisAngle([1, 0, 0], sideSign(side) * at(2))));
    const forearm = multiply(upperArm, axisAngle([0, 1, 0], -at(3)));
    return { t, q: { trunk, upperArm, forearm }, status: ok };
  }
  const source: PoseSource = { hasData: true, status: ok, side, getFrameAt, getPoseAt: (t) => toSample(getFrameAt(t)) };
  return { source, calibration: calibrate(neutral, side), calibrationWarning: false };
}
