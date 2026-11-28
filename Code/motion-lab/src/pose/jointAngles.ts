import type { Orientations, Quat, Side } from './PoseSource.ts';
import { clampUnit, conjugate, dot, identity, neutralPose, normalizeQuat, rotate, sideSign } from './poseMath.ts';

const degrees = (radians: number) => radians * (180 / Math.PI);
const projection = (component: number, vertical: number) =>
  Math.hypot(component, vertical) < 1e-7 ? null : degrees(Math.atan2(component, vertical));

export type JointAngles = {
  abduction: number | null; flexion: number | null; elbow: number | null;
  trunkForward: number | null; trunkLateral: number | null; trunkTilt: number | null;
};
export const emptyAngles: JointAngles = {
  abduction: null, flexion: null, elbow: null, trunkForward: null, trunkLateral: null, trunkTilt: null,
};

/** Simplified projected angles, in degrees. A collapsed projection has no defined angle. */
export function jointAngles(pose: Orientations, side: Side, neutralHeading: Quat = identity): JointAngles {
  const trunk = pose.trunk && normalizeQuat(pose.trunk);
  const upper = pose.upperArm && normalizeQuat(pose.upperArm);
  const lower = pose.forearm && normalizeQuat(pose.forearm);
  const u = upper && rotate(upper, neutralPose.distal);
  const f = lower && rotate(lower, neutralPose.distal);
  const local = trunk && u ? rotate(conjugate(trunk), u) : null;
  const up = trunk ? rotate(conjugate(neutralHeading), rotate(trunk, [0, 0, 1])) : null;
  return {
    abduction: local ? projection(local[1] * sideSign(side), -local[2]) : null,
    flexion: local ? projection(local[0], -local[2]) : null,
    elbow: u && f ? degrees(Math.acos(clampUnit(dot(u, f)))) : null,
    trunkForward: up ? projection(up[0], up[2]) : null,
    trunkLateral: up ? projection(up[1], up[2]) : null,
    trunkTilt: up ? degrees(Math.acos(clampUnit(up[2]))) : null,
  };
}
