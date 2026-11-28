import { useCallback, useEffect, useRef, type RefObject } from 'react';
import { Activity, ArrowUpRight, Camera, CameraOff, Flag, Video, VideoOff } from 'lucide-react';
import { activation, detour, phases, sampleSource, type Answer, type Kinematic, type Outcome, type Trial } from './model';
import type { Labels } from './text';

export type VideoStatus = 'none' | 'loading' | 'ready' | 'recording' | 'paused' | 'recorded' | 'unavailable' | 'interrupted';

export function Evidence({ t, preview, reviewRef, url, status, onMetadata, onPreview, onClose, short, repository }: {
  t: Labels;
  preview?: MediaStream | null;
  reviewRef?: RefObject<HTMLVideoElement | null>;
  url?: string;
  status: VideoStatus;
  onMetadata?: () => void;
  onPreview?: () => void;
  onClose?: () => void;
  short?: boolean;
  repository?: boolean;
}) {
  const liveVideo = useRef<HTMLVideoElement>(null);
  const bindReview = useCallback((element: HTMLVideoElement | null) => {
    if (!reviewRef) return;
    const previous = reviewRef.current;
    if (!element && previous) {
      previous.pause();
      previous.removeAttribute('src');
      previous.load();
    }
    reviewRef.current = element;
  }, [reviewRef]);
  useEffect(() => {
    if (liveVideo.current) liveVideo.current.srcObject = preview ?? null;
  }, [preview]);
  const statusLabel = {
    none: t.none, loading: t.preparingCamera, ready: t.cameraOn, recording: t.recording, paused: t.recordingPaused,
    recorded: t.recorded, unavailable: t.unavailable, interrupted: t.disconnected,
  }[status];
  return <section className="glass evidence" aria-labelledby="evidence-title" data-panel="video">
    <div className="card-header">
      <div className="panel-title"><Video size={16} /><h2 id="evidence-title">{t.video}</h2></div>
      <div className="evidence-header-actions">
        {status === 'recording' && <span className="rec-mark"><i /> REC</span>}
        {(onPreview || onClose) && <button type="button" className="button evidence-cam-btn"
          disabled={status === 'loading' || status === 'recording'}
          title={onClose ? t.closePreview : t.preview}
          onClick={onClose ?? onPreview}>
          {onClose ? <CameraOff size={13} /> : <Camera size={13} />}
          <span>{onClose ? t.closePreview : t.preview}</span>
        </button>}
      </div>
    </div>
    <div className="card-body">
      <div className={'video-frame' + (!preview && !url ? ' well well--empty' : '')}>
        {preview && <video ref={liveVideo} autoPlay muted playsInline aria-label={t.evidenceOnly} />}
        {url && <video key={url} ref={bindReview} src={url} preload="metadata" onLoadedMetadata={onMetadata} playsInline muted aria-label={t.video} />}
        {!preview && !url && <div className="video-empty">
          <VideoOff size={24} strokeWidth={1.4} />
          <strong>{repository && !onPreview ? t.baNoVideo : statusLabel}</strong>
          {onPreview && status !== 'loading' && <button type="button" className="button evidence-open-inline" onClick={onPreview}>
            <Camera size={13} />{t.preview}
          </button>}
        </div>}
        {preview && status === 'paused' && <span className="video-overlay">{t.recordingPaused}</span>}
        {short && url && <span className="video-overlay">{t.lowVideo}</span>}
        {(preview || url) && <div className="video-foot"><i /><span>{repository ? t.baLocalVideo : statusLabel}</span></div>}
      </div>
    </div>
  </section>;
}

type Jump = (time: number, kind?: Kinematic, range?: 'detour' | 'activation') => void;

function Metric({ name, value, onClick }: { name: string; value: string; onClick?: () => void }) {
  const content = <><span>{name}</span><b>{value}</b>{onClick && <ArrowUpRight size={13} className="metric-arrow" />}</>;
  return onClick ? <button className="metric-row" type="button" onClick={onClick}>{content}</button>
    : <div className="metric-row">{content}</div>;
}

export function OutcomeSummary({ t, outcome }: { t: Labels; outcome: Outcome }) {
  return <div className="outcome-summary">
    <h3><Flag size={16} />{t.outcome}<span>{t.manual}</span></h3>
    {(['success', 'drop', 'assist'] as const).map((key) =>
      <div key={key} className="outcome-row"><span>{t[key]}</span><strong>{t[outcome[key]]}</strong></div>)}
  </div>;
}

export function ReviewPanel({ t, trial, jump }: { t: Labels; trial: Trial; jump: Jump }) {
  const values = sampleSource.metrics;
  return <section className="glass assessment report" aria-labelledby="report-title">
    <div className="panel-heading">
      <div className="panel-title"><Activity size={21} /><h2 id="report-title">{t.quality}</h2></div>
      {!trial.complete && <span className="short-status">{t.aborted}</span>}
    </div>
    {trial.elapsed >= detour.from && <button type="button" className="detour-link" onClick={() => jump(detour.from, 'shoulder', 'detour')}>
      <span>{t.event}</span><b>{detour.from.toFixed(2)}–{Math.min(trial.elapsed, detour.to).toFixed(2)} s</b><ArrowUpRight size={14} />
    </button>}
    {trial.complete ? <>
      <div className="total-score"><span>{t.total}</span><strong>{sampleSource.total}<small> / 100</small></strong></div>
      <div className="score-lines">
        <Metric name={t.muscleScore} value={String(sampleSource.scores[0])} onClick={() => jump(detour.from, 'shoulder', 'detour')} />
        <Metric name={t.timingScore} value={String(sampleSource.scores[1])} onClick={() => jump(0)} />
        <Metric name={t.stabilityScore} value={String(sampleSource.scores[2])} onClick={() => jump(5, 'forearm')} />
      </div>
    </> : <p className="incomplete">{t.incomplete}</p>}
    <OutcomeSummary t={t} outcome={trial.outcome} />
    <details className="metric-details">
      <summary>{t.details}</summary>
      <div className="metrics">
        <Metric name={t.totalTime} value={trial.elapsed.toFixed(2) + ' s'} />
        {phases.filter((phase) => phase.start < trial.elapsed).map((phase) => (
          <Metric key={phase.id} name={t[phase.id]} value={(Math.min(phase.end, trial.elapsed) - phase.start).toFixed(2) + ' s'}
            onClick={() => jump(phase.start)} />
        ))}
        {trial.elapsed >= detour.to && <Metric name={t.lateral} value={values.shoulder.toFixed(1) + '°'} onClick={() => jump(detour.from, 'shoulder', 'detour')} />}
        {trial.elapsed >= activation.to && <>
          <Metric name={t.cci} value={values.cci.toFixed(2)} onClick={() => jump(activation.from, undefined, 'activation')} />
          <Metric name={t.recruitment} value={values.ad.toFixed(2) + ' / ' + values.md.toFixed(2)} onClick={() => jump(activation.from, undefined, 'activation')} />
        </>}
        {trial.complete && <Metric name={t.rom} value={values.rom.toFixed(1) + '°'} onClick={() => jump(5, 'elbow')} />}
        {trial.elapsed >= 9 && <Metric name={t.variation} value={values.variation.toFixed(1) + '°'} onClick={() => jump(5, 'forearm')} />}
        {trial.elapsed >= 12 && <Metric name={t.sd} value={values.sd.toFixed(1) + '°'} onClick={() => jump(9, 'elbow')} />}
      </div>
    </details>
  </section>;
}

export function ConfirmOutcome({ t, pending, outcome, setOutcome, error, saving, onSave }: {
  t: Labels; pending: Trial; outcome: Outcome; setOutcome: (outcome: Outcome) => void;
  error: boolean; saving: boolean; onSave: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  return <dialog ref={dialog} className="outcome-dialog" aria-labelledby="outcome-title" onCancel={(event) => event.preventDefault()}>
    <form onSubmit={(event) => { event.preventDefault(); onSave(); }}>
      <div className="dialog-header"><div><h2 id="outcome-title">{t.confirm}</h2><p>{t.confirmHint}</p></div>
        <span className="trial-tag">{t.trial} {String(pending.number).padStart(3, '0')}</span></div>
      {(['success', 'drop', 'assist'] as const).map((key) => <fieldset className="outcome-field" key={key}>
        <legend>{t[key]}</legend>
        <div className="outcome-options">
          {(['yes', 'no', 'unknown'] as Answer[]).map((answer) => <label key={answer} className={outcome[key] === answer ? 'selected' : ''}>
            <input type="radio" name={key} checked={outcome[key] === answer} disabled={saving}
              onChange={() => setOutcome({ ...outcome, [key]: answer })} />
            <span>{t[answer]}</span>
          </label>)}
        </div>
      </fieldset>)}
      <div className="dialog-actions">
        {error && <p role="alert">{t.saveError}</p>}
        <button className="button primary" type="submit" disabled={saving}>{saving ? t.saving : error ? t.retry : t.save}<ArrowUpRight size={17} /></button>
      </div>
    </form>
  </dialog>;
}






