/** Seconds in the record use Events.Start as their origin. Positive offset moves IMU samples later on this axis. */
export const imuTimeOffsetMs = 0;
export const interpolationGapSec = .20;
export const activationSmoothingMs = 100;
export const calibrationToleranceDeg = 10;
export const readoutsPerSecond = 15;
export const maxPoseFramesPerSecond = 60;
export const livePoseConfig = {
  bufferSeconds: 15, maxSamples: 8192, dropoutMs: 500, pollMs: 40, playbackDelaySec: .080,
  readChunkBytes: 64 * 1024, maxLineBytes: 64 * 1024,
} as const;

/** Illustration proportions in model units. Anatomical placement is in the trunk's X-forward, Y-left, Z-up coordinates. */
export const armDimensions = {
  trunkHeight: .91, trunkWidth: .51, trunkDepth: .31,
  shoulderHeight: .36, shoulderLateral: .29, upperArm: .51, forearmRatio: .8,
  upperRadius: .083, forearmRadius: .066, jointRadius: .084,
} as const;
