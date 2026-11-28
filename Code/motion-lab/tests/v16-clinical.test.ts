import test from 'node:test';
import assert from 'node:assert/strict';
import type { QualityReport } from '../src/assessment.ts';
import type { BaRecord } from '../src/ba.ts';
import type { BaSignal } from '../src/baSignal.ts';
import {
  buildCompareCsv, buildCompareReportHtml, buildSingleTrialReportHtml,
  buildTrialCsv, escapeHtml,
} from '../src/export/exportReport.ts';
import { freshOutcome, type Trial } from '../src/model.ts';
import { createMockPose } from '../src/pose/mockPose.ts';
import { stripTrialVideo, summarizeLocalStorage } from '../src/store.ts';
import { annotationTagLabels, resolveRecordingSide } from '../src/ui/clinicalMeta.ts';

const sampleSubject = {
  id: 'S-TEST',
  name: '李明 <script>alert(1)</script>',
  age: 58,
  sex: 'male' as const,
  pareticSide: 'right' as const,
  onsetNote: '缺血性卒中后 5 周',
};

const sampleRecord: BaRecord = {
  id: 'rec-test-01',
  method: 'unit-test',
  originMs: 0,
  endMs: 2000,
  phaseBlob: '',
  trialBlob: '',
  signalId: null,
  phases: [
    { code: 'REST', startMs: 0, endMs: 500, status: 'auto', startSource: 't', endSource: 't', notes: '' },
    { code: 'REACH', startMs: 500, endMs: 1100, status: 'auto', startSource: 't', endSource: 't', notes: '' },
    { code: 'LIFT_TRANSFER', startMs: 1100, endMs: 1600, status: 'auto', startSource: 't', endSource: 't', notes: '' },
    { code: 'RETURN', startMs: 1600, endMs: 2000, status: 'auto', startSource: 't', endSource: 't', notes: '' },
  ],
};

const sampleQualityA: QualityReport = {
  total: 62,
  muscleScore: 58,
  timingScore: 65,
  stabilityScore: 64,
  cci: 0.54,
  abductionPeak: 43.2,
  adMdRatio: 0.69,
  totalSeconds: 9.6,
  phaseSeconds: { REST: 0.5, REACH: 3.1, LIFT_TRANSFER: 3.2, RETURN: 2.8 },
  transportVariation: 5.1,
  elbowRom: 64.0,
  holdSd: 3.4,
  detourDetected: true,
  grade: 'compensatory',
};

const sampleQualityB: QualityReport = {
  total: 87,
  muscleScore: 86,
  timingScore: 89,
  stabilityScore: 87,
  cci: 0.28,
  abductionPeak: 24.5,
  adMdRatio: 0.98,
  totalSeconds: 7.1,
  phaseSeconds: { REST: 0.5, REACH: 2.3, LIFT_TRANSFER: 2.3, RETURN: 2.0 },
  transportVariation: 2.1,
  elbowRom: 86.2,
  holdSd: 1.3,
  detourDetected: false,
  grade: 'excellent',
};

const trialA: Trial = {
  id: 't-a',
  number: 1,
  subjectTrialNumber: 1,
  dateKey: '2026-11-14',
  started: Date.parse('2026-11-14T09:30:00Z'),
  source: 'ui-preview',
  subjectId: sampleSubject.id,
  limbRole: 'paretic',
  recordedSide: 'right',
  reviewed: true,
  elapsed: 2.0,
  complete: true,
  outcome: freshOutcome,
  annotations: [
    { id: 'ann-1', atMs: 1120, tag: 'shrug', note: '抬举期出现明显耸肩 & 外展', createdAt: 1000 },
  ],
  clinicalNote: '存在明显共同激活与外展代偿',
  prescription: '加强前伸控制与离心稳定训练',
  video: new Blob(['fake-webm-bytes'], { type: 'video/webm' }),
  videoTime: 2.0,
  videoState: 'recorded',
};

const trialB: Trial = {
  ...trialA,
  id: 't-b',
  number: 2,
  subjectTrialNumber: 1,
  dateKey: '2026-11-28',
  limbRole: 'healthy',
  recordedSide: 'left',
  clinicalNote: '健侧参照表现优良',
  video: null,
  videoTime: 0,
  videoState: 'none',
};

test('resolveRecordingSide maps paretic & opposite healthy baseline accurately', () => {
  assert.equal(resolveRecordingSide({ id: '1', name: 'A', pareticSide: 'right' }, 'paretic'), 'right');
  assert.equal(resolveRecordingSide({ id: '1', name: 'A', pareticSide: 'right' }, 'healthy'), 'left');
  assert.equal(resolveRecordingSide({ id: '2', name: 'B', pareticSide: 'left' }, 'paretic'), 'left');
  assert.equal(resolveRecordingSide({ id: '2', name: 'B', pareticSide: 'left' }, 'healthy'), 'right');
  assert.equal(annotationTagLabels.zh.shrug, '耸肩代偿');
});

test('buildTrialCsv outputs UTF-8 BOM, phase labels, IMU angles, and aligned annotations', () => {
  const signal: BaSignal = {
    id: 'sig-1',
    trialId: 't-a',
    replayBlob: '',
    rate: 100,
    originMs: 0,
    count: 201,
    values: {
      BB: Float64Array.from({ length: 201 }, () => 0.12345),
      TB: Float64Array.from({ length: 201 }, () => 0.05),
      AD: Float64Array.from({ length: 201 }, () => 0.2),
      MD: Float64Array.from({ length: 201 }, () => 0.15),
    },
  };
  const pose = createMockPose(sampleRecord, 'right');
  const csv = buildTrialCsv({ trial: trialA, record: sampleRecord, signal, pose, sampleRateHz: 10, lang: 'zh' });
  assert.ok(csv.startsWith('\uFEFFtime_ms,phase,emg_BB_mV,emg_TB_mV'));
  const lines = csv.trim().split('\r\n');
  assert.equal(lines.length, 22); // header + 21 rows (0..2000ms at 100ms step)
  assert.ok(lines.some((line) => line.includes('LIFT_TRANSFER') && line.includes('耸肩代偿')));
  const cmpCsv = buildCompareCsv({ trialA, trialB, qualityA: sampleQualityA, qualityB: sampleQualityB });
  assert.ok(cmpCsv.startsWith('\uFEFFmetric,trial_A,trial_B,delta'));
  assert.ok(cmpCsv.includes('total_score,62,87,25'));
});

test('buildSingleTrialReportHtml and buildCompareReportHtml escape HTML and include clinical metadata', () => {
  assert.equal(escapeHtml('<script>x</script>'), '&lt;script&gt;x&lt;/script&gt;');
  const singleHtml = buildSingleTrialReportHtml({ trial: trialA, subject: sampleSubject, quality: sampleQualityA, lang: 'zh' });
  assert.ok(!singleHtml.includes('<script>alert(1)</script>'));
  assert.ok(singleHtml.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(singleHtml.includes('耸肩代偿'));
  assert.ok(singleHtml.includes('加强前伸控制与离心稳定训练'));

  const cmpHtml = buildCompareReportHtml({
    trialA, trialB, subject: sampleSubject, qualityA: sampleQualityA, qualityB: sampleQualityB, lang: 'zh',
  });
  assert.ok(cmpHtml.includes('患侧 vs 健侧对照'));
  assert.ok(cmpHtml.includes('+25 分'));
});

test('stripTrialVideo removes video blob while preserving clinical scores, annotations, and notes', () => {
  const before = summarizeLocalStorage([trialA, trialB]);
  assert.equal(before.totalTrials, 2);
  assert.equal(before.videoTrials, 1);
  assert.ok(before.videoBytes > 0);

  const stripped = stripTrialVideo(trialA);
  assert.equal(stripped.video, null);
  assert.equal(stripped.videoState, 'none');
  assert.equal(stripped.annotations?.length, 1);
  assert.equal(stripped.clinicalNote, trialA.clinicalNote);
  assert.equal(stripped.prescription, trialA.prescription);

  const after = summarizeLocalStorage([stripped, trialB]);
  assert.equal(after.videoTrials, 0);
  assert.equal(after.videoBytes, 0);
});
