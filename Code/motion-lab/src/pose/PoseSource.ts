export const segmentIds = ['trunk', 'upperArm', 'forearm'] as const;
export type SegmentId = typeof segmentIds[number];
export type SegmentStatus = 'ok' | 'lost' | 'missing';
export type Side = 'left' | 'right';
/** Unit quaternion, scalar first. Maps sensor coordinates to gravity-aligned, Z-up world coordinates. */
export type Quat = [w: number, x: number, y: number, z: number];
export type SegmentQuats = Record<SegmentId, Quat>;
export type Orientations = Partial<SegmentQuats>;
export type Status = Record<SegmentId, SegmentStatus>;

export interface PoseSample { t: number; q: SegmentQuats }
export interface PoseFrame { t: number; q: Orientations; status: Status }

export interface PoseSource {
  readonly hasData: boolean;
  readonly status: Status;
  readonly side: Side;
  getPoseAt(t: number): PoseSample | null;
  getFrameAt(t: number): PoseFrame;
}

export const missingStatus: Status = { trunk: 'missing', upperArm: 'missing', forearm: 'missing' };
export function toSample({ t, q }: PoseFrame): PoseSample | null {
  const { trunk, upperArm, forearm } = q;
  return trunk && upperArm && forearm ? { t, q: { trunk, upperArm, forearm } } : null;
}

export const emptyPoseSource: PoseSource = {
  hasData: false, side: 'right', status: missingStatus,
  getPoseAt: () => null,
  getFrameAt: (t) => ({ t, q: {}, status: missingStatus }),
};
