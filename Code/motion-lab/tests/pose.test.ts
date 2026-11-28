import test from 'node:test';
import assert from 'node:assert/strict';
import type { SegmentQuats } from '../src/pose/PoseSource.ts';
import { axisAngle, applyCalibration, calibrate, identity, jointPositions, neutralPose, rotate, toThreeQuaternion, toThreeVector } from '../src/pose/poseMath.ts';
import { jointAngles } from '../src/pose/jointAngles.ts';
import { createRecordedPose, parsePoseRecord, checkCalibration } from '../src/pose/poseRecord.ts';
import { extremaIndices } from '../src/waveReduction.ts';

const q: SegmentQuats = { trunk: identity, upperArm: identity, forearm: neutralPose.forearm };
const close = (actual: number | null, target: number) => {
  assert.notEqual(actual, null);
  assert.ok(Math.abs(actual! - target) < 1e-5, actual + ' != ' + target);
};

test('right-handed Z-up basis and scalar-last Three quaternion agree for vectors', () => {
  assert.deepEqual(toThreeVector([1, 2, 3]), [1, 3, -2]);
  const original = axisAngle([0, 0, 1], Math.PI / 2);
  const [x, y, z, w] = toThreeQuaternion(original);
  const transformed = rotate([w, x, y, z], toThreeVector([1, 0, 0]));
  toThreeVector(rotate(original, [1, 0, 0])).forEach((target, index) => close(transformed[index], target));
});

test('down, front raise, left/right side raise, extension and trunk tilt', () => {
  const rest = jointAngles(q, 'right');
  close(rest.abduction, 0);
  close(rest.flexion, 0);
  close(rest.elbow, 90);
  close(rest.trunkTilt, 0);
  const forward = axisAngle([0, 1, 0], -Math.PI / 2);
  const front = jointAngles({ ...q, upperArm: forward, forearm: forward }, 'right');
  close(front.flexion, 90);
  close(front.elbow, 0);
  assert.equal(front.abduction, null);
  for (const [side, sign] of [['left', 1], ['right', -1]] as const) {
    const raise = axisAngle([1, 0, 0], sign * Math.PI / 2);
    close(jointAngles({ ...q, upperArm: raise }, side).abduction, 90);
    const joints = jointPositions(q, side);
    assert.equal(Math.sign(joints.shoulder![1]), sign);
    close(joints.wrist![2], joints.elbow![2]);
  }
  const trunkLean = axisAngle([0, 1, 0], Math.PI / 6);
  const tilt = jointAngles({ trunk: trunkLean }, 'right');
  close(tilt.trunkForward, 30);
  close(tilt.trunkLateral, 0);
  assert.equal(tilt.elbow, null);
});

test('calibration yields neutral and warns on deviations from a supplied offset', () => {
  const frame = { trunk: axisAngle([0, 1, 0], .25), upperArm: axisAngle([0, 1, 0], -.35), forearm: identity };
  const neutral = jointAngles(applyCalibration(frame, calibrate(frame, 'right').offsets), 'right');
  close(neutral.abduction, 0);
  close(neutral.flexion, 0);
  close(neutral.elbow, 90);
  close(neutral.trunkTilt, 0);
  const supplied = checkCalibration([{ t: -.1, q: frame }], 'right', [-.5, 0],
    { neutral: q, offsets: { trunk: identity, upperArm: identity, forearm: identity } });
  assert.equal(supplied.calibrationWarning, true);
  assert.equal(checkCalibration([], 'right').calibration, null);
});

test('record matching, antipodal interpolation and no interpolated pose across packet gaps', () => {
  const second = axisAngle([0, 1, 0], -.7);
  const input = { schema: 'motion-lab-imu/v1', trialId: 'ST09', side: 'left', samples: [
    { t: -.1, q }, { t: 0, q: { ...q, upperArm: second.map((n) => -n) } },
    { t: .05, q: { trunk: identity, upperArm: second } }, { t: .4, q },
  ]};
  assert.throws(() => parsePoseRecord(input, 'wrong'));
  assert.throws(() => parsePoseRecord({ ...input, samples: [{ t: 1, q: { trunk: [0, 0, 0, 0] } }] }, 'ST09'));
  const { source } = createRecordedPose(parsePoseRecord(input, 'ST09'), [-.5, 0]);
  const interpolated = source.getPoseAt(-.05);
  close(jointAngles(interpolated!.q, 'left').flexion, .35 * 180 / Math.PI);
  assert.equal(source.getFrameAt(.04).status.forearm, 'lost');
  assert.equal(source.getPoseAt(.2), null);
  assert.equal(source.getFrameAt(.4).status.forearm, 'ok');
  assert.equal(createRecordedPose({trialId:'empty', side:'right', samples: []}).source.hasData, false);
});

test('width-dependent min and max retain brief peaks and gaps in temporal order', () => {
  const samples = new Float64Array([0, 9, -7, .6, NaN, 2, -5, 1]);
  const points = extremaIndices(samples, 2);
  assert.deepEqual(points, [0, 1, 2, -1, 5, 6, 7]);
  assert.ok(extremaIndices(samples, 8).length > points.length);
});
