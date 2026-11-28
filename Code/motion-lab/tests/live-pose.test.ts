import test from 'node:test';
import assert from 'node:assert/strict';
import { createLivePose, readLiveHeader, readLivePacket } from '../src/pose/livePose.ts';
import { followPoseFile } from '../src/pose/liveFile.ts';
import { identity, neutralPose } from '../src/pose/poseMath.ts';

const q = { trunk: identity, upperArm: identity, forearm: neutralPose.forearm };

test('bounded live source handles per-segment loss, recovery and missing inventory', () => {
  let now = 0;
  const live = createLivePose('right', ['trunk', 'upperArm', 'forearm'], () => now, {
    maxSamples: 3, bufferSeconds: .3, dropoutMs: 500, playbackDelaySec: .08,
  });
  assert.equal(live.source.hasData,false);
  assert.equal(live.push({t:0,q}),true);
  now = 80;
  assert.equal(live.push({t:.08,q}),true);
  now = 160;
  assert.equal(live.push({t:.16,q:{trunk:q.trunk,forearm:q.forearm}}),true);
  assert.deepEqual(live.source.getFrameAt(.16).status,{trunk:'ok',upperArm:'lost',forearm:'ok'});
  assert.equal(live.push({t:.15,q}),false);
  now = 240;
  assert.equal(live.push({t:.24,q}),true);
  assert.equal(live.source.getFrameAt(.24).status.upperArm,'ok');
  assert.equal(live.rows().length,3);
  now = 800;
  assert.equal(live.time()!.running,false);
  assert.equal(live.source.getFrameAt(.24).status.forearm,'lost');
  const missing = createLivePose('left',['trunk'],()=>0);
  missing.push({t:0,q});
  assert.equal(missing.source.getFrameAt(0).status.forearm,'missing');
});

test('header and phase event validation, including relative events', () => {
  assert.equal(readLiveHeader({schema:'motion-lab-imu-live/v1',side:'left',segments:['trunk','trunk'],rest:[-.5,0]}).segments.length,1);
  assert.throws(() => readLiveHeader({schema:'motion-lab-imu-live/v1',side:'right',segments:['wrist']}));
  assert.deepEqual(readLivePacket({kind:'phase-start',phase:'LIFT_TRANSFER',t:2.26}),{
    type:'event', event:{kind:'phase-start',phase:'LIFT_TRANSFER',atMs:2260},
  });
});

test('appended JSONL rows survive a split final line and a malformed packet is skipped', async () => {
  const header = '{"schema":"motion-lab-imu-live/v1","side":"right","segments":["trunk"]}\n';
  let text = header + '{"t":0,"q":';
  const lines: string[] = [];
  const stop = followPoseFile({name:'fixture.jsonl',getFile: async () => new Blob([text])},{
    header: () => lines.push('header'),
    packet: (packet) => lines.push(packet.type),
    invalidPacket: () => lines.push('invalid'),
    failed: () => lines.push('error'),
  },{pollMs:5,readChunkBytes:9,maxLineBytes:1000});
  const waitFor = async (condition: () => boolean) => {
    for (let i=0;i<100;i++) {
      if (condition()) return;
      await new Promise((resolve) => setTimeout(resolve,5));
    }
    assert.fail('Timed out waiting for file reader');
  };
  try {
    await waitFor(() => lines.includes('header'));
    assert.deepEqual(lines,['header']);
    text += '{"trunk":[1,0,0,0]}}\nnot-json\n';
    await waitFor(() => lines.includes('invalid'));
    assert.deepEqual(lines,['header','pose','invalid']);
    text = '';
    await waitFor(() => lines.includes('error'));
  } finally { stop(); }
});
