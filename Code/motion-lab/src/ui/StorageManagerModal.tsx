import { useEffect, useState } from 'react';
import { HardDrive, Trash2, Video, X } from 'lucide-react';
import { exportTrialVideo } from '../export/exportReport';
import type { Trial } from '../model';
import { summarizeLocalStorage } from '../store';
import type { Lang } from '../text';
import { formatLocalDateKey, type ArchiveSubject, type ArchiveText } from './archive';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function StorageManagerModal({
  open,
  onClose,
  trials,
  subjects,
  lang,
  copy,
  onStripVideo,
  onClearAllVideos,
}: {
  open: boolean;
  onClose: () => void;
  trials: readonly Trial[];
  subjects: readonly ArchiveSubject[];
  lang: Lang;
  copy: ArchiveText;
  onStripVideo: (trial: Trial) => Promise<void>;
  onClearAllVideos: () => Promise<void>;
}) {
  const [quotaText, setQuotaText] = useState<string>('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const summary = summarizeLocalStorage(trials);
  const videoTrials = trials.filter((t) => t.video && t.video.size > 0);

  useEffect(() => {
    if (!open || typeof navigator === 'undefined' || !navigator.storage?.estimate) return;
    void navigator.storage.estimate().then((est) => {
      if (est.usage != null && est.quota != null && est.quota > 0) {
        const pct = ((est.usage / est.quota) * 100).toFixed(2);
        setQuotaText(`${formatBytes(est.usage)} / ${formatBytes(est.quota)} (${pct}%)`);
      }
    }).catch(() => undefined);
  }, [open, summary.videoBytes]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return <div className="storage-modal-backdrop" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
    <section className="glass storage-modal" role="dialog" aria-modal="true" aria-label={copy.storageTitle}>
      <header className="storage-modal-head">
        <div className="panel-title">
          <HardDrive size={17} />
          <h2>{copy.storageTitle}</h2>
        </div>
        <button type="button" className="icon-button" aria-label={copy.cancel} onClick={onClose}>
          <X size={16} />
        </button>
      </header>

      <div className="storage-kpi-row">
        <div className="well storage-kpi">
          <span>{copy.storageTotalTrials}</span>
          <strong>{summary.totalTrials}</strong>
        </div>
        <div className="well storage-kpi">
          <span>{copy.storageVideoCount}</span>
          <strong>{summary.videoTrials}</strong>
        </div>
        <div className="well storage-kpi">
          <span>{copy.storageVideoSize}</span>
          <strong>{formatBytes(summary.videoBytes)}</strong>
        </div>
      </div>

      {quotaText && <p className="storage-quota-line">IndexedDB: {quotaText}</p>}
      <p className="storage-hint">{copy.keepMetricsHint}</p>

      <div className="storage-list-wrap">
        {videoTrials.length === 0 ? (
          <div className="well storage-empty">{copy.noVideos}</div>
        ) : (
          <ul className="storage-video-list">
            {videoTrials.map((trial) => {
              const sub = subjects.find((s) => s.id === trial.subjectId);
              const dk = trial.dateKey ?? formatLocalDateKey(trial.started);
              const num = String(trial.subjectTrialNumber ?? trial.number).padStart(2, '0');
              const label = `${sub?.name ?? copy.unassigned} · ${dk} (${lang === 'zh' ? `第 ${num} 次` : `#${num}`})`;
              const size = trial.video?.size ?? 0;
              return <li key={trial.id} className="well storage-video-row">
                <div className="storage-video-meta">
                  <strong>{label}</strong>
                  <small>{formatBytes(size)} · {trial.videoTime.toFixed(1)} s</small>
                </div>
                <div className="storage-video-actions">
                  <button
                    type="button"
                    className="button"
                    onClick={() => exportTrialVideo(trial, `MotionLab_${sub?.id ?? 'Trial'}_${dk}_${num}`)}
                  >
                    <Video size={13} /><span>{copy.exportVideo}</span>
                  </button>
                  <button
                    type="button"
                    className="button stop-button"
                    disabled={busyId !== null}
                    onClick={async () => {
                      setBusyId(trial.id);
                      try { await onStripVideo(trial); }
                      finally { setBusyId(null); }
                    }}
                  >
                    <Trash2 size={13} /><span>{copy.clearVideo}</span>
                  </button>
                </div>
              </li>;
            })}
          </ul>
        )}
      </div>

      <footer className="storage-modal-foot">
        <button type="button" className="button" onClick={onClose}>{copy.cancel}</button>
        {videoTrials.length > 0 && <button
          type="button"
          className="button stop-button"
          disabled={busyId !== null}
          onClick={async () => {
            setBusyId('all');
            try { await onClearAllVideos(); }
            finally { setBusyId(null); }
          }}
        >
          <Trash2 size={14} /><span>{copy.clearAllVideos}</span>
        </button>}
      </footer>
    </section>
  </div>;
}
