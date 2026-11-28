import type { QualityReport } from '../assessment.ts';
import { baObserved, baPhases, createBaEvents, type BaPhase, type BaRecord } from '../ba.ts';
import type { BaChannel, BaSignal } from '../baSignal.ts';
import type { PoseData } from '../components/PosePanel.tsx';
import { channels, type Trial } from '../model.ts';
import { jointAngles } from '../pose/jointAngles.ts';
import { applyCalibration } from '../pose/poseMath.ts';
import type { Lang } from '../text.ts';
import {
  annotationTagLabels, formatLocalDateKey, resolveRecordingSide,
  type ArchiveSubject,
} from '../ui/clinicalMeta.ts';

declare global {
  interface Window {
    motionLabDesktop?: {
      exportPdf(html: string, defaultName: string): Promise<{ ok: boolean; canceled?: boolean; filePath?: string; error?: string }>;
    };
  }
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  const text = String(value);
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function phaseAtTime(record: BaRecord, timeMs: number): BaPhase | 'UNSEGMENTED' {
  for (let i = 0; i < record.phases.length; i++) {
    const phase = record.phases[i];
    if (phase.startMs === null) continue;
    const end = phase.endMs ?? record.endMs;
    const isLast = i === record.phases.length - 1;
    if (timeMs >= phase.startMs && (isLast ? timeMs <= end : timeMs < end)) return phase.code;
  }
  return 'UNSEGMENTED';
}

function sampleSignalMv(signal: BaSignal | null, ch: BaChannel, timeMs: number): number | null {
  const arr = signal?.values[ch];
  if (!signal || !arr) return null;
  const idx = Math.round((timeMs - signal.originMs) * signal.rate / 1000);
  if (idx < 0 || idx >= arr.length) return null;
  const val = arr[idx];
  return Number.isFinite(val) ? val : null;
}

function trialTitle(trial: Trial, lang: Lang): string {
  const dk = trial.dateKey ?? (trial.started ? formatLocalDateKey(trial.started) : 'Benchmark');
  const num = String(trial.subjectTrialNumber ?? trial.number).padStart(2, '0');
  return lang === 'zh' ? `${dk} · 第 ${num} 次` : `${dk} · #${num}`;
}

function limbText(trial: Trial, subject: ArchiveSubject | undefined, lang: Lang): string {
  const role = trial.limbRole ?? 'paretic';
  const side = trial.recordedSide ?? resolveRecordingSide(subject, role);
  if (lang === 'zh') {
    const roleLabel = role === 'healthy' ? '健侧基线' : '患侧评估';
    const sideLabel = side === 'left' ? '左臂' : '右臂';
    return `${roleLabel}（${sideLabel}）`;
  }
  const roleLabel = role === 'healthy' ? 'Healthy baseline' : 'Affected arm';
  const sideLabel = side === 'left' ? 'Left' : 'Right';
  return `${roleLabel} (${sideLabel})`;
}

const reportCss = `
  @page { size: A4; margin: 14mm 14mm 16mm; }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 0; background: #FFFFFF; color: #16181F;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
    font-size: 11.5px; line-height: 1.5; -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .page { max-width: 780px; margin: 0 auto; }
  .head {
    display: flex; justify-content: space-between; align-items: flex-end; gap: 16px;
    padding-bottom: 10px; border-bottom: 2px solid #16181F; margin-bottom: 12px;
  }
  .head h1 { margin: 0; font-size: 18px; letter-spacing: -0.02em; }
  .head p { margin: 3px 0 0; color: #525B6C; font-size: 11px; }
  .head-meta { text-align: right; color: #525B6C; font-size: 10.5px; }
  .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 12px; }
  .grid-3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-bottom: 12px; }
  .card {
    border: 1px solid #DCE1EA; border-radius: 10px; padding: 10px 12px; background: #FAFBFD;
  }
  .card h2 { margin: 0 0 8px; font-size: 12.5px; font-weight: 600; color: #16181F; border-left: 3px solid #272A34; padding-left: 7px; }
  .meta-list { display: grid; grid-template-columns: repeat(2, 1fr); gap: 4px 12px; font-size: 11px; }
  .meta-list div span { color: #6B7484; }
  .meta-list div b { color: #16181F; font-weight: 600; }
  .score-hero { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; margin-bottom: 8px; }
  .score-hero strong { font-size: 28px; line-height: 1; font-weight: 700; }
  .score-hero small { font-size: 12px; color: #6B7484; }
  .badge {
    display: inline-block; padding: 2px 8px; border-radius: 99px; font-size: 10.5px; font-weight: 600;
    background: #EAEDF4; color: #272A34;
  }
  .badge--good { background: #ECFDF5; color: #047857; }
  .badge--warn { background: #FFFBEB; color: #B45309; }
  .bar-row { display: grid; grid-template-columns: 120px 1fr 44px; align-items: center; gap: 8px; margin-bottom: 5px; font-size: 11px; }
  .bar-track { height: 7px; border-radius: 99px; background: #E5E9F0; overflow: hidden; }
  .bar-fill { height: 100%; border-radius: 99px; background: #272A34; }
  table { width: 100%; border-collapse: collapse; font-size: 11px; }
  th, td { padding: 5px 8px; border-bottom: 1px solid #E5E9F0; text-align: left; }
  th { color: #525B6C; font-weight: 600; background: #F4F5F8; }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
  .delta-good { color: #047857; font-weight: 600; }
  .delta-warn { color: #B45309; font-weight: 600; }
  .note-box {
    min-height: 44px; padding: 8px 10px; border-radius: 8px; border: 1px solid #E2E6EF; background: #FFFFFF;
    white-space: pre-wrap; color: #1F2430; font-size: 11px;
  }
  .foot {
    margin-top: 16px; padding-top: 8px; border-top: 1px dashed #CBD5E1;
    display: flex; justify-content: space-between; color: #6B7484; font-size: 10.5px;
  }
`;

export function buildSingleTrialReportHtml(options: {
  trial: Trial;
  subject?: ArchiveSubject;
  quality: QualityReport;
  lang: Lang;
}): string {
  const { trial, subject, quality, lang } = options;
  const zh = lang === 'zh';
  const gradeLabel = quality.grade === 'excellent'
    ? (zh ? '协同良好' : 'Good synergy')
    : quality.grade === 'mild'
      ? (zh ? '轻度代偿' : 'Mild compensation')
      : (zh ? '明显代偿' : 'Compensation present');
  const gradeClass = quality.grade === 'excellent' ? 'badge badge--good' : 'badge badge--warn';
  const tagMap = annotationTagLabels[lang];
  const annotations = [...(trial.annotations ?? [])].sort((a, b) => a.atMs - b.atMs);
  const generatedAt = new Date().toLocaleString(zh ? 'zh-CN' : 'en-US');

  return `<!doctype html>
<html lang="${zh ? 'zh-Hans' : 'en'}">
<head><meta charset="utf-8" /><title>${escapeHtml(zh ? 'BME3201 脑卒中上肢运动评估报告' : 'BME3201 Clinical Assessment Report')}</title><style>${reportCss}</style></head>
<body><div class="page">
  <header class="head">
    <div>
      <h1>${escapeHtml(zh ? 'BME3201 Motion Lab · 脑卒中上肢运动功能评估报告' : 'BME3201 Motion Lab · Stroke Upper-Limb Assessment Report')}</h1>
      <p>${escapeHtml(zh ? '多通道表面肌电（sEMG）与三关节 IMU 运动学协同分析' : 'Multi-channel sEMG & 3-segment IMU kinematic synergy report')}</p>
    </div>
    <div class="head-meta">
      <div>${escapeHtml(trialTitle(trial, lang))}</div>
      <div>${escapeHtml(zh ? `生成时间：${generatedAt}` : `Generated: ${generatedAt}`)}</div>
    </div>
  </header>

  <section class="grid-2">
    <div class="card">
      <h2>${escapeHtml(zh ? '受试者与临床档案' : 'Patient Profile')}</h2>
      <div class="meta-list">
        <div><span>${zh ? '姓名：' : 'Name: '}</span><b>${escapeHtml(subject?.name ?? (zh ? '未建档' : 'Unassigned'))}</b></div>
        <div><span>${zh ? '编号：' : 'ID: '}</span><b>${escapeHtml(subject?.id ?? '—')}</b></div>
        <div><span>${zh ? '年龄/性别：' : 'Age/Sex: '}</span><b>${subject?.age ? `${subject.age}${zh ? '岁' : 'y'}` : '—'} · ${subject?.sex === 'female' ? (zh ? '女' : 'F') : subject?.sex === 'male' ? (zh ? '男' : 'M') : '—'}</b></div>
        <div><span>${zh ? '本次采集：' : 'Recorded limb: '}</span><b>${escapeHtml(limbText(trial, subject, lang))}</b></div>
        <div style="grid-column:span 2"><span>${zh ? '病程备注：' : 'Clinical note: '}</span><b>${escapeHtml(subject?.onsetNote ?? '—')}</b></div>
      </div>
    </div>
    <div class="card">
      <h2>${escapeHtml(zh ? '动作质量综合评估' : 'Composite Movement Quality')}</h2>
      <div class="score-hero">
        <div><strong>${quality.total}</strong><small> / 100</small></div>
        <span class="${gradeClass}">${escapeHtml(gradeLabel)}</span>
      </div>
      <div class="bar-row"><span>${zh ? '1. 肌肉代偿与 CCI' : '1. Muscle & CCI'}</span><div class="bar-track"><div class="bar-fill" style="width:${quality.muscleScore}%"></div></div><span class="num">${quality.muscleScore}</span></div>
      <div class="bar-row"><span>${zh ? '2. 各阶段耗时' : '2. Phase timing'}</span><div class="bar-track"><div class="bar-fill" style="width:${quality.timingScore}%"></div></div><span class="num">${quality.timingScore}</span></div>
      <div class="bar-row"><span>${zh ? '3. 搬运过程稳定性' : '3. Transport stability'}</span><div class="bar-track"><div class="bar-fill" style="width:${quality.stabilityScore}%"></div></div><span class="num">${quality.stabilityScore}</span></div>
    </div>
  </section>

  <section class="grid-2">
    <div class="card">
      <h2>${escapeHtml(zh ? '核心生物力学与电生理指标' : 'Key Biomechanical & sEMG KPIs')}</h2>
      <table>
        <thead><tr><th>${zh ? '指标' : 'Metric'}</th><th class="num">${zh ? '实测值' : 'Value'}</th><th class="num">${zh ? '参考目标' : 'Reference'}</th></tr></thead>
        <tbody>
          <tr><td>${zh ? 'BB/TB 共同激活指数 CCI' : 'Co-activation Index (CCI)'}</td><td class="num"><b>${quality.cci.toFixed(2)}</b></td><td class="num">&le; 0.30</td></tr>
          <tr><td>${zh ? '肩外展代偿峰值' : 'Shoulder abduction peak'}</td><td class="num"><b>${quality.abductionPeak.toFixed(1)}°</b></td><td class="num">&le; 28.0°</td></tr>
          <tr><td>${zh ? 'AD / MD 相对募集比' : 'AD / MD recruitment ratio'}</td><td class="num"><b>${quality.adMdRatio.toFixed(2)}</b></td><td class="num">&ge; 0.85</td></tr>
          <tr><td>${zh ? '搬运过程姿态波动' : 'Transport attitude SD'}</td><td class="num"><b>&plusmn;${quality.transportVariation.toFixed(1)}°</b></td><td class="num">&le; 2.5°</td></tr>
          <tr><td>${zh ? '肘关节活动范围 ROM' : 'Elbow ROM'}</td><td class="num"><b>${quality.elbowRom.toFixed(1)}°</b></td><td class="num">&ge; 80.0°</td></tr>
          <tr><td>${zh ? '任务总耗时' : 'Total duration'}</td><td class="num"><b>${quality.totalSeconds.toFixed(2)} s</b></td><td class="num">6.0–8.5 s</td></tr>
        </tbody>
      </table>
    </div>
    <div class="card">
      <h2>${escapeHtml(zh ? '动作四阶段耗时分布' : '4-Phase Timing Breakdown')}</h2>
      <table>
        <thead><tr><th>${zh ? '动作阶段' : 'Phase'}</th><th class="num">${zh ? '持续时间' : 'Duration'}</th></tr></thead>
        <tbody>
          <tr><td>${zh ? '1. 静息预备 (REST)' : '1. Rest'}</td><td class="num">${quality.phaseSeconds.REST?.toFixed(3) ?? '—'} s</td></tr>
          <tr><td>${zh ? '2. 前伸触及 (REACH)' : '2. Reach'}</td><td class="num">${quality.phaseSeconds.REACH?.toFixed(3) ?? '—'} s</td></tr>
          <tr><td>${zh ? '3. 抬举搬运 (LIFT & TRANSFER)' : '3. Lift & transfer'}</td><td class="num">${quality.phaseSeconds.LIFT_TRANSFER?.toFixed(3) ?? '—'} s</td></tr>
          <tr><td>${zh ? '4. 放置返回 (RETURN)' : '4. Return'}</td><td class="num">${quality.phaseSeconds.RETURN?.toFixed(3) ?? '—'} s</td></tr>
        </tbody>
      </table>
    </div>
  </section>

  <section class="card" style="margin-bottom:12px">
    <h2>${escapeHtml(zh ? '时间轴临床事件批注' : 'Timeline Clinical Annotations')}</h2>
    ${annotations.length === 0
      ? `<p style="margin:0;color:#6B7484">${escapeHtml(zh ? '本次试次未添加时间轴批注。' : 'No timeline annotations recorded.')}</p>`
      : `<table><thead><tr><th>${zh ? '时刻' : 'Time'}</th><th>${zh ? '标签分类' : 'Category'}</th><th>${zh ? '临床描述' : 'Observation'}</th></tr></thead><tbody>
        ${annotations.map((ann) => `<tr><td class="num" style="text-align:left;width:72px">${(ann.atMs / 1000).toFixed(3)} s</td><td style="width:120px"><span class="badge">${escapeHtml(tagMap[ann.tag])}</span></td><td>${escapeHtml(ann.note || '—')}</td></tr>`).join('')}
      </tbody></table>`}
  </section>

  <section class="grid-2">
    <div class="card">
      <h2>${escapeHtml(zh ? '医生临床评语' : 'Physician Clinical Note')}</h2>
      <div class="note-box">${escapeHtml(trial.clinicalNote?.trim() || (zh ? '（待补充临床评语）' : '(Pending clinician note)'))}</div>
    </div>
    <div class="card">
      <h2>${escapeHtml(zh ? '下阶段康复训练处方' : 'Rehabilitation Prescription')}</h2>
      <div class="note-box">${escapeHtml(trial.prescription?.trim() || (zh ? '（待补充康复处方）' : '(Pending prescription)'))}</div>
    </div>
  </section>

  <footer class="foot">
    <span>BME3201 Motion Lab v1.6 · ${escapeHtml(zh ? '仅供临床康复评估参考' : 'For rehabilitation assessment reference')}</span>
    <span>${escapeHtml(zh ? '评估医师签名：______________________' : 'Clinician Signature: ______________________')}</span>
  </footer>
</div></body></html>`;
}

export function buildCompareReportHtml(options: {
  trialA: Trial;
  trialB: Trial;
  subject?: ArchiveSubject;
  qualityA: QualityReport;
  qualityB: QualityReport;
  lang: Lang;
}): string {
  const { trialA, trialB, subject, qualityA, qualityB, lang } = options;
  const zh = lang === 'zh';
  const sameRole = (trialA.limbRole ?? 'paretic') === (trialB.limbRole ?? 'paretic');
  const modeText = sameRole ? (zh ? '跨日康复疗效对比' : 'Cross-day recovery comparison') : (zh ? '患侧 vs 健侧对照' : 'Paretic vs Healthy comparison');
  const delta = (a: number, b: number, goodHigher: boolean, digits = 0, unit = '') => {
    const d = b - a;
    const good = goodHigher ? d >= 0 : d <= 0;
    const sign = d > 0 ? '+' : '';
    return `<span class="${good ? 'delta-good' : 'delta-warn'}">${sign}${d.toFixed(digits)}${unit}</span>`;
  };
  const rows: [string, string, string, string][] = [
    [zh ? '动作质量总分' : 'Total Score', `${qualityA.total}`, `${qualityB.total}`, delta(qualityA.total, qualityB.total, true, 0, zh ? ' 分' : ' pt')],
    [zh ? '肌肉协同评分' : 'Muscle Synergy', `${qualityA.muscleScore}`, `${qualityB.muscleScore}`, delta(qualityA.muscleScore, qualityB.muscleScore, true)],
    [zh ? '共同激活 CCI' : 'Co-activation CCI', qualityA.cci.toFixed(2), qualityB.cci.toFixed(2), delta(qualityA.cci, qualityB.cci, false, 2)],
    [zh ? '肩外展峰值' : 'Abduction Peak', `${qualityA.abductionPeak.toFixed(1)}°`, `${qualityB.abductionPeak.toFixed(1)}°`, delta(qualityA.abductionPeak, qualityB.abductionPeak, false, 1, '°')],
    [zh ? 'AD/MD 募集比' : 'AD/MD Ratio', qualityA.adMdRatio.toFixed(2), qualityB.adMdRatio.toFixed(2), delta(qualityA.adMdRatio, qualityB.adMdRatio, true, 2)],
    [zh ? '搬运姿态波动' : 'Transport SD', `±${qualityA.transportVariation.toFixed(1)}°`, `±${qualityB.transportVariation.toFixed(1)}°`, delta(qualityA.transportVariation, qualityB.transportVariation, false, 1, '°')],
    [zh ? '肘关节 ROM' : 'Elbow ROM', `${qualityA.elbowRom.toFixed(1)}°`, `${qualityB.elbowRom.toFixed(1)}°`, delta(qualityA.elbowRom, qualityB.elbowRom, true, 1, '°')],
    [zh ? '任务总耗时' : 'Total Duration', `${qualityA.totalSeconds.toFixed(2)} s`, `${qualityB.totalSeconds.toFixed(2)} s`, delta(qualityA.totalSeconds, qualityB.totalSeconds, false, 2, ' s')],
  ];

  return `<!doctype html>
<html lang="${zh ? 'zh-Hans' : 'en'}">
<head><meta charset="utf-8" /><title>${escapeHtml(zh ? 'BME3201 双试次临床对比报告' : 'BME3201 Comparison Report')}</title><style>${reportCss}</style></head>
<body><div class="page">
  <header class="head">
    <div>
      <h1>${escapeHtml(zh ? 'BME3201 Motion Lab · 双试次康复对比报告' : 'BME3201 Motion Lab · Dual-Trial Comparison Report')}</h1>
      <p>${escapeHtml(`${subject?.name ?? '—'} (${subject?.id ?? '—'}) · ${modeText}`)}</p>
    </div>
    <div class="head-meta">${escapeHtml(new Date().toLocaleString(zh ? 'zh-CN' : 'en-US'))}</div>
  </header>

  <section class="grid-2">
    <div class="card">
      <h2>${escapeHtml(zh ? '试次 A（基准组）' : 'Trial A (Baseline)')}</h2>
      <div class="meta-list">
        <div><span>${zh ? '记录：' : 'Trial: '}</span><b>${escapeHtml(trialTitle(trialA, lang))}</b></div>
        <div><span>${zh ? '肢体：' : 'Limb: '}</span><b>${escapeHtml(limbText(trialA, subject, lang))}</b></div>
        <div><span>${zh ? '综合评分：' : 'Score: '}</span><b>${qualityA.total} / 100</b></div>
        <div><span>CCI：</span><b>${qualityA.cci.toFixed(2)}</b></div>
      </div>
    </div>
    <div class="card">
      <h2>${escapeHtml(zh ? '试次 B（对比/复评组）' : 'Trial B (Comparison)')}</h2>
      <div class="meta-list">
        <div><span>${zh ? '记录：' : 'Trial: '}</span><b>${escapeHtml(trialTitle(trialB, lang))}</b></div>
        <div><span>${zh ? '肢体：' : 'Limb: '}</span><b>${escapeHtml(limbText(trialB, subject, lang))}</b></div>
        <div><span>${zh ? '综合评分：' : 'Score: '}</span><b>${qualityB.total} / 100</b></div>
        <div><span>CCI：</span><b>${qualityB.cci.toFixed(2)}</b></div>
      </div>
    </div>
  </section>

  <section class="card" style="margin-bottom:12px">
    <h2>${escapeHtml(zh ? '核心指标对比与变化量（B 较 A）' : 'KPI Comparison & Delta (B vs A)')}</h2>
    <table>
      <thead><tr><th>${zh ? '评估指标' : 'Metric'}</th><th class="num">${zh ? '试次 A' : 'Trial A'}</th><th class="num">${zh ? '试次 B' : 'Trial B'}</th><th class="num">${zh ? '变化量 Δ' : 'Delta Δ'}</th></tr></thead>
      <tbody>${rows.map(([k, a, b, d]) => `<tr><td>${escapeHtml(k)}</td><td class="num">${escapeHtml(a)}</td><td class="num"><b>${escapeHtml(b)}</b></td><td class="num">${d}</td></tr>`).join('')}</tbody>
    </table>
  </section>

  <section class="grid-2">
    <div class="card">
      <h2>${escapeHtml(zh ? '试次 A 临床评语' : 'Trial A Note')}</h2>
      <div class="note-box">${escapeHtml(trialA.clinicalNote?.trim() || '—')}</div>
    </div>
    <div class="card">
      <h2>${escapeHtml(zh ? '试次 B 临床评语与处方' : 'Trial B Note & Prescription')}</h2>
      <div class="note-box">${escapeHtml([trialB.clinicalNote?.trim(), trialB.prescription?.trim()].filter(Boolean).join('\n\n') || '—')}</div>
    </div>
  </section>

  <footer class="foot">
    <span>BME3201 Motion Lab v1.6</span>
    <span>${escapeHtml(zh ? '评估医师签名：______________________' : 'Clinician Signature: ______________________')}</span>
  </footer>
</div></body></html>`;
}

export async function exportClinicalPdf(html: string, defaultFilename: string): Promise<'saved' | 'printed' | 'canceled'> {
  if (typeof window !== 'undefined' && window.motionLabDesktop?.exportPdf) {
    const res = await window.motionLabDesktop.exportPdf(html, defaultFilename);
    if (res.canceled) return 'canceled';
    if (res.ok) return 'saved';
  }
  if (typeof document !== 'undefined') {
    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    document.body.appendChild(iframe);
    const doc = iframe.contentDocument ?? iframe.contentWindow?.document;
    if (doc) {
      doc.open();
      doc.write(html);
      doc.close();
      await new Promise<void>((resolve) => setTimeout(resolve, 180));
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
      window.setTimeout(() => iframe.remove(), 1500);
      return 'printed';
    }
    iframe.remove();
  }
  return 'canceled';
}

export function buildTrialCsv(options: {
  trial: Trial;
  record: BaRecord;
  signal: BaSignal | null;
  pose?: PoseData | null;
  sampleRateHz?: number;
  lang?: Lang;
}): string {
  const { trial, record, signal, pose, sampleRateHz = 100, lang = 'zh' } = options;
  const header = [
    'time_ms', 'phase',
    'emg_BB_mV', 'emg_TB_mV', 'emg_AD_mV', 'emg_MD_mV', 'emg_FCR_mV', 'emg_ECR_mV',
    'shoulder_abduction_deg', 'shoulder_flexion_deg', 'elbow_flexion_deg', 'trunk_tilt_deg',
    'annotation',
  ].join(',');

  const startMs = record.originMs;
  const endMs = Math.max(startMs + 100, record.originMs + Math.round(trial.elapsed * 1000));
  const stepMs = Math.max(1, Math.round(1000 / sampleRateHz));
  const annotations = [...(trial.annotations ?? [])].sort((a, b) => a.atMs - b.atMs);
  const usedAnn = new Set<string>();
  const tagMap = annotationTagLabels[lang];

  const lines = [header];
  for (let t = startMs; t <= endMs; t += stepMs) {
    const phase = phaseAtTime(record, t);
    const emgs = channels.map((ch) => {
      const val = sampleSignalMv(signal, ch, t);
      return val === null ? '' : val.toFixed(5);
    });

    let abd = '';
    let flex = '';
    let elbow = '';
    let trunk = '';
    if (pose?.source.hasData) {
      const frame = pose.source.getFrameAt(t / 1000);
      const q = pose.calibration ? applyCalibration(frame.q, pose.calibration.offsets) : frame.q;
      const ang = jointAngles(q, pose.source.side, pose.calibration?.heading);
      abd = ang.abduction !== null ? ang.abduction.toFixed(2) : '';
      flex = ang.flexion !== null ? ang.flexion.toFixed(2) : '';
      elbow = ang.elbow !== null ? ang.elbow.toFixed(2) : '';
      trunk = ang.trunkTilt !== null ? ang.trunkTilt.toFixed(2) : '';
    }

    const ann = annotations.find((a) => !usedAnn.has(a.id) && Math.abs(a.atMs - t) <= stepMs / 2);
    let annText = '';
    if (ann) {
      usedAnn.add(ann.id);
      annText = `[${tagMap[ann.tag]}] ${ann.note}`.trim();
    }

    lines.push([t, phase, ...emgs, abd, flex, elbow, trunk, csvCell(annText)].join(','));
  }
  return '\uFEFF' + lines.join('\r\n');
}

export function buildCompareCsv(options: {
  trialA: Trial;
  trialB: Trial;
  qualityA: QualityReport;
  qualityB: QualityReport;
}): string {
  const { trialA, trialB, qualityA, qualityB } = options;
  const rows: [string, string | number, string | number, string | number][] = [
    ['trial_id', trialA.id, trialB.id, ''],
    ['limb_role', trialA.limbRole ?? 'paretic', trialB.limbRole ?? 'paretic', ''],
    ['recorded_side', trialA.recordedSide ?? 'right', trialB.recordedSide ?? 'right', ''],
    ['total_score', qualityA.total, qualityB.total, qualityB.total - qualityA.total],
    ['muscle_score', qualityA.muscleScore, qualityB.muscleScore, qualityB.muscleScore - qualityA.muscleScore],
    ['timing_score', qualityA.timingScore, qualityB.timingScore, qualityB.timingScore - qualityA.timingScore],
    ['stability_score', qualityA.stabilityScore, qualityB.stabilityScore, qualityB.stabilityScore - qualityA.stabilityScore],
    ['cci', qualityA.cci.toFixed(2), qualityB.cci.toFixed(2), (qualityB.cci - qualityA.cci).toFixed(2)],
    ['abduction_peak_deg', qualityA.abductionPeak.toFixed(1), qualityB.abductionPeak.toFixed(1), (qualityB.abductionPeak - qualityA.abductionPeak).toFixed(1)],
    ['ad_md_ratio', qualityA.adMdRatio.toFixed(2), qualityB.adMdRatio.toFixed(2), (qualityB.adMdRatio - qualityA.adMdRatio).toFixed(2)],
    ['transport_variation_deg', qualityA.transportVariation.toFixed(1), qualityB.transportVariation.toFixed(1), (qualityB.transportVariation - qualityA.transportVariation).toFixed(1)],
    ['elbow_rom_deg', qualityA.elbowRom.toFixed(1), qualityB.elbowRom.toFixed(1), (qualityB.elbowRom - qualityA.elbowRom).toFixed(1)],
    ['total_seconds', qualityA.totalSeconds.toFixed(2), qualityB.totalSeconds.toFixed(2), (qualityB.totalSeconds - qualityA.totalSeconds).toFixed(2)],
    ...baPhases.map((p): [string, string, string, string] => {
      const a = qualityA.phaseSeconds[p];
      const b = qualityB.phaseSeconds[p];
      return [`phase_${p}_s`, a?.toFixed(3) ?? '', b?.toFixed(3) ?? '', a != null && b != null ? (b - a).toFixed(3) : ''];
    }),
  ];
  // Unused reference guard kept intentionally lightweight
  void baObserved;
  void createBaEvents;
  return '\uFEFF' + ['metric,trial_A,trial_B,delta', ...rows.map((r) => r.map(csvCell).join(','))].join('\r\n');
}

export function downloadTextFile(content: string, filename: string, mime = 'text/plain;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1200);
}

export function exportTrialVideo(trial: Trial, filenameBase: string): boolean {
  if (!trial.video) return false;
  const url = URL.createObjectURL(trial.video);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${filenameBase}.webm`;
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1200);
  return true;
}
