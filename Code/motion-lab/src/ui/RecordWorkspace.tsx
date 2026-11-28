import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Calendar, MessageSquareText, Trash2, UserRound } from 'lucide-react';
import { evaluateMovementQuality, trialQuality } from '../assessment';
import { baElapsed, baObserved, createBaEvents, type BaPhase } from '../ba';
import { BaChart } from '../BaChart';
import { BaMovement, QualityPanel, baLabel } from '../BaPanels';
import { baSignal } from '../baSignal';
import { Chart } from '../Chart';
import {
  buildSingleTrialReportHtml, buildTrialCsv, downloadTextFile,
  exportClinicalPdf, exportTrialVideo,
} from '../export/exportReport';
import { Evidence, ReviewPanel } from '../Panels';
import { freshOutcome, phases, type Kinematic, type Trial, type TrialAnnotation } from '../model';
import { createPoseClock } from '../pose/poseClock';
import { createMockPose } from '../pose/mockPose';
import { createRecordedPose, type PoseRecord } from '../pose/poseRecord';
import type { PoseLabels } from '../pose/poseText';
import type { Lang, Labels } from '../text';
import {
  formatLocalDateKey, resolveRecordingSide,
  type ArchiveEntry, type ArchiveSubject, type ArchiveText,
} from './archive';
import { ClinicalNotesDrawer } from './ClinicalNotesDrawer';
import { demoBoundaries, demoPose, demoRecord, demoSignal } from './demoView';
import { ExportMenu } from './ExportMenu';
import type { FlowText } from './flowText';
import { DemoPlot } from './LiveWorkspace';
import { ReplayControls, ReplayShortcuts, useReplay } from './replayControls';

export function RecordWorkspace({
  t, labels, pose, copy, lang, entry, subject, poseRecords, attachPose, back, next, persist, discard, canUpdate,
}: {
  t: FlowText;
  labels: Labels;
  pose: PoseLabels;
  copy: ArchiveText;
  lang: Lang;
  entry: ArchiveEntry;
  subject?: ArchiveSubject;
  poseRecords: Record<string, PoseRecord>;
  attachPose: (id: string, data: PoseRecord | null) => void;
  back: () => void;
  next?: () => void;
  persist: (trial: Trial) => Promise<void>;
  discard: (id: string) => Promise<void>;
  canUpdate: boolean;
}) {
  const stored = entry.kind === 'trial' ? entry.trial : undefined;
  const record = entry.kind === 'example' ? entry.record : stored?.ba?.record;
  const demo = stored?.demo;
  const trial = useMemo<Trial>(() => stored ?? ({
    id: entry.id, number: 0, started: 0, source: 'ba-repository-v1', elapsed: record ? baElapsed(record, record.endMs) : 0,
    complete: true, outcome: freshOutcome, video: null, videoTime: 0, videoState: 'none',
  }), [entry.id, record, stored]);

  const events = useMemo(() => stored ? stored.ba?.events ?? [] : record ? createBaEvents(record) : [], [stored, record]);
  const boundaries = useMemo(() => {
    if (demo) return [...demoBoundaries.slice(0, -1).filter((edge) => edge < demo.duration), demo.duration];
    const times = record ? events.map((event) => event.atMs) : phases.flatMap((phase) => [phase.start * 1000, phase.end * 1000]);
    return [...new Set(times)].sort((a, b) => a - b);
  }, [demo, record, events]);

  const replay = useReplay(trial, record?.originMs ?? 0, boundaries);
  const [windowPhase, setWindowPhase] = useState<BaPhase>();
  const [kind, setKind] = useState<Kinematic>('elbow');
  const [focus, setFocus] = useState<'detour' | 'activation' | null>(null);
  const [reviewed, setReviewed] = useState(Boolean(stored?.reviewed));
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [error, setError] = useState<string>();
  const [working, setWorking] = useState(false);
  const discardDialog = useRef<HTMLDialogElement>(null);
  const clock = useMemo(createPoseClock, []);
  const available = (record?.originMs ?? 0) + Math.round(trial.elapsed * 1000);
  const transfer = baObserved(events, 'LIFT_TRANSFER');
  const inTransfer = transfer.startMs !== null && replay.position >= transfer.startMs
    && (transfer.endMs === null || replay.position < transfer.endMs);
  const windowEdges = windowPhase ? baObserved(events, windowPhase) : undefined;
  const analysis = windowPhase && windowEdges?.startMs != null
    ? { name: baLabel(labels, windowPhase), startMs: windowEdges.startMs, endMs: windowEdges.endMs ?? available } : undefined;

  const limbRole = stored?.limbRole ?? 'paretic';
  const recordedSide = stored?.recordedSide ?? resolveRecordingSide(subject, limbRole);
  const limbBadge = `${limbRole === 'healthy' ? copy.limbShortHealthy : copy.limbShortParetic} · ${recordedSide === 'left' ? copy.leftArm : copy.rightArm}`;
  const annotations = stored?.annotations ?? [];
  const clinicalNote = stored?.clinicalNote ?? '';
  const prescription = stored?.prescription ?? '';
  const noteCount = annotations.length + (clinicalNote.trim() ? 1 : 0);

  const quality = useMemo(() => {
    if (stored) return trialQuality(stored, record ?? demoRecord);
    if (record) {
      const sig = baSignal(record.signalId, record.id);
      return evaluateMovementQuality({
        record, events, signal: sig, positionMs: record.endMs, complete: true,
      });
    }
    return null;
  }, [stored, record, events]);

  useLayoutEffect(() => {
    clock.publish({ timeMs: replay.position, running: replay.playing, transfer: inTransfer });
  }, [clock, replay.position, replay.playing, inTransfer]);

  async function saveAnnotationsAndNotes(nextState: {
    annotations: TrialAnnotation[];
    clinicalNote: string;
    prescription: string;
    markReviewed?: boolean;
  }) {
    if (!stored) return;
    setWorking(true);
    setError(undefined);
    try {
      const nextReviewed = nextState.markReviewed ? true : reviewed;
      await persist({
        ...stored,
        annotations: nextState.annotations,
        clinicalNote: nextState.clinicalNote,
        prescription: nextState.prescription,
        reviewed: nextReviewed,
      });
      if (nextState.markReviewed) setReviewed(true);
    } catch {
      setError(copy.saveError);
    } finally {
      setWorking(false);
    }
  }

  async function remove() {
    setWorking(true);
    setError(undefined);
    try { await discard(trial.id); }
    catch { setError(copy.discardError); }
    finally {
      setWorking(false);
      discardDialog.current?.close();
    }
  }

  const trialNumLabel = stored
    ? `${lang === 'zh' ? '第 ' : '#'}${String(stored.subjectTrialNumber ?? stored.number).padStart(2, '0')}${lang === 'zh' ? ' 次' : ''}`
    : record?.id ?? trial.id;
  const dateLabel = stored?.started ? (stored.dateKey ?? formatLocalDateKey(stored.started)) : null;
  const fileBase = `MotionLab_${subject?.id ?? 'Benchmark'}_${dateLabel ?? 'Sample'}_${String(stored?.subjectTrialNumber ?? stored?.number ?? 1).padStart(2, '0')}`;

  function handleExportPdf() {
    if (!quality) return;
    const html = buildSingleTrialReportHtml({ trial, subject, quality, lang });
    return exportClinicalPdf(html, `${fileBase}.pdf`).then(() => undefined);
  }

  function handleExportCsv() {
    const targetRecord = record ?? demoRecord;
    const sig = demo
      ? demoSignal(0, Math.max(1000, demo.duration), demo.gaps, demo.calibrated, true)
      : baSignal(targetRecord.signalId, targetRecord.id);
    const attachedPose = record && poseRecords[record.id]
      ? createRecordedPose(poseRecords[record.id])
      : demo
        ? demoPose(demo.initialHealth, demo.gaps, true, false, demo.duration, recordedSide)
        : createMockPose(targetRecord, recordedSide);
    const csv = buildTrialCsv({ trial, record: targetRecord, signal: sig, pose: attachedPose, lang });
    downloadTextFile(csv, `${fileBase}.csv`, 'text/csv;charset=utf-8');
  }

  function handleExportJson() {
    const payload = {
      schema: 'motion-lab-assessment/v1.6',
      trialId: trial.id,
      subject: subject ? { id: subject.id, name: subject.name, pareticSide: subject.pareticSide } : null,
      limbRole,
      recordedSide,
      dateKey: dateLabel,
      trialNumber: stored?.subjectTrialNumber ?? stored?.number ?? 0,
      elapsedSeconds: trial.elapsed,
      quality,
      annotations,
      clinicalNote,
      prescription,
    };
    downloadTextFile(JSON.stringify(payload, null, 2), `${fileBase}.json`, 'application/json;charset=utf-8');
  }

  return <div className="flow-page">
    <header className="glass glass--static toolbar flow-toolbar record-toolbar">
      <div className="toolbar-main">
        <button type="button" className="button record-back-pill" onClick={back} aria-label={copy.back} title={copy.back}>
          <ArrowLeft size={15} /><span>{copy.back}</span>
        </button>
        <h1>{copy.trial}</h1>
        {subject && <span className="chip chip--subject" title={`${subject.name} · ${subject.id}`}>
          <UserRound size={12} /><span className="chip-text">{subject.name} · {subject.id}</span>
        </span>}
        {dateLabel && <span className="chip chip--date"><Calendar size={12} />{dateLabel} · {trialNumLabel}</span>}
        {!dateLabel && <span className="chip">{trialNumLabel}</span>}
        <span className="chip chip--limb" data-role={limbRole}>{limbBadge}</span>
        <span className="chip chip--accent">{stored ? (reviewed ? copy.reviewed : copy.pending) : labels.baOffline}</span>
      </div>
      <div className="toolbar-actions">
        {stored && <button
          type="button"
          className="button toolbar-sub-btn"
          aria-expanded={drawerOpen}
          onClick={() => setDrawerOpen((cur) => !cur)}
          title={copy.annotationsTitle}
        >
          <MessageSquareText size={14} />
          <span>{copy.notesBtn}</span>
          {noteCount > 0 && <b className="notes-count-badge">{noteCount}</b>}
        </button>}
        <ExportMenu
          copy={copy}
          hasVideo={Boolean(trial.video)}
          onExportPdf={() => handleExportPdf()}
          onExportCsv={handleExportCsv}
          onExportJson={handleExportJson}
          onExportVideo={trial.video ? () => { exportTrialVideo(trial, fileBase); } : undefined}
        />
        {stored && <button
          type="button"
          className="icon-button toolbar-trash-btn"
          disabled={working}
          title={t.discard}
          aria-label={t.discard}
          onClick={() => discardDialog.current?.showModal()}
        >
          <Trash2 size={15} />
        </button>}
        {next && <button type="button" className="button toolbar-sub-btn" onClick={next}>{t.new}</button>}
        <ReplayControls t={t} replay={replay} />
      </div>
    </header>
    <ReplayShortcuts replay={replay} />
    {error && <div className="storage-error" role="alert">{error}</div>}

    {demo ? <>
      <DemoPlot
        t={t}
        labels={{ ...labels, assess: copy.assessment }}
        pose={pose}
        trial={{ ...trial, quality: quality ?? trial.quality }}
        side={recordedSide}
        limbBadge={limbBadge}
        annotations={annotations}
        health={demo.initialHealth}
        known
        calibrated={demo.calibrated}
        gapHistory={demo.gaps}
        markers={demo.markers}
        position={replay.position}
        limit={demo.duration}
        seek={replay.seekMs}
        moving={replay.playing}
        stationary={false}
        assessment
        videoUrl={replay.url}
        videoRef={replay.video}
        onVideoMetadata={replay.onMetadata}
        videoStatus={trial.videoState}
        videoShort={Boolean(trial.video && replay.time > trial.videoTime + .15)}
      />
    </> : record ? <div className="ba-workspace">
      <div className="ba-header-grid">
        <BaMovement t={labels} record={record} events={events} positionMs={replay.position} trial={stored}
          selectedPhase={windowPhase} onPhase={(phase, at) => { setWindowPhase(phase); replay.seekMs(at); }} />
        <QualityPanel
          t={labels}
          quality={quality}
          active
          onSelectDimension={(dim) => {
            const code: BaPhase = dim === 'muscle' ? 'REACH' : dim === 'stability' ? 'LIFT_TRANSFER' : 'REST';
            const edge = baObserved(events, code);
            if (edge.startMs !== null) {
              setWindowPhase(code);
              replay.seekMs(edge.startMs);
            }
          }}
        />
        <Evidence t={labels} repository url={replay.url} reviewRef={replay.video} onMetadata={replay.onMetadata}
          status={stored?.videoState ?? 'none'} short={Boolean(stored?.video && replay.time > stored.videoTime + .15)} />
      </div>
      <BaChart key={trial.id} t={labels} poseText={pose} clock={clock} record={record} defaultSide={recordedSide}
        limbBadge={limbBadge} annotations={annotations}
        positionMs={replay.position} availableMs={available} review started
        poseRecord={poseRecords[record.id]} onPoseRecord={(value) => attachPose(record.id, value)}
        analysis={analysis} onClearAnalysis={() => setWindowPhase(undefined)} onSeek={replay.seekMs} />
    </div> : <div className="workspace-grid">
      <Chart t={labels} kind={kind} setKind={setKind} time={replay.time} available={trial.elapsed}
        active interactive focus={focus} onSeek={(at) => { setFocus(null); replay.seekMs(at * 1000); }} />
      <aside className="inspector">
        <Evidence t={labels} url={replay.url} reviewRef={replay.video} onMetadata={replay.onMetadata}
          status={trial.videoState} short={Boolean(trial.video && replay.time > trial.videoTime + .15)} />
        <ReviewPanel t={labels} trial={trial} jump={(at, nextKind, range) => {
          if (nextKind) setKind(nextKind);
          setFocus(range ?? null);
          replay.seekMs(at * 1000);
        }} />
      </aside>
    </div>}

    {stored && <dialog ref={discardDialog} className="glass-dialog" aria-labelledby="discard-trial-title">
      <div className="archive-discard"><h2 id="discard-trial-title">{t.discardTitle}</h2>
        <div className="dialog-actions">
          <button type="button" className="button" autoFocus disabled={working} onClick={() => discardDialog.current?.close()}>{t.cancel}</button>
          <button type="button" className="button stop-button" disabled={working} onClick={() => void remove()}>{t.discard}</button>
        </div>
      </div>
    </dialog>}

    {stored && <ClinicalNotesDrawer
      open={drawerOpen}
      onClose={() => setDrawerOpen(false)}
      positionMs={replay.position}
      annotations={annotations}
      clinicalNote={clinicalNote}
      prescription={prescription}
      reviewed={reviewed}
      canSave={canUpdate}
      saving={working}
      lang={lang}
      copy={copy}
      onSeek={replay.seekMs}
      onSaveAll={saveAnnotationsAndNotes}
    />}
  </div>;
}
