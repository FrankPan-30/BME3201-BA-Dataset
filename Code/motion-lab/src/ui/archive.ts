import { baRecords } from '../ba-fixtures';
import { createBaEvents, type BaRecord } from '../ba';
import { evaluateMovementQuality } from '../assessment';
import { type LimbRole, type Outcome, type Trial, type TrialAnnotation } from '../model';
import {
  annotationTagLabels, formatLocalDateKey, nextSubjectDayTrialNumber, resolveRecordingSide,
  type ArchiveSubject, type PareticSide, type Sex,
} from './clinicalMeta';

export {
  annotationTagLabels, formatLocalDateKey, nextSubjectDayTrialNumber, resolveRecordingSide,
  type ArchiveSubject, type PareticSide, type Sex,
};

export type ArchiveEntry =
  | { kind: 'trial'; id: string; trial: Trial }
  | { kind: 'example'; id: string; record: BaRecord };

export const exampleFolder = '@examples';
export const unassignedFolder = '@unassigned';
export const rehabDemoSubjectId = 'S-REHAB';
export const subjectStorageKey = 'motion-lab-archive-subjects';
export const activeSubjectKey = 'motion-lab-archive-active-subject';

const defaultRehabSubject: ArchiveSubject = {
  id: rehabDemoSubjectId,
  name: '陈建国（卒中康复示例）',
  age: 61,
  sex: 'male',
  pareticSide: 'right',
  onsetNote: '缺血性卒中后第 4–6 周',
};

export function readSubjects(): ArchiveSubject[] {
  try {
    const raw = localStorage.getItem(subjectStorageKey);
    if (!raw) return [defaultRehabSubject];
    const saved: unknown = JSON.parse(raw);
    const list = Array.isArray(saved)
      ? saved.filter((row): row is ArchiveSubject =>
          Boolean(row && typeof row === 'object' && typeof (row as ArchiveSubject).id === 'string' && typeof (row as ArchiveSubject).name === 'string'))
      : [];
    return list.some((s) => s.id === rehabDemoSubjectId) ? list : [...list, defaultRehabSubject];
  } catch {
    return [defaultRehabSubject];
  }
}

/**
 * Longitudinal 3-day stroke rehabilitation showcase trials + healthy-side baseline
 * for S-REHAB, enabling multi-day progress curves, bilateral comparison, and clinician annotations.
 */
export function buildRehabShowcaseTrials(): Trial[] {
  const baseRecord = baRecords[0];
  const events = createBaEvents(baseRecord);
  const now = new Date();
  const makeDay = (daysAgo: number, hour: number, minute: number) => {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysAgo, hour, minute, 12);
    return d.getTime();
  };

  type Spec = {
    id: string;
    dayOffset: number;
    h: number;
    m: number;
    num: number;
    elapsed: number;
    limbRole: LimbRole;
    recordedSide: PareticSide;
    preset: {
      total: number; muscleScore: number; timingScore: number; stabilityScore: number;
      cci: number; abductionPeak: number; adMdRatio: number; totalSeconds: number;
      transportVariation: number; holdSd: number; elbowRom: number;
      phaseSeconds: { REST: number; REACH: number; LIFT_TRANSFER: number; RETURN: number };
    };
    reviewed: boolean;
    annotations?: TrialAnnotation[];
    clinicalNote?: string;
    prescription?: string;
  };

  const specs: Spec[] = [
    {
      id: 'rehab-day1-01', dayOffset: 14, h: 9, m: 42, num: 1, elapsed: 9.85, limbRole: 'paretic', recordedSide: 'right',
      preset: {
        total: 61, muscleScore: 56, timingScore: 64, stabilityScore: 65, cci: 0.56, abductionPeak: 44.2, adMdRatio: 0.68, totalSeconds: 9.85, transportVariation: 5.4, holdSd: 3.6, elbowRom: 62.5,
        phaseSeconds: { REST: 0.62, REACH: 3.38, LIFT_TRANSFER: 3.25, RETURN: 2.60 },
      },
      reviewed: true,
      annotations: [
        { id: 'ann-d1-1', atMs: 3950, tag: 'shrug', note: '前伸转抬举时三角肌中束代偿外展达 44°', createdAt: makeDay(14, 9, 43) },
        { id: 'ann-d1-2', atMs: 5200, tag: 'trunk_lean', note: '搬运中段伴轻度躯干前倾借力', createdAt: makeDay(14, 9, 44) },
      ],
      clinicalNote: '初评期患侧右侧上肢肱二/三头肌共同激活偏高（CCI 0.56），搬运阶段可见明显肩外展绕行代偿。',
      prescription: '每日 2 组肘伸展抗重力离心训练 + 镜面反馈抑制耸肩代偿（15 min/次）。',
    },
    {
      id: 'rehab-day1-02', dayOffset: 14, h: 9, m: 55, num: 2, elapsed: 9.40, limbRole: 'paretic', recordedSide: 'right',
      preset: {
        total: 64, muscleScore: 60, timingScore: 67, stabilityScore: 67, cci: 0.52, abductionPeak: 41.8, adMdRatio: 0.72, totalSeconds: 9.40, transportVariation: 4.9, holdSd: 3.3, elbowRom: 65.0,
        phaseSeconds: { REST: 0.58, REACH: 3.20, LIFT_TRANSFER: 3.12, RETURN: 2.50 },
      },
      reviewed: true,
      clinicalNote: '第二次试次熟悉动作节律后，总耗时小幅下降，肘关节活动度略有打开。',
    },
    {
      id: 'rehab-healthy-baseline-01', dayOffset: 14, h: 10, m: 8, num: 3, elapsed: 6.20, limbRole: 'healthy', recordedSide: 'left',
      preset: {
        total: 94, muscleScore: 95, timingScore: 94, stabilityScore: 93, cci: 0.21, abductionPeak: 18.5, adMdRatio: 1.08, totalSeconds: 6.20, transportVariation: 1.5, holdSd: 0.9, elbowRom: 92.4,
        phaseSeconds: { REST: 0.48, REACH: 1.98, LIFT_TRANSFER: 2.04, RETURN: 1.70 },
      },
      reviewed: true,
      annotations: [
        { id: 'ann-hb-1', atMs: 3650, tag: 'custom', note: '健侧左臂自然前伸抓握，无额外肩外展', createdAt: makeDay(14, 10, 9) },
      ],
      clinicalNote: '健侧左臂基线参考：拮抗协同优异（CCI 0.21），搬运过程稳态波动仅 ±1.5°，作为患侧康复目标基线。',
      prescription: '维持双侧节律对称性参照。',
    },
    {
      id: 'rehab-day7-01', dayOffset: 7, h: 14, m: 18, num: 1, elapsed: 8.15, limbRole: 'paretic', recordedSide: 'right',
      preset: {
        total: 75, muscleScore: 72, timingScore: 78, stabilityScore: 76, cci: 0.41, abductionPeak: 34.6, adMdRatio: 0.84, totalSeconds: 8.15, transportVariation: 3.5, holdSd: 2.3, elbowRom: 74.8,
        phaseSeconds: { REST: 0.54, REACH: 2.75, LIFT_TRANSFER: 2.66, RETURN: 2.20 },
      },
      reviewed: true,
      annotations: [
        { id: 'ann-d7-1', atMs: 4120, tag: 'elbow_deficit', note: '末端肘伸展仍有约 15° 受限，但耸肩幅度明显回落', createdAt: makeDay(7, 14, 20) },
      ],
      clinicalNote: '训练第 7 天复评：CCI 降至 0.41，肩外展峰值下降近 10°，动作流畅度显著改善。',
      prescription: '增加 250g 轻量物块负重前伸—搬运任务，强化 AD 前束募集。',
    },
    {
      id: 'rehab-day7-02', dayOffset: 7, h: 14, m: 31, num: 2, elapsed: 7.90, limbRole: 'paretic', recordedSide: 'right',
      preset: {
        total: 78, muscleScore: 76, timingScore: 81, stabilityScore: 78, cci: 0.38, abductionPeak: 32.1, adMdRatio: 0.88, totalSeconds: 7.90, transportVariation: 3.1, holdSd: 2.0, elbowRom: 77.2,
        phaseSeconds: { REST: 0.52, REACH: 2.64, LIFT_TRANSFER: 2.58, RETURN: 2.16 },
      },
      reviewed: true,
    },
    {
      id: 'rehab-day14-01', dayOffset: 0, h: 10, m: 15, num: 1, elapsed: 7.12, limbRole: 'paretic', recordedSide: 'right',
      preset: {
        total: 86, muscleScore: 85, timingScore: 88, stabilityScore: 86, cci: 0.29, abductionPeak: 25.4, adMdRatio: 0.96, totalSeconds: 7.12, transportVariation: 2.2, holdSd: 1.4, elbowRom: 84.6,
        phaseSeconds: { REST: 0.50, REACH: 2.36, LIFT_TRANSFER: 2.32, RETURN: 1.94 },
      },
      reviewed: true,
      annotations: [
        { id: 'ann-d14-1', atMs: 4920, tag: 'custom', note: '抬举阶段肩外展控制在 25.4° 以内，协同接近健侧水平', createdAt: makeDay(0, 10, 17) },
      ],
      clinicalNote: '第 14 天阶段评估达优（86/100），BB/TB 共同激活指数降至 0.29，肘 ROM 达 84.6°，已接近健侧基线（94 分）。',
      prescription: '进入日常功能性端杯、拧盖等精细抓握—转移巩固阶段。',
    },
  ];

  return specs.map((item, idx) => {
    const started = makeDay(item.dayOffset, item.h, item.m);
    const quality = evaluateMovementQuality({
      record: baseRecord,
      events,
      signal: null,
      positionMs: baseRecord.originMs + Math.round(item.elapsed * 1000),
      complete: true,
      preset: item.preset,
    });
    return {
      id: item.id,
      number: idx + 1,
      subjectTrialNumber: item.num,
      dateKey: formatLocalDateKey(started),
      started,
      source: 'ba-repository-v1',
      subjectId: rehabDemoSubjectId,
      limbRole: item.limbRole,
      recordedSide: item.recordedSide,
      reviewed: item.reviewed,
      ba: { record: baseRecord, events, segmentationComplete: true },
      quality,
      annotations: item.annotations,
      clinicalNote: item.clinicalNote,
      prescription: item.prescription,
      elapsed: item.elapsed,
      complete: true,
      outcome: { success: 'yes', drop: 'no', assist: item.dayOffset === 14 && item.limbRole === 'paretic' ? 'yes' : 'no' } as Outcome,
      video: null,
      videoTime: 0,
      videoState: 'none',
    };
  });
}

export const archiveText = {
  en: {
    home: 'Home', archive: 'Patient Archive', enter: 'Enter live capture', swipeEnter: 'Swipe up or click to enter capture',
    task: 'Stroke Upper-Limb Rehab Assessment',
    scene: 'Hardware topology · Interactive 3D', scenePlay: 'Play motion example', scenePause: 'Pause motion example',
    subjects: 'Patients & Subjects', subjectPrompt: 'Select a patient profile to review multi-day rehabilitation progress.',
    all: 'All patients', add: 'New patient', edit: 'Edit profile',
    name: 'Patient name', code: 'Patient ID', age: 'Age (yrs)', sex: 'Sex', male: 'Male', female: 'Female',
    pareticSide: 'Affected limb (Paretic side)', leftSide: 'Left arm', rightSide: 'Right arm',
    onsetNote: 'Clinical stage / Note (optional)', onsetPlaceholder: 'e.g. Post-stroke Week 6',
    ageUnit: 'yrs', leftParetic: 'L-paretic', rightParetic: 'R-paretic',
    save: 'Save profile', cancel: 'Cancel', nameRequired: 'Enter patient name and ID.', duplicate: 'This patient ID is already in use.',
    examples: 'Benchmark dataset', examplesId: 'BENCHMARK', unassigned: 'Unassigned', noSubject: 'Unassigned',
    useSubject: 'Select for capture', active: 'Current subject', activeBadge: 'Active', chooseFirst: 'Select patient',
    recording: 'trial', recordings: 'trials', empty: 'No trials recorded for this patient yet.',
    open: 'Review', back: 'Archive', demo: 'Live', repo: 'Dataset', local: 'Local',
    trial: 'Trial review', assessment: 'Quality score', pending: 'Pending', reviewed: 'Reviewed', markReviewed: 'Mark reviewed',
    saveError: 'Could not save locally. Available in this session.',
    subjectError: 'Could not save patient profile.',
    discardError: 'Could not remove trial.',
    no3d: '3D preview unavailable',
    rehabTrend: 'Multi-Day Rehabilitation Trajectory',
    allDays: 'All dates', daySession: 'Day', baselineDelta: 'vs. baseline',
    scoreLabel: 'Quality Score', cciLabel: 'Co-activation CCI', durationLabel: 'Task Duration', stabilityLabel: 'Transport Stability',
    synergyBetter: 'better synergy', faster: 'faster',
    pareticTag: 'Affected arm', healthyTag: 'Healthy baseline', limbShortParetic: 'Paretic', limbShortHealthy: 'Healthy',
    leftArm: 'Left', rightArm: 'Right', healthyBaselineRef: 'Healthy baseline',
    compareMode: 'Compare', exitCompare: 'Exit compare', compareSelected: 'Compare 2 trials',
    comparePrompt: 'Select 2 trials (A baseline, B target) for side-by-side analysis.',
    quickFirstLast: 'First vs Latest', quickBilateral: 'Paretic vs Healthy',
    compareTitle: 'Dual-Trial Clinical Comparison', crossDayMode: 'Cross-day recovery', bilateralMode: 'Bilateral symmetry',
    swapAB: 'Swap A/B', groupA: 'Trial A (Baseline)', groupB: 'Trial B (Comparison)',
    scoreRadarTitle: 'Quality Dimensions & Delta', phaseCompareTitle: 'Movement Phase Duration',
    kpiCompareTitle: 'Clinical KPI Comparison', envelopeOverlayTitle: 'Synchronized EMG Envelope Overlay',
    metricLabel: 'Metric', deltaLabel: 'Delta', baselineCurve: 'Trial A (Baseline)', targetCurve: 'Trial B (Target)',
    abductionPeakLabel: 'Shoulder abduction peak', adMdLabel: 'AD / MD recruitment ratio',
    variationLabel: 'Transport variation', elbowRomLabel: 'Elbow ROM',
    notesBtn: 'Notes', annotationsTitle: 'Clinical Annotations & Notes',
    addAnnotation: 'Add note at playhead', notePlaceholder: 'Optional clinical observation...',
    addNoteBtn: 'Add marker', noAnnotations: 'No timeline annotations yet. Select a quick tag or press M during capture.',
    clinicianNote: 'Physician Clinical Note', noteAreaPlaceholder: 'Summarize motor synergy, compensation patterns, and recovery progress...',
    prescription: 'Rehabilitation Prescription', rxAreaPlaceholder: 'Next-stage home or therapist-guided training plan...',
    saveNotes: 'Save notes', saveAndReview: 'Save & mark reviewed', notesSaved: 'Saved',
    annotationBadge: 'notes', hasNoteBadge: 'Clinician note',
    exportBtn: 'Export', exportPdf: 'Clinical Report (PDF)', exportCsv: 'Research Data (CSV)',
    exportJson: 'Summary (JSON)', exportVideo: 'Recording (WebM)',
    storageManage: 'Storage', storageTitle: 'Local Storage & Video Manager',
    storageTotalTrials: 'Archived trials', storageVideoCount: 'Saved videos', storageVideoSize: 'Video footprint',
    keepMetricsHint: 'Clearing videos only removes media blobs — all scores, phases, annotations and physician notes stay intact.',
    clearVideo: 'Remove video', clearAllVideos: 'Clear all videos', noVideos: 'No recorded video blobs stored locally.',
    poseMenuTitle: 'IMU Source & Options', poseLimbPrefix: 'Recorded limb',
  },
  zh: {
    home: '首页', archive: '康复档案', enter: '进入实时采集', swipeEnter: '上滑或点击进入实时采集',
    task: '脑卒中上肢运动功能评估与康复系统',
    scene: '采集硬件拓扑 · 交互式 3D', scenePlay: '播放动作示意', scenePause: '暂停动作示意',
    subjects: '患者与受试者档案', subjectPrompt: '选择患者档案，查看跨日康复趋势与历次评估记录。',
    all: '全部档案', add: '新建患者档案', edit: '编辑患者信息',
    name: '患者姓名', code: '病历 / 受试者编号', age: '年龄（岁）', sex: '性别', male: '男', female: '女',
    pareticSide: '患侧上肢（重点监测侧）', leftSide: '左侧患肢', rightSide: '右侧患肢',
    onsetNote: '康复阶段 / 临床备注（选填）', onsetPlaceholder: '例如：缺血性卒中后 6 周',
    ageUnit: '岁', leftParetic: '左侧患肢', rightParetic: '右侧患肢',
    save: '保存档案', cancel: '取消', nameRequired: '请填写患者姓名与编号。', duplicate: '该受试者编号已存在。',
    examples: '标准示例记录', examplesId: '标准数据集', unassigned: '未分配受试者', noSubject: '未选受试者',
    useSubject: '设为当前采集对象', active: '当前采集受试者', activeBadge: '当前采集', chooseFirst: '选择受试者',
    recording: '次记录', recordings: '次记录', empty: '该受试者暂无评估记录。',
    open: '复盘', back: '返回档案', demo: '采集', repo: '数据集', local: '本机',
    trial: '试次复盘', assessment: '动作质量评估', pending: '待复盘', reviewed: '已复盘', markReviewed: '标为已复盘',
    saveError: '本机保存失败，当前会话内仍可查看。',
    subjectError: '保存患者档案失败，请重试。',
    discardError: '删除记录失败，请重试。',
    no3d: '3D 无法渲染',
    rehabTrend: '跨日康复进程与指标趋势',
    allDays: '全部日期', daySession: '康复日', baselineDelta: '较初评基线',
    scoreLabel: '动作质量总分', cciLabel: '共同激活 CCI', durationLabel: '任务总耗时', stabilityLabel: '搬运稳定性',
    synergyBetter: '拮抗协同改善', faster: '效率提升',
    pareticTag: '患侧评估', healthyTag: '健侧基线', limbShortParetic: '患侧', limbShortHealthy: '健侧基线',
    leftArm: '左臂', rightArm: '右臂', healthyBaselineRef: '健侧基线',
    compareMode: '对比模式', exitCompare: '退出对比', compareSelected: '开始同屏对比',
    comparePrompt: '勾选任意 2 条试次（A 为基准组，B 为对比组），进入同屏深度对照。',
    quickFirstLast: '首末次对比', quickBilateral: '患侧 vs 健侧',
    compareTitle: '双试次临床对比', crossDayMode: '跨日康复对比', bilateralMode: '患侧 vs 健侧对照',
    swapAB: '互换 A/B', groupA: '试次 A（基准组）', groupB: '试次 B（对比组）',
    scoreRadarTitle: '三维度与综合评分对比', phaseCompareTitle: '4 阶段耗时对比',
    kpiCompareTitle: '核心临床指标对照表', envelopeOverlayTitle: '同步时间轴 EMG 包络叠图对比',
    metricLabel: '评估指标', deltaLabel: '变化量', baselineCurve: '试次 A（基准）', targetCurve: '试次 B（目标）',
    abductionPeakLabel: '肩外展峰值', adMdLabel: 'AD / MD 募集比',
    variationLabel: '搬运姿态波动', elbowRomLabel: '肘关节 ROM',
    notesBtn: '批注', annotationsTitle: '时间轴批注与医生评语',
    addAnnotation: '在当前播放头添加批注', notePlaceholder: '输入补充说明（可选）...',
    addNoteBtn: '添加批注', noAnnotations: '暂无时间轴批注，可选择快捷标签或采集中按 M 键标记。',
    clinicianNote: '医生临床评语', noteAreaPlaceholder: '记录协同改善情况、主要代偿模式与关键观察结论...',
    prescription: '下阶段康复训练处方', rxAreaPlaceholder: '填写居家或治疗师辅助训练方案建议...',
    saveNotes: '保存评语', saveAndReview: '保存并标为已复盘', notesSaved: '已保存',
    annotationBadge: '条批注', hasNoteBadge: '含评语',
    exportBtn: '导出', exportPdf: '临床评估报告 (PDF)', exportCsv: '完整科研数据 (CSV)',
    exportJson: '结构化摘要 (JSON)', exportVideo: '视频录像 (WebM)',
    storageManage: '本地存储', storageTitle: '本地录像与存储空间管理',
    storageTotalTrials: '已存试次', storageVideoCount: '含录像试次', storageVideoSize: '录像总占用',
    keepMetricsHint: '清理录像仅释放视频文件空间，动作质量评分、分期、批注与医生评语将完整保留。',
    clearVideo: '仅清理录像', clearAllVideos: '一键清理全部录像', noVideos: '本地暂无占用空间的录像文件。',
    poseMenuTitle: 'IMU 数据源与调试项', poseLimbPrefix: '本次采集肢体',
  },
};
export type ArchiveText = typeof archiveText.en;
