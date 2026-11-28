import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type Dispatch, type RefObject } from 'react';
import { Cable, Calendar, ChevronDown, Flag, Play, Radio, Save, Square, Timer, UserRound, X } from 'lucide-react';
import { evaluateMovementQuality, type QualityReport } from '../assessment';
import { BaChart } from '../BaChart';
import { BaMovement, QualityPanel, baLabel } from '../BaPanels';
import { Evidence, type VideoStatus } from '../Panels';
import type { LimbRole, Trial, TrialAnnotation } from '../model';
import { createPoseClock } from '../pose/poseClock';
import type { Side } from '../pose/PoseSource';
import type { PoseLabels } from '../pose/poseText';
import type { Labels } from '../text';
import { openCamera, recordCamera, releaseCamera, withDeadline, type Capture, type RecordedVideo } from '../video';
import { formatLocalDateKey, resolveRecordingSide, type ArchiveSubject, type ArchiveText } from './archive';
import { demoBoundaries, demoEvents, demoPose, demoRecord, demoSignal, hasGap } from './demoView';
import type { FlowText } from './flowText';
import { calibrationMs, liveControls, streamAvailable, type DemoError, type Gap, type Health, type LiveAction, type LiveFlow, type Stream, type UiTrial } from './liveFlow';

export type LiveCapturedMedia = {
  video: Blob | null;
  videoTime: number;
  videoState: 'recorded' | 'none' | 'interrupted';
  quality: QualityReport;
  limbRole: LimbRole;
  recordedSide: Side;
  annotations: TrialAnnotation[];
};

export type LiveWorkspaceProps = {
  t: FlowText;
  labels: Labels;
  pose: PoseLabels;
  archiveCopy: ArchiveText;
  subject?: ArchiveSubject;
  limbRole: LimbRole;
  onLimbRoleChange: (role: LimbRole) => void;
  subjectDayTrial: number;
  onChooseSubject: () => void;
  state: LiveFlow;
  send: Dispatch<LiveAction>;
  onCompleteCapture: (draft: UiTrial, media: LiveCapturedMedia) => void;
  openTrial: () => void;
  archiveNote: string;
};

const clockText = (ms: number) => {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return Math.floor(seconds / 60).toString().padStart(2, '0') + ':' + (seconds % 60).toString().padStart(2, '0');
};
const seconds = (ms: number) => (ms / 1000).toFixed(1) + ' s';
const trialText = (n: number) => String(n).padStart(2, '0');
const noGaps: Gap[] = [];
const noMarkers: number[] = [];
const idleHealth: Health = 'offline';
const errors = {
  busy: ['portBusy', 'busyError'], permission: ['permission', 'permissionError'], meta: ['metaMissing', 'metaError'],
  empty: ['emptyTitle', 'emptyError'], crc: ['crcTitle', 'crcError'], ble: ['bleTitle', 'bleError'],
  bandwidth: ['bandwidthTitle', 'bandwidthError'],
} as const satisfies Record<DemoError, readonly [keyof FlowText, keyof FlowText]>;

function useDemoClock(position: number, moving: boolean, assessment: boolean) {
  const clock = useMemo(createPoseClock, []);
  const transfer = assessment && position >= demoBoundaries[2] && position < demoBoundaries[3];
  useLayoutEffect(() => clock.publish({ timeMs: position, running: moving, transfer }), [clock, position, moving, transfer]);
  return clock;
}

export function DemoPlot({
  t, labels, pose, health, known, calibrated, gapHistory, markers, annotations, limbBadge, position, limit, seek, moving, stationary, assessment, trial,
  side = 'right', videoPreview, videoUrl, videoRef, onVideoMetadata, videoStatus = 'none', onOpenCamera, onCloseCamera, videoShort,
}: {
  t: FlowText; labels: Labels; pose: PoseLabels; health: Health; known: boolean; calibrated: boolean;
  gapHistory: readonly Gap[]; markers: readonly number[];
  annotations?: readonly TrialAnnotation[]; limbBadge?: string;
  position: number; limit?: number;
  seek?: (ms: number) => void; moving: boolean; stationary: boolean; assessment: boolean; trial?: Trial;
  side?: Side;
  videoPreview?: MediaStream | null;
  videoUrl?: string;
  videoRef?: RefObject<HTMLVideoElement | null>;
  onVideoMetadata?: () => void;
  videoStatus?: VideoStatus;
  onOpenCamera?: () => void;
  onCloseCamera?: () => void;
  videoShort?: boolean;
}) {
  const replay = limit !== undefined;
  const tickWindow = Math.floor(position / 5000) * 5000;
  const start = replay ? 0 : Math.max(0, tickWindow - 5000);
  const end = replay ? Math.max(1, limit) : tickWindow + 5000;
  const clock = useDemoClock(position, moving, assessment);
  const hasEmg = streamAvailable(health, 'emg');
  const signal = useMemo(() => demoSignal(start, end, gapHistory, calibrated, known && (replay || hasEmg || gapHistory.length > 0)),
    [start, end, gapHistory, calibrated, known, replay, hasEmg]);
  const imu = useMemo(() => demoPose(health, gapHistory, replay, stationary, limit, side),
    [health, gapHistory, replay, stationary, limit, side]);
  const emgOnline = replay ? !hasGap(gapHistory, 'emg', Math.min(position, Math.max(0, end - 1))) : hasEmg;
  const events = useMemo(() => assessment ? demoEvents(limit ?? position, limit) : [], [assessment, limit, position]);
  const movementLabels = assessment || !known ? labels : { ...labels, baAwait: t.awaitStart, baClock: t.previewTime };

  // Quantize live quality evaluation to 250ms steps to keep CPU usage minimal
  const evalBucketMs = replay ? (limit ?? position) : Math.floor(position / 250) * 250;
  const quality = useMemo(() => {
    if (trial?.quality && replay) return trial.quality;
    if (!known) return null;
    const fullSig = demoSignal(0, Math.max(1000, evalBucketMs), gapHistory, calibrated, true);
    return evaluateMovementQuality({
      record: demoRecord,
      events,
      signal: fullSig,
      positionMs: Math.max(600, evalBucketMs),
      complete: replay,
      calibrated,
      gapCount: gapHistory.length,
    });
  }, [trial?.quality, replay, known, evalBucketMs, gapHistory, calibrated, events]);

  return <div className="ba-workspace">
    <div className="ba-header-grid">
      <BaMovement t={movementLabels} record={demoRecord} events={events} positionMs={position} trial={trial}
        onPhase={seek ? (_phase, at) => seek(at) : undefined} />
      <QualityPanel
        t={labels}
        quality={quality}
        active={known}
        live={!replay}
        onSelectDimension={seek ? (dim) => {
          const target = dim === 'muscle' ? demoBoundaries[1] : dim === 'stability' ? demoBoundaries[2] : 0;
          seek(target);
        } : undefined}
      />
      <Evidence
        t={labels}
        preview={videoPreview}
        url={videoUrl}
        reviewRef={videoRef}
        onMetadata={onVideoMetadata}
        status={videoStatus}
        onPreview={onOpenCamera}
        onClose={onCloseCamera}
        short={videoShort}
      />
    </div>
    <BaChart t={labels} poseText={pose} clock={clock} record={demoRecord} positionMs={position} availableMs={end}
      review={replay} started={known} live liveData={imu} defaultSide={side} annotations={annotations} limbBadge={limbBadge}
      onSeek={seek ?? (() => {})} onPoseRecord={() => {}} onClearAnalysis={() => {}}
      demo={{ signal, window: [start, end], deviceKnown: known, emgOnline,
        empty: !known ? t.waiting : replay || health === 'offline' ? t.lost : t.waitingSignal,
        poseEmpty: known ? t.lost : t.waiting, uncalibrated: known && !calibrated ? t.uncalibrated : undefined,
        gaps: gapHistory.filter((gap) => gap.stream === 'emg'), markers }} />
  </div>;
}

function SignalDot({ text, ok, known }: { text: string; ok: boolean; known: boolean }) {
  return <span className="flow-signal" data-tone={ok ? 'ok' : known ? 'warning' : 'idle'}>
    <i aria-hidden="true" />{text}
  </span>;
}

function Confirm({ title, detail, cancel, confirm, dismiss, accept }: {
  title: string; detail?: string; cancel: string; confirm: string; dismiss: () => void; accept: () => void;
}) {
  const modal = useRef<HTMLDialogElement>(null);
  useEffect(() => { modal.current?.showModal(); }, []);
  return <dialog className="glass-dialog flow-confirm" ref={modal} aria-labelledby="flow-confirm-title"
    onCancel={(event) => { event.preventDefault(); dismiss(); }}>
    <h2 id="flow-confirm-title">{title}</h2>
    {detail && <p>{detail}</p>}
    <div className="dialog-actions">
      <button className="button" onClick={dismiss} autoFocus>{cancel}</button>
      <button className="button btn-primary" onClick={accept}>{confirm}</button>
    </div>
  </dialog>;
}

function DevicePanel({ t, pose, state, send, close }: Pick<LiveWorkspaceProps, 't' | 'pose' | 'state' | 'send'> & { close: () => void }) {
  const known = state.connectedAt !== null;
  const phase = state.stage;
  const sample = (value: Health) => send({ type: 'health', value, now: performance.now() });
  const ok = (stream: Stream) => streamAvailable(state.health, stream);
  const canSimulate = ['preview', 'calibrating', 'recording', 'reconnecting'].includes(phase);
  const trouble = state.error ? t[errors[state.error][1]] : null;
  return <aside id="flow-device-panel" className="glass flow-device-panel" aria-label={t.devicePanel}>
    <div className="flow-device-heading"><div><h2>{t.shelf}</h2><span>{t.simulated}</span></div>
      <button className="icon-button" aria-label={t.cancel} onClick={close}><X size={17} /></button></div>
    {(phase === 'idle' || phase === 'connecting' || phase === 'error') && <div className="flow-chooser well">
      <div><Cable size={17} /><b>{t.device}</b><span>{t[state.transport]}</span></div>
      {phase === 'connecting' && <button className="button btn-primary" disabled={state.opening} onClick={() => send({ type: 'choose' })}>
        {state.opening ? t.connecting : t.selectDevice}</button>}
      {trouble && <p role="alert">{trouble}</p>}
    </div>}
    <div className="flow-sensor-grid">
      <div className="well"><SignalDot text={t.emg} ok={ok('emg')} known={known} />
        <span>{ok('emg') ? t.rate + ' · 1000 Hz' : '—'}</span>
        <small>{t.channels} · {known ? 'BB · TB · AD · MD' : '—'}</small></div>
      <div className="well"><SignalDot text={t.imu} ok={ok('imu')} known={known} />
        <span>{ok('imu') ? t.rate + ' · 50 Hz' : '—'}</span>
        <small>{[pose.trunk, pose.upperArm, pose.forearm].map((name) =>
          <SignalDot key={name} text={name} ok={ok('imu')} known={known} />)}</small></div>
    </div>
    {known && state.health !== 'dual' && <p className="flow-device-warning" role="status">
      {t.which} · {state.health === 'emg-only' ? t.imu : state.health === 'imu-only' ? t.emg : t.emg + ' / ' + t.imu}
    </p>}
    {known && <p className="flow-device-note">{state.calibrated ? t.calibrated : t.uncalibrated}</p>}
    {(canSimulate || phase === 'connecting') && <details className="flow-simulation">
      <summary>{t.demoControls}</summary>
      {canSimulate && <div className="flow-demo-actions">
        {(['dual', 'emg-only', 'imu-only', 'offline'] as const).map((health, index) =>
          <button key={health} className="button" aria-pressed={state.health === health} onClick={() => sample(health)}>
            {[t.all, t.mockImuLoss, t.mockEmgLoss, t.linkDown][index]}
          </button>)}
        {phase === 'calibrating' && <button className="button" onClick={() => send({ type: 'motion', now: performance.now() })}>{t.simulateMotion}</button>}
      </div>}
      {phase === 'connecting' && !state.opening && <div className="flow-demo-actions">
        {(Object.keys(errors) as DemoError[]).filter((error) => state.transport === 'ble'
          ? error !== 'busy' && error !== 'empty' : error !== 'ble' && error !== 'bandwidth').map((error) =>
          <button key={error} className="button" onClick={() => send({ type: 'error', value: error })}>
            {t[errors[error][0]]}
          </button>)}
      </div>}
    </details>}
  </aside>;
}

export function exportSummary(trial: UiTrial, quality?: QualityReport) {
  const { number, duration, calibrated, initialHealth, markers, gaps, transport } = trial;
  const url = URL.createObjectURL(new Blob([JSON.stringify({
    schema: 'motion-lab-assessment/v1.5', number, durationMs: duration,
    calibrated, initialHealth, markersMs: markers, gaps, transport, quality,
  }, null, 2)], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'Motion-Lab-Trial-' + String(trial.number).padStart(3, '0') + '.json';
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function DemoSummary({ t, labels, trial, quality, actions, note }: Pick<LiveWorkspaceProps, 't' | 'labels'> & {
  trial: UiTrial; quality?: QualityReport; actions?: React.ReactNode; note: string;
}) {
  return <section className="glass flow-summary" aria-labelledby="demo-summary">
    <div className="flow-summary-head">
      <div><h2 id="demo-summary">{t.summary}</h2><p>{note}</p></div>
      {actions && <div className="flow-summary-actions">{actions}</div>}
    </div>
    <dl className="flow-summary-data">
      <div><dt>{labels.quality}</dt><dd>{quality ? `${quality.total} / 100` : '—'}</dd></div>
      <div><dt>{labels.cci}</dt><dd>{quality ? quality.cci.toFixed(2) : '—'}</dd></div>
      <div><dt>{t.duration}</dt><dd>{seconds(trial.duration)}</dd></div>
      <div><dt>{labels.stabilityScore}</dt><dd>{quality ? `${quality.stabilityScore}` : '—'}</dd></div>
      <div><dt>{t.markers}</dt><dd>{trial.markers.length}</dd></div>
    </dl>
    <ul className="flow-phase-summary">{demoRecord.phases.map((phase) => {
      const from = phase.startMs ?? 0;
      const duration = Math.max(0, Math.min(phase.endMs ?? trial.duration, trial.duration) - from);
      return <li key={phase.code}><span>{baLabel(labels, phase.code)}</span><b>{duration ? seconds(duration) : '—'}</b></li>;
    })}</ul>
    {trial.gaps.length > 0 && <ul className="flow-gap-list">{trial.gaps.map((gap, index) =>
      <li key={index}><span>{t[gap.stream]}</span> {seconds(gap.from)}–{seconds(gap.to ?? trial.duration)}</li>)}</ul>}
  </section>;
}

export function LiveWorkspace({
  t, labels, pose, archiveCopy, subject, limbRole, onLimbRoleChange, subjectDayTrial, onChooseSubject, state, send, onCompleteCapture, openTrial, archiveNote,
}: LiveWorkspaceProps) {
  const [panel, setPanel] = useState(false);
  const [now, setNow] = useState(() => performance.now());

  // Real Camera Preview & Synchronized MediaRecorder
  const [cameraState, setCameraState] = useState<'none' | 'loading' | 'ready' | 'unavailable' | 'interrupted'>('none');
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const captureRef = useRef<Capture | null>(null);
  const camReqRef = useRef(0);
  const videoEndedSecRef = useRef<number | null>(null);

  const closeCamera = useCallback(() => {
    camReqRef.current++;
    releaseCamera(streamRef.current);
    streamRef.current = null;
    setCameraStream(null);
    setCameraState('none');
  }, []);

  const openCameraPreview = useCallback(async () => {
    if (streamRef.current?.getVideoTracks().some((tr) => tr.readyState === 'live')) return streamRef.current;
    setCameraState('loading');
    const token = ++camReqRef.current;
    try {
      let expired = false;
      const opening = openCamera().then((s) => {
        if (expired) releaseCamera(s);
        return s;
      });
      const preview = await withDeadline(opening, 5500, () => { expired = true; });
      if (token !== camReqRef.current) {
        releaseCamera(preview);
        return null;
      }
      streamRef.current = preview;
      setCameraStream(preview);
      setCameraState('ready');
      for (const track of preview.getVideoTracks()) {
        track.addEventListener('ended', () => {
          if (streamRef.current !== preview) return;
          streamRef.current = null;
          setCameraStream(null);
          setCameraState(captureRef.current ? 'interrupted' : 'unavailable');
        }, { once: true });
      }
      return preview;
    } catch {
      if (token === camReqRef.current) setCameraState('unavailable');
      return null;
    }
  }, []);

  useEffect(() => () => {
    void captureRef.current?.stop();
    releaseCamera(streamRef.current);
  }, []);

  const prevStage = useRef(state.stage);
  useEffect(() => {
    if (prevStage.current === 'connecting' && state.stage === 'preview') setPanel(false);
    prevStage.current = state.stage;
  }, [state.stage]);

  // Start MediaRecorder when live flow enters 'recording'
  useEffect(() => {
    if (state.stage === 'recording' && streamRef.current && !captureRef.current) {
      videoEndedSecRef.current = null;
      try {
        const rec = recordCamera(streamRef.current);
        captureRef.current = rec;
        void rec.stopped.then((res) => {
          if (res.interrupted && captureRef.current === rec) {
            setCameraState('interrupted');
          }
        });
      } catch {
        captureRef.current = null;
      }
    }
  }, [state.stage]);

  // Finalize trial + recorded video + 3-dimension quality report when entering 'stopping'
  const draft = state.stage === 'stopping' ? state.draft : null;
  const handledDraftRef = useRef<UiTrial | null>(null);
  useEffect(() => {
    if (!draft || handledDraftRef.current === draft) return;
    handledDraftRef.current = draft;
    void (async () => {
      let recorded: RecordedVideo = { blob: null, interrupted: false };
      if (captureRef.current) {
        try { recorded = await captureRef.current.stop(); } catch { /* ignore */ }
        captureRef.current = null;
      }
      const events = demoEvents(draft.duration, draft.duration);
      const sig = demoSignal(0, Math.max(1000, draft.duration), draft.gaps, draft.calibrated, true);
      const quality = evaluateMovementQuality({
        record: demoRecord,
        events,
        signal: sig,
        positionMs: draft.duration,
        complete: draft.duration >= demoRecord.endMs,
        calibrated: draft.calibrated,
        gapCount: draft.gaps.length,
      });
      const recordedSide = resolveRecordingSide(subject, limbRole);
      const annotations: TrialAnnotation[] = draft.markers.map((atMs, index) => ({
        id: `live-mark-${Date.now()}-${index}`,
        atMs,
        tag: 'custom',
        note: archiveCopy.home === '首页' ? '实时采集标记' : 'Live capture marker',
        createdAt: Date.now(),
      }));
      onCompleteCapture(draft, {
        video: recorded.blob,
        videoTime: recorded.blob ? draft.duration / 1000 : 0,
        videoState: recorded.interrupted ? 'interrupted' : recorded.blob ? 'recorded' : 'none',
        quality,
        limbRole,
        recordedSide,
        annotations,
      });
    })();
  }, [draft, onCompleteCapture, subject, limbRole, archiveCopy.home]);

  const controls = liveControls(state);
  const moving = ['preview', 'calibrating', 'recording', 'reconnecting'].includes(state.stage) && state.connectedAt !== null;
  useEffect(() => {
    if (!moving) return;
    const timer = window.setInterval(() => setNow(performance.now()), 50);
    return () => window.clearInterval(timer);
  }, [moving]);

  useEffect(() => {
    if (state.stage !== 'recording') return;
    const mark = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== 'm' || event.repeat || event.ctrlKey || event.altKey || event.metaKey
        || (event.target instanceof Element && event.target.closest('input, select, textarea, [contenteditable], dialog'))) return;
      send({ type: 'mark', now: performance.now() });
    };
    window.addEventListener('keydown', mark);
    return () => window.removeEventListener('keydown', mark);
  }, [state.stage, send]);

  const position = Math.max(0, Math.floor(now - (state.draft?.start ?? state.connectedAt ?? now)));
  const known = state.connectedAt !== null;
  const health = known ? state.health : idleHealth;
  const statusSuffix = state.stage === 'recording' ? ' · ' + clockText(position) : '';
  const statusTone = state.stage === 'recording' ? 'danger' : state.stage === 'reconnecting' ? 'warning' : known ? 'ok' : 'idle';
  const partial = health === 'emg-only' ? t.emgOnly : health === 'imu-only' ? t.imuOnly : known && health === 'offline' ? t.noSignals : null;
  const remaining = Math.max(0, (state.calibrationAt ?? now) + calibrationMs - now);
  const Icon = state.stage === 'recording' ? Square : state.stage === 'reconnecting' ? Save : state.stage === 'preview' ? Play : state.stage === 'connecting' || state.stage === 'calibrating' ? X : Radio;
  const todayStr = formatLocalDateKey(Date.now());
  const recordedSide = resolveRecordingSide(subject, limbRole);
  const isZh = archiveCopy.home === '首页';
  const limbBadge = `${limbRole === 'healthy' ? archiveCopy.healthyTag : archiveCopy.pareticTag} · ${recordedSide === 'left' ? archiveCopy.leftArm : archiveCopy.rightArm}`;

  const videoStatus: VideoStatus = state.stage === 'recording' && cameraStream
    ? 'recording'
    : cameraState === 'ready'
      ? 'ready'
      : cameraState === 'loading'
        ? 'loading'
        : cameraState === 'interrupted'
          ? 'interrupted'
          : cameraState === 'unavailable'
            ? 'unavailable'
            : 'none';

  const summaryQuality = useMemo(() => {
    if (!state.summary) return undefined;
    const s = state.summary;
    const events = demoEvents(s.duration, s.duration);
    const sig = demoSignal(0, Math.max(1000, s.duration), s.gaps, s.calibrated, true);
    return evaluateMovementQuality({
      record: demoRecord, events, signal: sig, positionMs: s.duration,
      complete: s.duration >= demoRecord.endMs, calibrated: s.calibrated, gapCount: s.gaps.length,
    });
  }, [state.summary]);

  function primary() {
    const time = performance.now();
    setNow(time);
    switch (controls.primary) {
      case 'connect': case 'retry': setPanel(true); send({ type: controls.primary }); break;
      case 'cancel': setPanel(false); send({ type: 'cancel' }); break;
      case 'start': setPanel(false); send({ type: 'start', now: time }); break;
      case 'cancel-calibration': send({ type: 'cancel-calibration', now: time }); break;
      case 'end': case 'end-save': setPanel(false); send({ type: 'end', now: time }); break;
      case 'new': send({ type: 'new' }); break;
    }
  }

  return <div className="flow-page">
    <header className="glass glass--static toolbar flow-toolbar">
      <div className="toolbar-main">
        <h1>{t.online}</h1>
        <button
          type="button"
          className="chip chip--subject"
          disabled={controls.lockNavigation}
          onClick={onChooseSubject}
          title={archiveCopy.chooseFirst}
        >
          <UserRound size={13} />
          <span>{subject ? `${subject.name} · ${subject.id}` : archiveCopy.chooseFirst}</span>
        </button>
        <div className="flow-segment limb-role-toggle" role="group" aria-label={archiveCopy.pareticSide}>
          {(['paretic', 'healthy'] as const).map((role) => (
            <button
              key={role}
              type="button"
              disabled={controls.lockNavigation}
              aria-pressed={limbRole === role}
              onClick={() => onLimbRoleChange(role)}
              title={`${role === 'healthy' ? archiveCopy.healthyTag : archiveCopy.pareticTag} · ${resolveRecordingSide(subject, role) === 'left' ? archiveCopy.leftArm : archiveCopy.rightArm}`}
            >
              {role === 'healthy' ? archiveCopy.limbShortHealthy : archiveCopy.limbShortParetic}
            </button>
          ))}
        </div>
        <span className="chip chip--date">
          <Calendar size={12} />
          {todayStr} · {isZh ? `第 ${trialText(subjectDayTrial)} 次` : `#${trialText(subjectDayTrial)}`}
        </span>
        <span className="chip flow-state" data-tone={statusTone}><i />{t[state.stage]}{statusSuffix}</span>
      </div>
      <div className="toolbar-actions">
        {state.stage === 'preview' && <>
          <button type="button" className="button toolbar-sub-btn" disabled={!controls.canCalibrate}
            onClick={() => send({ type: 'calibrate', now: performance.now() })}><Timer size={14} />{t.beginCal}</button>
          <button type="button" className="button toolbar-sub-btn" onClick={() => send({ type: 'disconnect' })}>{t.disconnect}</button>
        </>}
        {state.stage === 'recording' && <button type="button" className="button toolbar-sub-btn"
          onClick={() => send({ type: 'mark', now: performance.now() })}><Flag size={14} />{t.mark}</button>}
        {state.stage === 'reconnecting' && <>
          <button type="button" className="button toolbar-sub-btn" onClick={() => setPanel(true)}>{t.wait}</button>
          {state.transport === 'ble' && <button type="button" className="button toolbar-sub-btn"
            onClick={() => send({ type: 'health', value: 'dual', now: performance.now() })}>{t.reconnect}</button>}
        </>}
        {state.stage === 'idle' && <div className="flow-segment" role="group" aria-label={t.devicePanel}>
          {(['usb', 'ble'] as const).map((link) => <button type="button" key={link} aria-pressed={state.transport === link}
            onClick={() => send({ type: 'transport', value: link })}>{t[link]}</button>)}
        </div>}
        <button className="button flow-device-toggle" aria-expanded={panel} aria-controls="flow-device-panel" onClick={() => setPanel(!panel)}>
          <span>{known ? t[state.transport] : t.devicePanel}</span>
          <SignalDot text={t.emg} ok={streamAvailable(health, 'emg')} known={known} />
          <SignalDot text={t.imu} ok={streamAvailable(health, 'imu')} known={known} /><ChevronDown size={14} />
        </button>
        <button className={'button flow-primary ' + (state.stage === 'recording' ? 'stop-button' : 'btn-primary')}
          data-testid="live-main-action" disabled={controls.disabled} onClick={primary}>
          <Icon size={15} />{t[controls.primary]}
        </button>
      </div>
    </header>

    {panel && <DevicePanel {...{ t, pose, state, send }} close={() => setPanel(false)} />}

    {(state.stage === 'calibrating' || state.stage === 'error' || state.stage === 'reconnecting' || partial) && <div className="flow-inline-banner">
      {state.stage === 'calibrating' && <div className="glass glass--static flow-calibration" role="status">
        <b>{Math.ceil(remaining / 1000)} s</b>
        <span>{state.calibrationNote === 'motion' ? t.motion : t.stationary}</span>
        <progress aria-label={t.calibrating} max={calibrationMs} value={calibrationMs - remaining} />
      </div>}
      {state.stage === 'reconnecting' && <span className="flow-device-warning" role="status">
        {t.linkDown} · {t.reconnecting} ({clockText(now - (state.droppedAt ?? now))})
      </span>}
      {state.stage === 'error' && <span className="flow-device-warning" role="alert">{state.error && t[errors[state.error][1]]}</span>}
      {partial && state.stage !== 'reconnecting' && <span className="flow-device-warning">{partial}</span>}
    </div>}

    {state.stage === 'review'
      ? state.summary ? <DemoSummary {...{ t, labels, trial: state.summary, quality: summaryQuality }} note={archiveNote}
          actions={<button className="button btn-primary" onClick={openTrial}>{t.viewTrial}</button>} />
        : <div className="glass flow-summary" role="status">{t.discarded}</div>
      : <DemoPlot
          {...{ t, labels, pose, health, known, position, moving }}
          side={recordedSide}
          limbBadge={limbBadge}
          calibrated={state.calibrated}
          assessment={state.draft !== null}
          stationary={state.stage === 'calibrating'}
          gapHistory={state.draft?.gaps ?? noGaps}
          markers={state.draft?.markers ?? noMarkers}
          videoPreview={cameraStream}
          videoStatus={videoStatus}
          onOpenCamera={cameraStream ? undefined : () => { void openCameraPreview(); }}
          onCloseCamera={cameraStream && state.stage !== 'recording' ? closeCamera : undefined}
        />}

    {state.confirm && <Confirm title={state.confirm === 'imu' ? t.confirmImu : t.confirmEmg} detail={t.confirmHint}
      cancel={t.cancel} confirm={t.proceed} dismiss={() => send({ type: 'dismiss-confirm' })}
      accept={() => { const time = performance.now(); setNow(time); send({ type: 'accept', now: time }); }} />}
  </div>;
}
