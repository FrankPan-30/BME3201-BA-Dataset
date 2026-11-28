import { Activity, ArrowRight, Clock3, Flag, Layers3 } from 'lucide-react';
import type { QualityReport } from './assessment';
import { baObserved, baSeconds, type BaEvent, type BaPhase, type BaRecord } from './ba';
import { OutcomeSummary } from './Panels';
import type { Trial } from './model';
import type { Labels } from './text';

export const baLabel = (t: Labels, code: BaPhase) => ({
  REST: t.baRest, REACH: t.reach, LIFT_TRANSFER: t.baTransfer, RETURN: t.return,
}[code]);

type MovementProps = {
  t: Labels;
  record: BaRecord;
  events: readonly BaEvent[];
  positionMs: number;
  trial?: Trial;
  selectedPhase?: BaPhase;
  onPhase?: (phase: BaPhase, startMs: number) => void;
  compact?: boolean;
};

export function BaMovement({ t, record, events, positionMs, trial, selectedPhase, onPhase, compact = false }: MovementProps) {
  const observed = record.phases.map((phase) => ({ ...phase, ...baObserved(events, phase.code) }));
  const terminal = events.find((event) => event.kind === 'trial-end');
  const atEnd = terminal !== undefined && positionMs >= terminal.atMs;
  const active = observed.find((phase) => phase.startMs !== null && phase.startMs <= positionMs
    && (phase.endMs === null || positionMs < phase.endMs));
  const future = record.phases.some((phase) => phase.startMs !== null && phase.startMs > positionMs);
  const past = events.some((event) => event.kind === 'phase-end' && event.atMs <= positionMs);
  const gap = !active && !atEnd && past && future;
  const stopped = (trial !== undefined && !trial.complete
    && positionMs >= record.originMs + Math.round(trial.elapsed * 1000));

  const headline = stopped ? t.aborted : atEnd ? t.baDone
    : active ? baLabel(t, active.code) : gap ? t.baGap : past ? t.baNoBoundary : t.baAwait;
  const timer = active?.startMs !== undefined && active.startMs !== null && !stopped && !atEnd
    ? baSeconds(Math.max(0, positionMs - active.startMs)) : null;
  const complete = trial?.ba?.segmentationComplete
    ?? observed.every((phase) => phase.startMs !== null && phase.endMs !== null);
  const notes = {
    ball_tracking_gap_after_placement: t.baPlacementGap,
    no_sustained_hand_away_and_wrist_home: t.baMissingReturn,
    tracking_gap_during_return_search: t.baTrackingGap,
  } as Record<string, string>;

  const waiting = headline === t.baAwait || headline === t.baNoBoundary;
  const phaseCards = observed.map((phase) => {
    const started = phase.startMs !== null;
    const ended = started && phase.endMs !== null;
    const unresolved = phase.status === 'unresolved' && !ended && (Boolean(terminal) || (!started && phase.endMs !== null));
    const needsReview = started && phase.status === 'review';
    const details = (needsReview || unresolved)
      ? phase.notes.split('|').filter(Boolean).map((note) => notes[note] ?? note).join(' · ')
      : '';
    const marked = !atEnd && !stopped && active?.code === phase.code;
    const state = unresolved ? 'unresolved' : marked ? 'active' : ended ? 'complete' : started ? 'partial' : 'pending';
    return { phase, ended, unresolved, needsReview, details, state };
  });

  return <section className={'glass ba-movement' + (compact ? ' ba-movement--compact' : '')} aria-labelledby="ba-movement-title" data-panel="mp">
    <div className="card-header">
      <div className="panel-title"><Layers3 size={16} /><h2 id="ba-movement-title">{t.timeline}</h2></div>
      {(terminal || trial) && <span className="ba-segmentation" data-complete={complete}>{complete ? t.baSegmentReady : t.baSegmentPartial}</span>}
    </div>
    <div className="card-body">
      <div className="ba-phase-focus">
        <div className="ba-phase-heading">
          <strong className={'value' + (waiting ? ' is-empty' : '')} data-testid="ba-current-phase"
            data-state={stopped ? 'stopped' : atEnd ? 'ended' : active?.code ?? (gap ? 'gap' : 'waiting')}>{headline}</strong>
          {timer !== null && <span className="ba-phase-timer"><b data-testid="ba-phase-timer">{timer}</b> <small>s</small></span>}
        </div>
        <div className="ba-phase-context"><Clock3 size={12} /><span>{t.baClock}</span>
          <b data-testid="ba-position" data-ms={positionMs}>{baSeconds(positionMs)} s</b>
        </div>
      </div>
      {phaseCards.map(({ phase, details }) => details && <p className="ba-phase-note" key={phase.code}>
        <b>{baLabel(t, phase.code)}</b> · {details}
      </p>)}
      <div className="ba-phase-grid">
        {phaseCards.map(({ phase, ended, needsReview, unresolved, details, state }) => {
          const range = ended ? baSeconds(phase.startMs!) + '–' + baSeconds(phase.endMs!) + ' s' : undefined;
          const hint = [range, details].filter(Boolean).join(' · ') || undefined;
          const content = <>
            <span className="ba-phase-label">{baLabel(t, phase.code)}</span>
            <strong className={'ba-phase-value' + (ended ? '' : ' is-pending-value')}>
              {ended ? <>{baSeconds(phase.endMs! - phase.startMs!)} <small>s</small></> : '—'}
            </strong>
            {needsReview && <span className="ba-boundary-flag">{t.baReview}</span>}
            {unresolved && <span className="ba-boundary-flag">{t.baNoBoundary}</span>}
          </>;
          return <div key={phase.code} className="ba-phase-cell well" data-state={state} data-phase={phase.code}>
            {onPhase && phase.startMs !== null
              ? <button type="button" className="ba-phase-card" title={hint} aria-pressed={selectedPhase === phase.code}
                  onClick={() => onPhase(phase.code, phase.startMs!)}>{content}</button>
              : <div className="ba-phase-card" title={hint}>{content}</div>}
          </div>;
        })}
      </div>
    </div>
  </section>;
}

/**
 * 3-Dimension Stroke Upper-Limb Movement Quality Assessment Card
 * 1. Muscle Compensation & Co-activation (CCI)
 * 2. Phase Timing
 * 3. Transport Stability
 * -> Composite Movement Quality Score (/100)
 */
export function QualityPanel({
  t, quality, active = true, live = false, onSelectDimension,
}: {
  t: Labels;
  quality: QualityReport | null;
  active?: boolean;
  live?: boolean;
  onSelectDimension?: (dim: 'muscle' | 'timing' | 'stability') => void;
}) {
  const isZh = t.muscleScore.includes('肌肉');
  const gradeText = !active || !quality
    ? (isZh ? '等待检测' : 'Standby')
    : quality.grade === 'excellent'
      ? (isZh ? '协同良好' : 'Good synergy')
      : quality.grade === 'mild'
        ? (isZh ? '轻度代偿' : 'Mild detour')
        : (isZh ? '明显代偿' : 'Compensatory');

  const gradeTone = !active || !quality ? 'idle' : quality.grade === 'excellent' ? 'ok' : quality.grade === 'mild' ? 'warn' : 'danger';

  const dimensions = [
    {
      id: 'muscle' as const,
      label: t.muscleScore,
      score: active && quality ? quality.muscleScore : null,
      sub: active && quality ? `CCI ${quality.cci.toFixed(2)} · ${isZh ? '外展' : 'Abd'} ${quality.abductionPeak}°` : 'CCI —',
    },
    {
      id: 'timing' as const,
      label: t.timingScore,
      score: active && quality ? quality.timingScore : null,
      sub: active && quality ? `${quality.totalSeconds.toFixed(2)} s` : '— s',
    },
    {
      id: 'stability' as const,
      label: t.stabilityScore,
      score: active && quality ? quality.stabilityScore : null,
      sub: active && quality ? `±${quality.transportVariation}° · ROM ${quality.elbowRom}°` : 'ROM —',
    },
  ];

  return <section className="glass ba-assessment quality-panel" aria-labelledby="quality-panel-title" data-panel="la">
    <div className="card-header">
      <div className="panel-title">
        <Activity size={16} />
        <h2 id="quality-panel-title">{isZh ? '动作质量评分' : 'Movement Quality'}</h2>
      </div>
      <span className="quality-grade-chip" data-tone={gradeTone}>
        <i aria-hidden="true" />
        {live && active ? (isZh ? '实时 · ' : 'Live · ') + gradeText : gradeText}
      </span>
    </div>
    <div className="card-body quality-body">
      <div className="quality-hero-row">
        <div className="quality-total-readout">
          <strong>{active && quality ? quality.total : '—'}</strong>
          <small>/ 100</small>
        </div>
        <div className="quality-kpi-badges">
          <span className="quality-kpi">
            <small>CCI</small>
            <b>{active && quality ? quality.cci.toFixed(2) : '—'}</b>
          </span>
          <span className="quality-kpi">
            <small>{isZh ? '姿态波动' : 'Var'}</small>
            <b>{active && quality ? `±${quality.transportVariation}°` : '—'}</b>
          </span>
        </div>
      </div>

      <div className="quality-dimensions">
        {dimensions.map((dim, idx) => {
          const inner = <>
            <div className="quality-dim-top">
              <span className="quality-dim-name">{idx + 1}. {dim.label}</span>
              <span className="quality-dim-meta">{dim.sub}</span>
              <b className="quality-dim-score">{dim.score ?? '—'}</b>
            </div>
            <div className="quality-bar-track" aria-hidden="true">
              <i className="quality-bar-fill" style={{ width: `${dim.score ?? 0}%` }} />
            </div>
          </>;
          return onSelectDimension && active
            ? <button key={dim.id} type="button" className="quality-dim-row" onClick={() => onSelectDimension(dim.id)}>{inner}</button>
            : <div key={dim.id} className="quality-dim-row">{inner}</div>;
        })}
      </div>
    </div>
  </section>;
}

export function BaAssessment({ t }: { t: Labels }) {
  return <QualityPanel t={t} quality={null} active={false} />;
}

export function BaResult({ t, trial }: { t: Labels; trial: Trial }) {
  return <section className="glass ba-assessment" aria-labelledby="ba-result-title" data-panel="la">
    <div className="card-header"><div className="panel-title"><Flag size={16} /><h2 id="ba-result-title">{t.baResult}</h2></div></div>
    <div className="card-body">
      <div className="ba-result-status"><span>{trial.complete ? t.baDone : t.aborted}</span><ArrowRight size={13} /><b>{t.manual}</b></div>
      <OutcomeSummary t={t} outcome={trial.outcome} />
    </div>
  </section>;
}
