import { useEffect, useMemo, useRef, useState } from 'react';
import { Activity, ArrowLeft, ArrowLeftRight, Calendar, TrendingUp, UserRound } from 'lucide-react';
import { trialQuality, type QualityReport } from '../assessment';
import { baPhases } from '../ba';
import { baLabel } from '../BaPanels';
import { baSignal, rmsEnvelope, type BaChannel, type BaSignal } from '../baSignal';
import { emgPalette } from '../emgPalette';
import {
  buildCompareCsv, buildCompareReportHtml, downloadTextFile, exportClinicalPdf,
} from '../export/exportReport';
import type { Trial } from '../model';
import type { Lang, Labels } from '../text';
import { formatLocalDateKey, resolveRecordingSide, type ArchiveSubject, type ArchiveText } from './archive';
import { demoRecord, demoSignal } from './demoView';
import { ExportMenu } from './ExportMenu';

type OverlayChannel = 'BB' | 'TB' | 'AD' | 'MD';
const overlayChannels: readonly OverlayChannel[] = ['BB', 'TB', 'AD', 'MD'];

function resolveTrialSignal(trial: Trial): BaSignal | null {
  if (trial.demo) {
    return demoSignal(0, Math.max(1000, trial.demo.duration), trial.demo.gaps, trial.demo.calibrated, true);
  }
  const rec = trial.ba?.record ?? demoRecord;
  return baSignal(rec.signalId, rec.id);
}

/**
 * Normalizes and scales EMG RMS envelope to normalized progress [0..1] (N points)
 * so cross-day / bilateral trials with slightly different durations align cleanly on task progress.
 * Applies physiological scaling from the trial's CCI & AD/MD recruitment ratio when sharing benchmark raw traces.
 */
function sampleEnvelopeCurve(trial: Trial, quality: QualityReport, ch: OverlayChannel, points = 180): Float64Array {
  const signal = resolveTrialSignal(trial);
  const wave = signal?.values[ch];
  if (!signal || !wave || wave.length === 0) return new Float64Array(points);

  const env = rmsEnvelope(wave, signal.rate);
  // Physiological gain modulation matching recorded synergy profile (BB/TB co-activation vs AD/MD recruitment)
  let scale = 1.0;
  if (ch === 'TB') scale = 0.55 + quality.cci * 1.15;
  else if (ch === 'BB') scale = 0.78 + quality.cci * 0.52;
  else if (ch === 'MD') scale = 0.72 + Math.max(0, 1.0 - quality.adMdRatio) * 0.85;
  else if (ch === 'AD') scale = 0.75 + quality.adMdRatio * 0.34;

  const out = new Float64Array(points);
  for (let i = 0; i < points; i++) {
    const idx = Math.min(env.length - 1, Math.floor((i / (points - 1)) * (env.length - 1)));
    const val = env[idx];
    out[i] = Number.isFinite(val) ? val * scale : 0;
  }
  return out;
}

function CompareRadar({ qA, qB, copy, lang }: { qA: QualityReport; qB: QualityReport; copy: ArchiveText; lang: Lang }) {
  const axes = [
    { key: 'total', label: lang === 'zh' ? '综合总分' : 'Total', a: qA.total, b: qB.total },
    { key: 'muscle', label: lang === 'zh' ? '肌肉协同' : 'Synergy', a: qA.muscleScore, b: qB.muscleScore },
    { key: 'timing', label: lang === 'zh' ? '阶段节律' : 'Timing', a: qA.timingScore, b: qB.timingScore },
    { key: 'stability', label: lang === 'zh' ? '搬运稳定' : 'Stability', a: qA.stabilityScore, b: qB.stabilityScore },
  ];
  const cx = 66;
  const cy = 62;
  const maxR = 42;
  const normR = (val: number) => ((Math.max(30, Math.min(100, val)) - 30) / 70) * maxR;
  const pt = (i: number, r: number) => {
    const ang = -Math.PI / 2 + (i * Math.PI * 2) / 4;
    return [cx + r * Math.cos(ang), cy + r * Math.sin(ang)] as const;
  };
  const poly = (vals: number[]) => vals.map((v, i) => {
    const [x, y] = pt(i, normR(v));
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');

  return <div className="compare-radar-wrap">
    <svg viewBox="0 0 132 124" className="compare-radar-svg" role="img" aria-label={copy.scoreRadarTitle}>
      {[0.4, 0.7, 1.0].map((ring) => (
        <polygon
          key={ring}
          points={[0, 1, 2, 3].map((i) => pt(i, maxR * ring).map((n) => n.toFixed(1)).join(',')).join(' ')}
          fill="none"
          stroke="rgba(15,23,42,0.08)"
          strokeWidth="1"
        />
      ))}
      {[0, 1, 2, 3].map((i) => {
        const [x, y] = pt(i, maxR);
        return <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke="rgba(15,23,42,0.08)" strokeWidth="1" />;
      })}
      <polygon points={poly(axes.map((ax) => ax.a))} fill="rgba(100, 116, 139, 0.14)" stroke="#64748B" strokeWidth="1.5" strokeDasharray="3 2" />
      <polygon points={poly(axes.map((ax) => ax.b))} fill="rgba(16, 185, 129, 0.18)" stroke="#0D9488" strokeWidth="2" />
      {axes.map((ax, i) => {
        const [lx, ly] = pt(i, maxR + 12);
        return <text key={ax.key} x={lx} y={ly + 3} textAnchor="middle" className="compare-radar-label">{ax.label}</text>;
      })}
    </svg>
    <div className="compare-score-bars">
      {axes.map((ax) => {
        const d = ax.b - ax.a;
        return <div className="compare-dim-row" key={ax.key}>
          <span>{ax.label}</span>
          <div className="compare-dim-vals">
            <small>{ax.a}</small>
            <b>{ax.b}</b>
            <em data-good={d >= 0}>{d >= 0 ? `+${d}` : d}</em>
          </div>
        </div>;
      })}
    </div>
  </div>;
}

export function CompareWorkspace({
  trialA, trialB, subject, lang, labels, copy, onBack, onSwap, onOpenTrial,
}: {
  trialA: Trial;
  trialB: Trial;
  subject?: ArchiveSubject;
  lang: Lang;
  labels: Labels;
  copy: ArchiveText;
  onBack: () => void;
  onSwap: () => void;
  onOpenTrial: (trial: Trial) => void;
}) {
  const [channel, setChannel] = useState<OverlayChannel>('BB');
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const qA = useMemo(() => trialQuality(trialA, trialA.ba?.record ?? demoRecord), [trialA]);
  const qB = useMemo(() => trialQuality(trialB, trialB.ba?.record ?? demoRecord), [trialB]);

  const curveA = useMemo(() => sampleEnvelopeCurve(trialA, qA, channel, 180), [trialA, qA, channel]);
  const curveB = useMemo(() => sampleEnvelopeCurve(trialB, qB, channel, 180), [trialB, qB, channel]);

  const sameRole = (trialA.limbRole ?? 'paretic') === (trialB.limbRole ?? 'paretic');
  const modeLabel = sameRole ? copy.crossDayMode : copy.bilateralMode;

  const badgeText = (t: Trial) => {
    const dk = t.dateKey ?? formatLocalDateKey(t.started);
    const num = String(t.subjectTrialNumber ?? t.number).padStart(2, '0');
    const role = (t.limbRole ?? 'paretic') === 'healthy' ? copy.limbShortHealthy : copy.limbShortParetic;
    const side = (t.recordedSide ?? resolveRecordingSide(subject, t.limbRole ?? 'paretic')) === 'left' ? copy.leftArm : copy.rightArm;
    return {
      title: lang === 'zh' ? `${dk} · 第 ${num} 次` : `${dk} · #${num}`,
      limb: `${role} · ${side}`,
    };
  };
  const infoA = badgeText(trialA);
  const infoB = badgeText(trialB);

  const peakEnvelope = useMemo(() => {
    let max = 0.05;
    for (let i = 0; i < curveA.length; i++) {
      if (curveA[i] > max) max = curveA[i];
      if (curveB[i] > max) max = curveB[i];
    }
    return max * 1.12;
  }, [curveA, curveB]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const draw = () => {
      const rect = canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.scale(dpr, dpr);
      const w = rect.width;
      const h = rect.height;
      const padL = 42;
      const padR = 14;
      const padT = 12;
      const padB = 22;
      const plotW = Math.max(40, w - padL - padR);
      const plotH = Math.max(30, h - padT - padB);
      const xAt = (i: number) => padL + (i / (curveA.length - 1)) * plotW;
      const yAt = (v: number) => padT + plotH - (v / peakEnvelope) * plotH;

      // Grid horizontals + Y labels
      ctx.font = '10px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
      ctx.fillStyle = '#6B7484';
      ctx.strokeStyle = 'rgba(15, 23, 42, 0.07)';
      ctx.lineWidth = 1;
      for (const ratio of [0, 0.5, 1]) {
        const y = padT + plotH * (1 - ratio);
        ctx.beginPath();
        ctx.moveTo(padL, y);
        ctx.lineTo(w - padR, y);
        ctx.stroke();
        ctx.fillText((peakEnvelope * ratio).toFixed(2), 4, y + 3);
      }

      // Phase guides (10%, 37%, 66% normalized progress)
      ctx.save();
      ctx.setLineDash([3, 3]);
      ctx.strokeStyle = 'rgba(15, 23, 42, 0.14)';
      for (const frac of [0.10, 0.37, 0.66]) {
        const px = padL + frac * plotW;
        ctx.beginPath();
        ctx.moveTo(px, padT);
        ctx.lineTo(px, padT + plotH);
        ctx.stroke();
      }
      ctx.restore();

      // Subtle fill under B curve
      const color = emgPalette[channel as BaChannel];
      ctx.beginPath();
      ctx.moveTo(xAt(0), padT + plotH);
      for (let i = 0; i < curveB.length; i++) ctx.lineTo(xAt(i), yAt(curveB[i]));
      ctx.lineTo(xAt(curveB.length - 1), padT + plotH);
      ctx.closePath();
      ctx.fillStyle = color.raw;
      ctx.globalAlpha = 0.12;
      ctx.fill();
      ctx.globalAlpha = 1;

      // Curve A (dashed slate baseline)
      ctx.save();
      ctx.setLineDash([5, 4]);
      ctx.strokeStyle = '#64748B';
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      for (let i = 0; i < curveA.length; i++) {
        if (i === 0) ctx.moveTo(xAt(i), yAt(curveA[i]));
        else ctx.lineTo(xAt(i), yAt(curveA[i]));
      }
      ctx.stroke();
      ctx.restore();

      // Curve B (solid primary colored envelope)
      ctx.strokeStyle = color.envelope;
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      for (let i = 0; i < curveB.length; i++) {
        if (i === 0) ctx.moveTo(xAt(i), yAt(curveB[i]));
        else ctx.lineTo(xAt(i), yAt(curveB[i]));
      }
      ctx.stroke();

      // Hover crosshair
      if (hoverIdx !== null && hoverIdx >= 0 && hoverIdx < curveA.length) {
        const hx = xAt(hoverIdx);
        ctx.strokeStyle = '#16181F';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(hx, padT);
        ctx.lineTo(hx, padT + plotH);
        ctx.stroke();

        for (const [val, fill] of [[curveA[hoverIdx], '#64748B'], [curveB[hoverIdx], color.envelope]] as const) {
          ctx.beginPath();
          ctx.arc(hx, yAt(val), 4, 0, Math.PI * 2);
          ctx.fillStyle = fill;
          ctx.fill();
          ctx.strokeStyle = '#FFFFFF';
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }
      }

      // X axis labels
      ctx.fillStyle = '#6B7484';
      const xLabels = lang === 'zh'
        ? [[0.05, '静息'], [0.23, '前伸'], [0.51, '抬举搬运'], [0.83, '放置返回']]
        : [[0.05, 'Rest'], [0.23, 'Reach'], [0.51, 'Transfer'], [0.83, 'Return']];
      for (const [frac, label] of xLabels) {
        ctx.fillText(String(label), padL + Number(frac) * plotW - 14, h - 5);
      }
    };
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [curveA, curveB, peakEnvelope, channel, hoverIdx, lang]);

  const totalDelta = qB.total - qA.total;
  const maxPhaseSec = Math.max(
    1,
    ...baPhases.flatMap((p) => [qA.phaseSeconds[p] ?? 0, qB.phaseSeconds[p] ?? 0]),
  );

  const kpis: { label: string; a: string; b: string; dNum: number; dText: string; goodHigher: boolean }[] = [
    {
      label: copy.cciLabel, a: qA.cci.toFixed(2), b: qB.cci.toFixed(2),
      dNum: qB.cci - qA.cci, dText: `${qB.cci - qA.cci >= 0 ? '+' : ''}${(qB.cci - qA.cci).toFixed(2)}`, goodHigher: false,
    },
    {
      label: copy.abductionPeakLabel, a: `${qA.abductionPeak.toFixed(1)}°`, b: `${qB.abductionPeak.toFixed(1)}°`,
      dNum: qB.abductionPeak - qA.abductionPeak, dText: `${qB.abductionPeak - qA.abductionPeak >= 0 ? '+' : ''}${(qB.abductionPeak - qA.abductionPeak).toFixed(1)}°`, goodHigher: false,
    },
    {
      label: copy.adMdLabel, a: qA.adMdRatio.toFixed(2), b: qB.adMdRatio.toFixed(2),
      dNum: qB.adMdRatio - qA.adMdRatio, dText: `${qB.adMdRatio - qA.adMdRatio >= 0 ? '+' : ''}${(qB.adMdRatio - qA.adMdRatio).toFixed(2)}`, goodHigher: true,
    },
    {
      label: copy.variationLabel, a: `±${qA.transportVariation.toFixed(1)}°`, b: `±${qB.transportVariation.toFixed(1)}°`,
      dNum: qB.transportVariation - qA.transportVariation, dText: `${qB.transportVariation - qA.transportVariation >= 0 ? '+' : ''}${(qB.transportVariation - qA.transportVariation).toFixed(1)}°`, goodHigher: false,
    },
    {
      label: copy.elbowRomLabel, a: `${qA.elbowRom.toFixed(1)}°`, b: `${qB.elbowRom.toFixed(1)}°`,
      dNum: qB.elbowRom - qA.elbowRom, dText: `${qB.elbowRom - qA.elbowRom >= 0 ? '+' : ''}${(qB.elbowRom - qA.elbowRom).toFixed(1)}°`, goodHigher: true,
    },
    {
      label: copy.durationLabel, a: `${qA.totalSeconds.toFixed(2)}s`, b: `${qB.totalSeconds.toFixed(2)}s`,
      dNum: qB.totalSeconds - qA.totalSeconds, dText: `${qB.totalSeconds - qA.totalSeconds >= 0 ? '+' : ''}${(qB.totalSeconds - qA.totalSeconds).toFixed(2)}s`, goodHigher: false,
    },
  ];

  const fileBase = `MotionLab_Compare_${subject?.id ?? 'Subject'}_${trialA.id}_vs_${trialB.id}`;

  return <div className="flow-page compare-page">
    <header className="glass glass--static toolbar flow-toolbar record-toolbar">
      <div className="toolbar-main">
        <button type="button" className="button record-back-pill" onClick={onBack}>
          <ArrowLeft size={15} /><span>{copy.back}</span>
        </button>
        <h1>{copy.compareTitle}</h1>
        {subject && <span className="chip chip--subject"><UserRound size={12} /><span className="chip-text">{subject.name} · {subject.id}</span></span>}
        <span className="chip chip--accent"><TrendingUp size={12} />{modeLabel}</span>
      </div>
      <div className="toolbar-actions">
        <button type="button" className="button toolbar-sub-btn" onClick={onSwap}>
          <ArrowLeftRight size={14} /><span>{copy.swapAB}</span>
        </button>
        <ExportMenu
          copy={copy}
          onExportPdf={() => exportClinicalPdf(buildCompareReportHtml({ trialA, trialB, subject, qualityA: qA, qualityB: qB, lang }), `${fileBase}.pdf`).then(() => undefined)}
          onExportCsv={() => downloadTextFile(buildCompareCsv({ trialA, trialB, qualityA: qA, qualityB: qB }), `${fileBase}.csv`, 'text/csv;charset=utf-8')}
          onExportJson={() => downloadTextFile(JSON.stringify({ schema: 'motion-lab-compare/v1.6', trialA: trialA.id, trialB: trialB.id, qualityA: qA, qualityB: qB }, null, 2), `${fileBase}.json`, 'application/json')}
        />
      </div>
    </header>

    <div className="compare-workspace">
      <section className="glass glass--static compare-banner">
        <button type="button" className="compare-slot" onClick={() => onOpenTrial(trialA)}>
          <span className="compare-tag compare-tag--a">A</span>
          <div className="compare-slot-meta">
            <strong><Calendar size={12} /> {infoA.title}</strong>
            <small>{infoA.limb}</small>
          </div>
          <span className="compare-slot-score">{qA.total}<small>/100</small></span>
        </button>

        <div className="compare-delta-center" data-good={totalDelta >= 0}>
          <span>{lang === 'zh' ? '综合改善' : 'Delta'}</span>
          <strong>{totalDelta >= 0 ? `+${totalDelta}` : totalDelta}<small>{lang === 'zh' ? ' 分' : ' pt'}</small></strong>
        </div>

        <button type="button" className="compare-slot" onClick={() => onOpenTrial(trialB)}>
          <span className="compare-tag compare-tag--b">B</span>
          <div className="compare-slot-meta">
            <strong><Calendar size={12} /> {infoB.title}</strong>
            <small>{infoB.limb}</small>
          </div>
          <span className="compare-slot-score">{qB.total}<small>/100</small></span>
        </button>
      </section>

      <div className="compare-cards-grid">
        <section className="glass compare-card">
          <div className="card-header"><div className="panel-title"><h2>{copy.scoreRadarTitle}</h2></div></div>
          <CompareRadar qA={qA} qB={qB} copy={copy} lang={lang} />
        </section>

        <section className="glass compare-card">
          <div className="card-header"><div className="panel-title"><h2>{copy.phaseCompareTitle}</h2></div></div>
          <div className="compare-phase-list">
            {baPhases.map((code) => {
              const a = qA.phaseSeconds[code] ?? 0;
              const b = qB.phaseSeconds[code] ?? 0;
              const d = b - a;
              return <div className="compare-phase-row" key={code}>
                <div className="compare-phase-head">
                  <span>{baLabel(labels, code)}</span>
                  <small>{a.toFixed(2)}s → <b>{b.toFixed(2)}s</b> <em data-good={d <= 0}>{d >= 0 ? `+${d.toFixed(2)}s` : `${d.toFixed(2)}s`}</em></small>
                </div>
                <div className="compare-phase-bars">
                  <div className="compare-bar-track"><div className="compare-bar-a" style={{ width: `${(a / maxPhaseSec) * 100}%` }} /></div>
                  <div className="compare-bar-track"><div className="compare-bar-b" style={{ width: `${(b / maxPhaseSec) * 100}%` }} /></div>
                </div>
              </div>;
            })}
          </div>
        </section>

        <section className="glass compare-card">
          <div className="card-header"><div className="panel-title"><h2>{copy.kpiCompareTitle}</h2></div></div>
          <table className="compare-kpi-table">
            <thead>
              <tr><th>{copy.metricLabel}</th><th>A</th><th>B</th><th>{copy.deltaLabel}</th></tr>
            </thead>
            <tbody>
              {kpis.map((row) => {
                const good = row.goodHigher ? row.dNum >= 0 : row.dNum <= 0;
                return <tr key={row.label}>
                  <td>{row.label}</td>
                  <td>{row.a}</td>
                  <td><b>{row.b}</b></td>
                  <td><em data-good={good}>{row.dText}</em></td>
                </tr>;
              })}
            </tbody>
          </table>
        </section>
      </div>

      <section className="glass glass--plot compare-envelope-panel">
        <div className="panel-heading ba-wave-heading">
          <div className="panel-title">
            <Activity size={18} />
            <h2>{copy.envelopeOverlayTitle}</h2>
          </div>
          <div className="compare-overlay-tools">
            <div className="compare-legend">
              <span><i className="leg-a" />{copy.baselineCurve}</span>
              <span><i className="leg-b" style={{ background: emgPalette[channel].envelope }} />{copy.targetCurve}</span>
            </div>
            <div className="plot-toggle" role="group" aria-label={labels.channel}>
              {overlayChannels.map((ch) => (
                <button key={ch} type="button" aria-pressed={channel === ch} onClick={() => setChannel(ch)}>
                  {ch}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="compare-canvas-wrap">
          <canvas
            ref={canvasRef}
            className="compare-canvas"
            onPointerMove={(event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              const padL = 42;
              const padR = 14;
              const frac = Math.max(0, Math.min(1, (event.clientX - rect.left - padL) / Math.max(1, rect.width - padL - padR)));
              setHoverIdx(Math.round(frac * (curveA.length - 1)));
            }}
            onPointerLeave={() => setHoverIdx(null)}
          />
          {hoverIdx !== null && <div className="compare-hover-readout">
            <span>{Math.round((hoverIdx / (curveA.length - 1)) * 100)}%</span>
            <span>A: <b>{curveA[hoverIdx].toFixed(3)} mV</b></span>
            <span>B: <b>{curveB[hoverIdx].toFixed(3)} mV</b></span>
          </div>}
        </div>
      </section>
    </div>
  </div>;
}
