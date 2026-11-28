import test from 'node:test';
import assert from 'node:assert/strict';
import { initialLiveFlow, liveControls, liveFlow } from '../src/ui/liveFlow.ts';

function connect() {
  const idle = initialLiveFlow();
  const opening = liveFlow(liveFlow(idle, { type: 'connect' }), { type: 'choose' });
  return liveFlow(opening, { type: 'connected', now: 100 });
}

test('preview and calibration remain local until a unified start', () => {
  const preview = connect();
  assert.equal(preview.stage, 'preview');
  assert.equal(preview.draft, null);
  const calibrating = liveFlow(preview, { type: 'calibrate', now: 200 });
  const reset = liveFlow(calibrating, { type: 'motion', now: 900 });
  assert.equal(liveFlow(reset, { type: 'finish-calibration', now: 3500 }).stage, 'calibrating');
  const ready = liveFlow(reset, { type: 'finish-calibration', now: 3910 });
  assert.ok(ready.calibrated);
  assert.equal(ready.draft, null);
  const trial = liveFlow(ready, { type: 'start', now: 4000 });
  assert.equal(trial.draft?.number, 1);
  assert.deepEqual(trial.draft?.gaps, []);
  assert.equal(liveControls(trial).primary, 'end');
});

test('one stream requires a fresh explicit confirmation', () => {
  let state = liveFlow(connect(), { type: 'health', value: 'emg-only', now: 200 });
  state = liveFlow(state, { type: 'start', now: 300 });
  assert.equal(state.confirm, 'imu');
  assert.equal(state.draft, null);
  const changed = liveFlow(state, { type: 'health', value: 'imu-only', now: 305 });
  const recheck = liveFlow(changed, { type: 'accept', now: 310 });
  assert.equal(recheck.confirm, 'emg');
  assert.equal(recheck.draft, null);
  const trial = liveFlow(recheck, { type: 'accept', now: 400 });
  assert.deepEqual(trial.draft?.gaps, [{ stream: 'emg', from: 0, to: null }]);
});

test('stream and link losses annotate one draft and save one review', () => {
  let state = liveFlow(connect(), { type: 'start', now: 1000 });
  state = liveFlow(state, { type: 'health', value: 'emg-only', now: 1200 });
  assert.equal(state.stage, 'recording');
  state = liveFlow(state, { type: 'health', value: 'offline', now: 1500 });
  assert.equal(state.stage, 'reconnecting');
  assert.equal(liveControls(state).primary, 'end-save');
  state = liveFlow(state, { type: 'health', value: 'dual', now: 2100 });
  assert.equal(state.stage, 'recording');
  assert.equal(state.draft?.number, 1);
  assert.deepEqual(state.draft?.gaps, [{ stream: 'imu', from: 200, to: 1100 }, { stream: 'emg', from: 500, to: 1100 }]);
  state = liveFlow(liveFlow(state, { type: 'end', now: 2400 }), { type: 'saved' });
  assert.equal(state.stage, 'review');
  assert.equal(state.draft, null);
  assert.equal(state.summary?.duration, 1400);
});
