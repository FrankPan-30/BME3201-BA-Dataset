import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type CSSProperties } from 'react';
import { Activity, ArrowLeft, Folder, House, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { baRecords } from './ba-fixtures';
import { freshOutcome, type LimbRole, type Trial } from './model';
import { poseLabels } from './pose/poseText';
import type { PoseRecord } from './pose/poseRecord';
import { deleteTrial, readTrials, stripTrialVideo, writeTrial } from './store';
import { labels, type Lang } from './text';
import { useSpotlight } from './useSpotlight';
import {
  activeSubjectKey, archiveText, buildRehabShowcaseTrials, exampleFolder, formatLocalDateKey,
  nextSubjectDayTrialNumber, readSubjects, rehabDemoSubjectId, subjectStorageKey, unassignedFolder,
  type ArchiveEntry, type ArchiveSubject,
} from './ui/archive';
import { ArchiveDesk } from './ui/ArchiveDesk';
import { CompareWorkspace } from './ui/CompareWorkspace';
import { demoRecord } from './ui/demoView';
import { flowLabels } from './ui/flowText';
import { calibrationMs, initialLiveFlow, liveControls, liveFlow, type UiTrial } from './ui/liveFlow';
import { LiveWorkspace, type LiveCapturedMedia } from './ui/LiveWorkspace';
import { MotionHome } from './ui/MotionHome';
import { RecordWorkspace } from './ui/RecordWorkspace';

const navigation = [
  { page: 'home', Icon: House }, { page: 'live', Icon: Activity }, { page: 'archive', Icon: Folder },
] as const;
type Page = typeof navigation[number]['page'] | 'review' | 'compare';
const examples: ArchiveEntry[] = baRecords.map((record) => ({ kind: 'example', id: 'dataset:' + record.id, record }));

function readPreference(key: string) {
  try { return localStorage.getItem(key); } catch { return null; }
}

function Languages({ language, change, compact = false }: { language: Lang; change: (value: Lang) => void; compact?: boolean }) {
  if (compact) {
    const next = language === 'zh' ? 'en' : 'zh';
    return <button type="button" className="lang-compact" onClick={() => change(next)}
      aria-label={language === 'zh' ? '切换为英文' : 'Switch to Chinese'}
      title={language === 'zh' ? 'Switch to EN' : '切换为中文'}>
      {language === 'zh' ? '中文' : 'EN'}
    </button>;
  }
  return <div className="languages" role="group" aria-label={language === 'zh' ? '界面语言' : 'Interface language'}>
    <button type="button" aria-pressed={language === 'zh'} onClick={() => change('zh')}>中文</button>
    <button type="button" aria-pressed={language === 'en'} onClick={() => change('en')}>EN</button>
  </div>;
}

function BrandMark() {
  return <svg viewBox="0 0 64 64" fill="none" aria-hidden="true" width="28" height="28">
    <rect x="3" y="3" width="58" height="58" rx="14" fill="currentColor" />
    <path d="M13 33h8l4-8 6 17 6-22 6 13h8" stroke="#FFFFFF" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>;
}

export function App() {
  const [language, setLanguage] = useState<Lang>(() => readPreference('motion-lab-lang') === 'en' ? 'en' : 'zh');
  const [collapsed, setCollapsed] = useState(() => typeof window !== 'undefined' ? window.innerWidth < 1280 : true);
  const [page, setPage] = useState<Page>('home');
  const [showcaseTrials, setShowcaseTrials] = useState<Trial[]>(() => buildRehabShowcaseTrials());
  const [storedRecords, setStoredRecords] = useState<Trial[]>([]);
  const [subjects, setSubjects] = useState(readSubjects);
  const [active, setActive] = useState(() => readPreference(activeSubjectKey) ?? rehabDemoSubjectId);
  const [limbRole, setLimbRole] = useState<LimbRole>('paretic');
  const [folder, setFolder] = useState<string | null>(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [entryId, setEntryId] = useState<string | null>(null);
  const [comparePair, setComparePair] = useState<[string, string] | null>(null);
  const [readError, setReadError] = useState(false);
  const [failedSaves, setFailedSaves] = useState<ReadonlySet<string>>(() => new Set());
  const [retrying, setRetrying] = useState(false);
  const [session] = useState(() => crypto.randomUUID());
  const [poseRecords, setPoseRecords] = useState<Record<string, PoseRecord>>({});
  const [state, send] = useReducer(liveFlow, 1, initialLiveFlow);

  // ECG-style silky vertical curtain state (0 = Home/Archive curtain down; -100% = Workspace revealed)
  const [dragOffsetPx, setDragOffsetPx] = useState<number | null>(null);
  const wheelAccum = useRef({ dist: 0, last: 0 });
  const spotlight = useSpotlight<HTMLDivElement>();

  const t = flowLabels(language);
  const copy = labels[language];
  const archive = archiveText[language];
  const pose = poseLabels(language);
  const locked = liveControls(state).lockNavigation;

  const records = useMemo(() => {
    const byShowcaseId = new Map(showcaseTrials.map((s) => [s.id, s]));
    const normalizedStored = storedRecords.map((r) => {
      const showcase = byShowcaseId.get(r.id);
      if (!showcase) return r;
      const ret = r.quality?.phaseSeconds?.RETURN;
      if ((ret === null || ret === 0) && showcase.quality && r.quality) {
        return { ...r, quality: { ...r.quality, phaseSeconds: showcase.quality.phaseSeconds } };
      }
      return r;
    });
    const ids = new Set(normalizedStored.map((r) => r.id));
    return [...normalizedStored, ...showcaseTrials.filter((s) => !ids.has(s.id))].sort((a, b) => b.started - a.started);
  }, [storedRecords, showcaseTrials]);

  const subject = subjects.find((row) => row.id === active);
  const subjectId = subject?.id;
  const subjectDayTrial = useMemo(() => nextSubjectDayTrialNumber(records, subjectId), [records, subjectId]);

  const entries: ArchiveEntry[] = useMemo(
    () => [...records.map((trial) => ({ kind: 'trial' as const, id: trial.id, trial })), ...examples],
    [records],
  );
  const selected = entries.find((entry) => entry.id === entryId);
  const selectedSubject = useMemo(() => {
    if (!selected || selected.kind !== 'trial') return subject;
    return subjects.find((s) => s.id === selected.trial.subjectId) ?? subject;
  }, [selected, subjects, subject]);

  const justFinished = storedRecords.find((trial) => trial.id === 'ui-' + session + '-' + state.summary?.number);

  useEffect(() => {
    document.documentElement.lang = language === 'zh' ? 'zh-Hans' : 'en';
    try { localStorage.setItem('motion-lab-lang', language); } catch { /* Retain session language. */ }
  }, [language]);

  const load = useCallback(async () => {
    setReadError(false);
    try {
      const trials = await readTrials();
      setStoredRecords((current) => [...trials, ...current.filter((row) => !trials.some((saved) => saved.id === row.id))]
        .sort((a, b) => b.started - a.started));
      send({ type: 'restore-number', next: trials.reduce((max, trial) => Math.max(max, trial.number + 1), 1) });
    } catch { setReadError(true); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!state.opening || state.stage !== 'connecting') return;
    const timer = window.setTimeout(() => send({ type: 'connected', now: performance.now() }), 420);
    return () => window.clearTimeout(timer);
  }, [state.opening, state.stage]);

  const calibrationAt = state.calibrationAt;
  useEffect(() => {
    if (state.stage !== 'calibrating' || calibrationAt === null) return;
    const timer = window.setTimeout(() => send({ type: 'finish-calibration', now: performance.now() }),
      Math.max(0, calibrationAt + calibrationMs - performance.now()) + 4);
    return () => window.clearTimeout(timer);
  }, [calibrationAt, state.stage]);

  const persist = useCallback(async (trial: Trial) => {
    await writeTrial(trial);
    setStoredRecords((current) => [trial, ...current.filter((row) => row.id !== trial.id)].sort((a, b) => b.started - a.started));
    setFailedSaves((current) => {
      if (!current.has(trial.id)) return current;
      const next = new Set(current);
      next.delete(trial.id);
      return next;
    });
  }, []);

  const handleCompleteCapture = useCallback((draft: UiTrial, media: LiveCapturedMedia) => {
    const startedMs = Date.now() - draft.duration;
    const dayNum = nextSubjectDayTrialNumber(records, subjectId, startedMs);
    const trial: Trial = {
      id: 'ui-' + session + '-' + draft.number,
      number: draft.number,
      subjectTrialNumber: dayNum,
      dateKey: formatLocalDateKey(startedMs),
      started: startedMs,
      source: 'ui-preview',
      subjectId,
      limbRole: media.limbRole,
      recordedSide: media.recordedSide,
      annotations: media.annotations,
      demo: draft,
      quality: media.quality,
      elapsed: draft.duration / 1000,
      complete: draft.duration >= demoRecord.endMs,
      outcome: freshOutcome,
      video: media.video,
      videoTime: media.videoTime,
      videoState: media.videoState,
    };
    void persist(trial).catch(() => {
      setStoredRecords((current) => [trial, ...current.filter((row) => row.id !== trial.id)].sort((a, b) => b.started - a.started));
      setFailedSaves((current) => new Set(current).add(trial.id));
    }).finally(() => send({ type: 'saved' }));
  }, [persist, records, session, subjectId]);

  const nav = useCallback((target: Exclude<Page, 'review'>) => {
    if (locked) return;
    setSelectionMode(false);
    setDragOffsetPx(null);
    if (target === 'archive') { setFolder(null); setEntryId(null); }
    setPage(target);
  }, [locked]);

  // ECG-style swipe-up (Home -> Live) & pull-down (Live toolbar -> Home) gesture handler
  useEffect(() => {
    const root = spotlight.current;
    if (!root) return;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    let drag: { id: number; startX: number; startY: number; mode: '' | 'up' | 'down' | 'ignore' } | null = null;

    function onPointerDown(e: PointerEvent) {
      if (locked || e.button !== 0 || !e.isPrimary) return;
      const target = e.target as HTMLElement | null;
      if (!target || target.closest('button, input, select, textarea, dialog, a, [role="slider"]')) return;
      if (page === 'home') {
        drag = { id: e.pointerId, startX: e.clientX, startY: e.clientY, mode: '' };
      } else if (page === 'live' && target.closest('.toolbar')) {
        drag = { id: e.pointerId, startX: e.clientX, startY: e.clientY, mode: '' };
      }
    }

    function onPointerMove(e: PointerEvent) {
      if (!drag || e.pointerId !== drag.id) return;
      const dx = e.clientX - drag.startX;
      const dy = e.clientY - drag.startY;
      if (!drag.mode) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) < 10) return;
        if (page === 'home' && dy < 0 && Math.abs(dy) > Math.abs(dx) * 1.15) {
          drag.mode = 'up';
        } else if (page === 'live' && dy > 0 && Math.abs(dy) > Math.abs(dx) * 1.15) {
          drag.mode = 'down';
        } else {
          drag.mode = 'ignore';
        }
      }
      if (reduced.matches) return;
      if (drag.mode === 'up') {
        setDragOffsetPx(Math.max(-window.innerHeight, Math.min(0, dy)));
      } else if (drag.mode === 'down') {
        setDragOffsetPx(-window.innerHeight + Math.max(0, Math.min(window.innerHeight, dy)));
      }
    }

    function onPointerUp(e: PointerEvent) {
      if (!drag || e.pointerId !== drag.id) return;
      const dy = e.clientY - drag.startY;
      const mode = drag.mode;
      drag = null;
      setDragOffsetPx(null);
      if (mode === 'up' && dy <= -68) nav('live');
      else if (mode === 'down' && dy >= 68) nav('home');
    }

    function onWheel(e: WheelEvent) {
      if (locked) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest('dialog, .archive-record-list, select')) return;
      const now = performance.now();
      if (now - wheelAccum.current.last > 180) wheelAccum.current.dist = 0;
      wheelAccum.current.last = now;
      if (page === 'home' && e.deltaY > 0 && Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        wheelAccum.current.dist += e.deltaY;
        if (wheelAccum.current.dist >= 75) {
          wheelAccum.current.dist = 0;
          nav('live');
        }
      }
    }

    root.addEventListener('pointerdown', onPointerDown, { passive: true });
    window.addEventListener('pointermove', onPointerMove, { passive: true });
    window.addEventListener('pointerup', onPointerUp, { passive: true });
    window.addEventListener('pointercancel', onPointerUp, { passive: true });
    root.addEventListener('wheel', onWheel, { passive: true });
    return () => {
      root.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
      root.removeEventListener('wheel', onWheel);
    };
  }, [locked, nav, page, spotlight]);

  function saveSubject(next: ArchiveSubject, editing: boolean) {
    if (!editing && subjects.some((row) => row.id.toLowerCase() === next.id.toLowerCase())) return archive.duplicate;
    const update = editing ? subjects.map((row) => row.id === next.id ? next : row) : [...subjects, next];
    try { localStorage.setItem(subjectStorageKey, JSON.stringify(update)); }
    catch { return archive.subjectError; }
    setSubjects(update);
  }

  function selectSubject(id: string) {
    setActive(id);
    setLimbRole('paretic');
    try { localStorage.setItem(activeSubjectKey, id); } catch { /* Retain session selection. */ }
    if (selectionMode) {
      setSelectionMode(false);
      setPage('live');
    }
  }

  function openCompare(idA: string, idB: string) {
    setComparePair([idA, idB]);
    setPage('compare');
  }

  async function handleStripVideo(trial: Trial) {
    await persist(stripTrialVideo(trial));
  }

  async function handleClearAllVideos() {
    const withVideo = records.filter((t) => t.video && t.video.size > 0);
    for (const trial of withVideo) {
      await persist(stripTrialVideo(trial));
    }
  }

  function open(entry: ArchiveEntry) {
    const owner = entry.kind === 'trial' ? entry.trial.subjectId : undefined;
    setFolder(entry.kind === 'example' ? exampleFolder : subjects.some((row) => row.id === owner) ? owner! : unassignedFolder);
    setEntryId(entry.id);
    setPage('review');
  }

  async function discard(id: string) {
    if (showcaseTrials.some((s) => s.id === id)) {
      setShowcaseTrials((cur) => cur.filter((s) => s.id !== id));
    } else {
      if (!failedSaves.has(id)) await deleteTrial(id);
      setStoredRecords((current) => current.filter((row) => row.id !== id));
    }
    if (justFinished?.id === id) send({ type: 'discard' });
    setPage('archive');
  }

  function attach(id: string, value: PoseRecord | null) {
    setPoseRecords((current) => {
      const next = { ...current };
      if (value) next[id] = value;
      else delete next[id];
      return next;
    });
  }

  function retrySave(trial: Trial) {
    setRetrying(true);
    void persist(trial).catch(() => undefined).finally(() => setRetrying(false));
  }

  const failed = page === 'live' ? justFinished : selected?.kind === 'trial' ? selected.trial : undefined;
  const saveWarning = failed && failedSaves.has(failed.id) && <div className="storage-error" role="alert">
    {archive.saveError}<button className="button" disabled={retrying} onClick={() => retrySave(failed)}>{copy.retry}</button>
  </div>;

  const recording = state.stage === 'recording' || state.stage === 'reconnecting';
  const routeTitles = { home: archive.home, live: t.online, archive: archive.archive };
  const isStage = page === 'home' || page === 'archive';
  const curtainTranslate = dragOffsetPx !== null ? `${dragOffsetPx}px` : (isStage ? '0%' : '-102%');
  const pulling = dragOffsetPx !== null;

  const stageHeader = <header className="motion-stage-nav">
    {page === 'archive' && <button type="button" className="button motion-stage-back" onClick={() => nav('home')}>
      <ArrowLeft size={15} />{archive.home}
    </button>}
    <Languages language={language} change={setLanguage} />
    {page === 'home' && <button type="button" className="motion-archive-toggle"
      aria-label={archive.archive} title={archive.archive} onClick={() => nav('archive')}>
      <Folder size={19} strokeWidth={1.75} />
    </button>}
  </header>;

  return <div
    ref={spotlight}
    className={'motion-root' + (pulling ? ' is-pulling' : '')}
    data-stage-open={isStage}
    data-playing={page === 'live' && recording}
    data-playback-hold={page === 'live' && state.stage === 'review'}
    style={{ '--curtain-y': curtainTranslate } as CSSProperties}
  >
    <div className="ambient" aria-hidden="true"><i /><i /><i /></div>

    {/* Upper Curtain: 3D Hardware Home & Patient Rehabilitation Archive */}
    <div className="stage-curtain" aria-hidden={!isStage} inert={!isStage ? true : undefined}>
      <div className="ambient" aria-hidden="true"><i /><i /><i /></div>
      <main className="motion-stage" data-stage-page={page}>
        {page === 'archive'
          ? <ArchiveDesk copy={archive} lang={language} subjects={subjects} entries={entries} allTrials={records} active={active} folder={folder}
              setFolder={setFolder} setActive={selectSubject} selectMode={selectionMode} saveSubject={saveSubject} open={open}
              onCompare={openCompare} onStripVideo={handleStripVideo} onClearAllVideos={handleClearAllVideos}
              header={stageHeader} selectedId={entryId} />
          : <MotionHome copy={archive} subject={subject} enter={() => nav('live')} header={stageHeader}
              choose={() => { setFolder(null); setSelectionMode(true); setPage('archive'); }} />}
        {page === 'archive' && readError && <div className="storage-error archive-storage-error" role="alert">
          {copy.readError}<button className="button" onClick={() => void load()}>{copy.retry}</button>
        </div>}
      </main>
    </div>

    {/* Lower Curtain: Live Capture & Trial Review Workspace (razor-aligned left/right bottom, zero scroll jitter) */}
    <div className="work-curtain" aria-hidden={isStage} inert={isStage ? true : undefined}>
      <div className={'app-shell' + (collapsed ? ' nav-collapsed' : '')}>
        <aside className="glass app-nav">
          <div className="nav-header">
            <div className="wordmark" title="BME3201 Motion Lab"><div className="brand-icon"><BrandMark /></div>
              <div className="brand-name"><strong>Motion Lab</strong><span className="brand-course">BME3201</span></div>
            </div>
            <button className="icon-button collapse-nav" type="button" title={collapsed ? copy.expand : copy.collapse}
              aria-label={collapsed ? copy.expand : copy.collapse} aria-expanded={!collapsed} onClick={() => setCollapsed(!collapsed)}>
              {collapsed ? <PanelLeftOpen size={19} /> : <PanelLeftClose size={19} />}
            </button>
          </div>
          <nav className="tabs" aria-label={copy.navigation}>
            {navigation.map(({ page: id, Icon }) => {
              const current = page === id || ((page === 'review' || page === 'compare') && id === 'archive');
              return <button type="button" className="nav-entry" key={id} aria-label={routeTitles[id]} title={routeTitles[id]}
                aria-current={current ? 'page' : undefined} disabled={locked && id !== page} onClick={() => nav(id)}>
                <span className="nav-item" aria-hidden="true"><Icon size={19} /></span>
                <span className="nav-entry-label">{routeTitles[id]}</span>
              </button>;
            })}
          </nav>
          <div className="nav-foot"><Languages language={language} change={setLanguage} compact={collapsed} /></div>
        </aside>
        <div className="app-main">
          <main className="workspace">
            {saveWarning}
            {page === 'compare' && comparePair && (() => {
              const trialA = records.find((r) => r.id === comparePair[0]);
              const trialB = records.find((r) => r.id === comparePair[1]);
              if (!trialA || !trialB) return null;
              const cmpSub = subjects.find((s) => s.id === trialA.subjectId) ?? subjects.find((s) => s.id === trialB.subjectId) ?? subject;
              return <CompareWorkspace
                trialA={trialA}
                trialB={trialB}
                subject={cmpSub}
                lang={language}
                labels={copy}
                copy={archive}
                onBack={() => setPage('archive')}
                onSwap={() => setComparePair((cur) => cur ? [cur[1], cur[0]] : null)}
                onOpenTrial={(trial) => open({ kind: 'trial', id: trial.id, trial })}
              />;
            })()}
            {page === 'review' && selected ? (
              <RecordWorkspace
                key={selected.id}
                entry={selected}
                subject={selectedSubject}
                t={t}
                labels={copy}
                pose={pose}
                copy={archive}
                lang={language}
                poseRecords={poseRecords}
                attachPose={attach}
                back={() => setPage('archive')}
                next={justFinished?.id === selected.id ? () => { send({ type: 'new' }); nav('live'); } : undefined}
                persist={persist}
                discard={discard}
                canUpdate={!failedSaves.has(selected.id)}
              />
            ) : page !== 'compare' ? (
              <LiveWorkspace
                t={t}
                labels={copy}
                pose={pose}
                archiveCopy={archive}
                subject={subject}
                limbRole={limbRole}
                onLimbRoleChange={setLimbRole}
                subjectDayTrial={subjectDayTrial}
                onChooseSubject={() => { setFolder(null); setSelectionMode(true); setPage('archive'); }}
                state={state}
                send={send}
                onCompleteCapture={handleCompleteCapture}
                openTrial={() => justFinished && open({ kind: 'trial', id: justFinished.id, trial: justFinished })}
                archiveNote={justFinished && failedSaves.has(justFinished.id) ? archive.saveError : t.archiveHint}
              />
            ) : null}
          </main>
        </div>
      </div>
    </div>
  </div>;
}
