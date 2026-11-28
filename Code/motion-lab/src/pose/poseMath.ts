import type { Orientations, Quat, SegmentQuats, Side } from './PoseSource.ts';
import { armDimensions } from './poseConfig.ts';

export type Vec3 = [number, number, number];
export const identity: Quat = [1, 0, 0, 0];
/**
 * BA seated neutral: the trunk is upright with yaw taken from the trunk IMU's forward axis,
 * the upper arm hangs along trunk -Z, and the forearm points along trunk +X on the desk.
 * Segment local -Z is the distal axis. Change these targets to suit another lab setup.
 */
export const neutralPose = {
  distal: [0, 0, -1] as Vec3,
  upperArm: identity,
  forearm: [Math.SQRT1_2, 0, -Math.SQRT1_2, 0] as Quat,
};
export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const scale = (p: Vec3, n: number): Vec3 => [p[0] * n, p[1] * n, p[2] * n];
export const sideSign = (side: Side) => side === 'left' ? 1 : -1;
export const clampUnit = (n: number) => Math.max(-1, Math.min(1, n));

export function normalizeQuat(input: readonly number[]): Quat | null {
  if (input.length !== 4 || !input.every(Number.isFinite)) return null;
  const length = Math.hypot(...input);
  if (!Number.isFinite(length) || length < 1e-8) return null;
  return input.map((n) => n / length) as Quat;
}

export const conjugate = ([w, x, y, z]: Quat): Quat => [w, -x, -y, -z];
export function multiply(a: Quat, b: Quat): Quat {
  const [w, x, y, z] = a;
  const [v, i, j, k] = b;
  return [w * v - x * i - y * j - z * k, w * i + x * v + y * k - z * j,
    w * j - x * k + y * v + z * i, w * k + x * j - y * i + z * v];
}

export function rotate(q: Quat, p: Vec3): Vec3 {
  const [, x, y, z] = multiply(multiply(q, [0, ...p]), conjugate(q));
  return [x, y, z];
}

export function axisAngle(axis: Vec3, radians: number): Quat {
  const sine = Math.sin(radians / 2);
  return [Math.cos(radians / 2), ...scale(axis, sine)];
}

export function slerp(a: Quat, b: Quat, alpha: number): Quat {
  const similarity = a.reduce((sum, value, index) => sum + value * b[index], 0);
  const sign = similarity < 0 ? -1 : 1;
  const cosine = clampUnit(Math.abs(similarity));
  if (cosine > .9995) return normalizeQuat(a.map((value, i) => value * (1 - alpha) + b[i] * sign * alpha)) ?? a;
  const theta = Math.acos(cosine);
  const weightA = Math.sin((1 - alpha) * theta) / Math.sin(theta);
  const weightB = Math.sin(alpha * theta) * sign / Math.sin(theta);
  return normalizeQuat(a.map((value, i) => value * weightA + b[i] * weightB)) ?? a;
}

export function meanQuat(values: readonly Quat[]): Quat | null {
  if (!values.length) return null;
  // Align antipodal representations before averaging a short, quiet calibration window.
  const first = values[0];
  const mean = [0, 0, 0, 0];
  for (const q of values) {
    const sign = q.reduce((sum, value, i) => sum + value * first[i], 0) < 0 ? -1 : 1;
    q.forEach((value, i) => { mean[i] += value * sign; });
  }
  return normalizeQuat(mean);
}

/** One proper rotation, -90° about X, maps the Z-up scene to Three Y-up. */
export const toThreeVector = ([x, y, z]: Vec3): Vec3 => [x, z, -y];
/** Basis change C q C⁻¹ in Three's (x,y,z,w) constructor order. */
export const toThreeQuaternion = ([w, x, y, z]: Quat): [number, number, number, number] => [x, z, -y, w];

export function horizontalHeading(reference: Quat): Quat {
  const [x, y] = rotate(reference, [1, 0, 0]);
  if (Math.hypot(x, y) < .1) {
    const [leftX, leftY] = rotate(reference, [0, 1, 0]);
    return axisAngle([0, 0, 1], Math.atan2(-leftX, leftY));
  }
  return axisAngle([0, 0, 1], Math.atan2(y, x));
}

export type Calibration = { offsets: SegmentQuats; heading: Quat; deskZ: number };
export function applyCalibration(q: Orientations, offsets: SegmentQuats): Orientations {
  return {
    trunk: q.trunk && multiply(q.trunk, offsets.trunk),
    upperArm: q.upperArm && multiply(q.upperArm, offsets.upperArm),
    forearm: q.forearm && multiply(q.forearm, offsets.forearm),
  };
}

export function jointPositions(q: Orientations, side: Side) {
  const offset: Vec3 = [0, sideSign(side) * armDimensions.shoulderLateral, armDimensions.shoulderHeight];
  const shoulder = q.trunk ? rotate(q.trunk, offset) : null;
  const elbow = shoulder && q.upperArm
    ? add(shoulder, scale(rotate(q.upperArm, neutralPose.distal), armDimensions.upperArm)) : null;
  const wrist = elbow && q.forearm
    ? add(elbow, scale(rotate(q.forearm, neutralPose.distal), armDimensions.upperArm * armDimensions.forearmRatio)) : null;
  return { shoulder, elbow, wrist };
}

export function calibrate(reference: SegmentQuats, side: Side, suppliedOffsets?: SegmentQuats): Calibration {
  // A supplied sensor-to-segment offset takes priority. Quiet-window bias/yaw correction belongs upstream.
  const heading = horizontalHeading(suppliedOffsets ? multiply(reference.trunk, suppliedOffsets.trunk) : reference.trunk);
  const offsets = suppliedOffsets ?? {
    trunk: multiply(conjugate(reference.trunk), heading),
    upperArm: multiply(conjugate(reference.upperArm), multiply(heading, neutralPose.upperArm)),
    forearm: multiply(conjugate(reference.forearm), multiply(heading, neutralPose.forearm)),
  };
  const deskZ = jointPositions(applyCalibration(reference, offsets), side).wrist![2];
  return { offsets, heading, deskZ };
}
