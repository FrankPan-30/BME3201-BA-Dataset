import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent, type MouseEvent, type ReactNode } from 'react';
import { ArrowLeftRight, ArrowUpRight, Calendar, HardDrive, MessageSquareText, Plus, TrendingUp, Video } from 'lucide-react';
import { evaluateMovementQuality, trialQuality, type QualityReport } from '../assessment';
import { createBaEvents } from '../ba';
import { baSignal } from '../baSignal';
import type { Trial } from '../model';
import { summarizeLocalStorage } from '../store';
import type { Lang } from '../text';
import {
  exampleFolder, formatLocalDateKey, unassignedFolder,
  type ArchiveEntry, type ArchiveSubject, type ArchiveText, type PareticSide, type Sex,
} from './archive';
import { demoRecord } from './demoView';
import { StorageManagerModal } from './StorageManagerModal';

function subjectMetaLine(subject: ArchiveSubject, copy: ArchiveText): string {
  const parts: string[] = [subject.id];
  if (subject.age) parts.push(`${subject.age}${copy.ageUnit}`);
  if (subject.sex) parts.push(subject.sex === 'male' ? copy.male : copy.female);
  if (subject.pareticSide) parts.push(subject.pareticSide === 'left' ? copy.leftParetic : copy.rightParetic);
  return parts.join(' · ');
}

function Folder({ name, meta, add = false, activeBadge }: { name: string; meta?: string; add?: boolean; activeBadge?: string }) {
  return <>
    <span className="subject-material" aria-hidden="true">
      <i className="subject-folder-back" /><i className="subject-folder-seam" /><i className="subject-folder-front" />
    </span>
    {activeBadge && <span className="subject-active-badge"><i aria-hidden="true" />{activeBadge}</span>}
    <span className="subject-label"><strong>{name}</strong>{meta && <small>{meta}</small>}</span>
    {add && <span className="subject-plus"><Plus size={17} aria-hidden="true" /></span>}
  </>;
}

function SubjectEditor({ original, copy, dismiss, save }: {
  original: ArchiveSubject | null; copy: ArchiveText; dismiss: () => void;
  save: (subject: ArchiveSubject) => string | undefined;
}) {
  const modal = useRef<HTMLDialogElement>(null);
  const [error, setError] = useState<string>();
  const [sex, setSex] = useState<Sex>(original?.sex ?? 'male');
  const [pareticSide, setPareticSide] = useState<PareticSide>(original?.pareticSide ?? 'right');

  useEffect(() => { modal.current?.showModal(); }, []);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const id = String(data.get('id') ?? '').trim();
    const name = String(data.get('name') ?? '').trim();
    const ageRaw = String(data.get('age') ?? '').trim();
    const onsetNote = String(data.get('onsetNote') ?? '').trim();
    if (!id || !name) { setError(copy.nameRequired); return; }
    const ageNum = ageRaw ? Number(ageRaw) : undefined;
    const age = ageNum && Number.isFinite(ageNum) && ageNum > 0 && ageNum < 120 ? Math.round(ageNum) : undefined;
    const problem = save({
      id,
      name,
      age,
      sex,
      pareticSide,
      onsetNote: onsetNote || undefined,
    });
    if (problem) setError(problem);
    else dismiss();
  }

  return <dialog ref={modal} className="glass-dialog archive-dialog" aria-labelledby="subject-editor-title"
    onCancel={(event) => { event.preventDefault(); dismiss(); }}>
    <form onSubmit={submit}>
      <h2 id="subject-editor-title">{original ? copy.edit : copy.add}</h2>
      <div className="subject-form-grid">
        <label>{copy.name}
          <input name="name" defaultValue={original?.name} required maxLength={48} autoFocus />
        </label>
        <label>{copy.code}
          <input name="id" defaultValue={original?.id} required maxLength={24} pattern="[A-Za-z0-9_\-]+" readOnly={Boolean(original)} />
        </label>
        <label>{copy.age}
          <input name="age" type="number" min={1} max={119} defaultValue={original?.age ?? ''} placeholder="60" />
        </label>
        <div className="subject-seg-field">
          <span>{copy.sex}</span>
          <div className="flow-segment subject-seg" role="group" aria-label={copy.sex}>
            {(['male', 'female'] as const).map((item) => (
              <button key={item} type="button" aria-pressed={sex === item} onClick={() => setSex(item)}>
                {item === 'male' ? copy.male : copy.female}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="subject-seg-field">
        <span>{copy.pareticSide}</span>
        <div className="flow-segment subject-seg subject-seg--wide" role="group" aria-label={copy.pareticSide}>
          {(['left', 'right'] as const).map((side) => (
            <button key={side} type="button" aria-pressed={pareticSide === side} onClick={() => setPareticSide(side)}>
              {side === 'left' ? copy.leftSide : copy.rightSide}
            </button>
          ))}
        </div>
      </div>

      <label>{copy.onsetNote}
        <input name="onsetNote" defaultValue={original?.onsetNote ?? ''} maxLength={64} placeholder={copy.onsetPlaceholder} />
      </label>

      {error && <p className="archive-form-error" role="alert">{error}</p>}
      <div className="dialog-actions">
        <button type="button" className="button" onClick={dismiss}>{copy.cancel}</button>
        <button className="button btn-primary" type="submit">{copy.save}</button>
      </div>
    </form>
  </dialog>;
}

type DaySummary = {
  dateKey: string;
  shortDate: string;
  count: number;
  score: number;
  muscleScore: number;
  stabilityScore: number;
  cci: number;
  seconds: number;
};

/**
 * Multi-Day Longitudinal Stroke Rehabilitation Trajectory Card
 * Aggregates daily sessions into a clinical trendline + baseline-to-latest deltas.
 */
function RehabTrajectoryCard({
  days, healthyBaselineScore, selectedDate, onSelectDate, copy,
}: {
  days: readonly DaySummary[];
  healthyBaselineScore: number | null;
  selectedDate: string | null;
  onSelectDate: (dateKey: string | null) => void;
  copy: ArchiveText;
}) {
  if (days.length === 0) return null;
  const baseline = days[0];
  const latest = days[days.length - 1];
  const hasMultiple = days.length >= 2;
  const scoreDelta = latest.score - baseline.score;
  const cciDelta = latest.cci - baseline.cci;
  const secDelta = latest.seconds - baseline.seconds;
  const stabDelta = latest.stabilityScore - baseline.stabilityScore;

  // SVG chart coordinates (width 420 x height 86)
  const W = 420;
  const H = 84;
  const padX = 28;
  const padY = 14;
  const xAt = (i: number) => days.length === 1 ? W / 2 : padX + (i / (days.length - 1)) * (W - padX * 2);
  const yScore = (s: number) => padY + (1 - (Math.max(40, Math.min(100, s)) - 40) / 60) * (H - padY * 2 - 8);

  const scorePath = days.map((d, i) => `${i === 0 ? 'M' : 'L'}${xAt(i).toFixed(1)},${yScore(d.score).toFixed(1)}`).join(' ');
  const stabPath = days.map((d, i) => `${i === 0 ? 'M' : 'L'}${xAt(i).toFixed(1)},${yScore(d.stabilityScore).toFixed(1)}`).join(' ');
  const areaPath = days.length >= 2
    ? `${scorePath} L${xAt(days.length - 1).toFixed(1)},${H - 12} L${xAt(0).toFixed(1)},${H - 12} Z`
    : '';

  return <section className="glass rehab-trend-card" aria-label={copy.rehabTrend}>
    <div className="rehab-trend-head">
      <div className="panel-title">
        <TrendingUp size={16} />
        <h2>{copy.rehabTrend}</h2>
      </div>
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        {healthyBaselineScore !== null && (
          <span className="chip" style={{ background: 'rgba(16,185,129,0.12)', color: '#047857' }}>
            {copy.healthyBaselineRef} · {healthyBaselineScore}
          </span>
        )}
        {hasMultiple && <span className="chip">{baseline.shortDate} → {latest.shortDate} · {days.length} {copy.daySession}</span>}
      </div>
    </div>

    <div className="rehab-trend-grid">
      <div className="rehab-kpis">
        <div className="rehab-kpi">
          <span>{copy.scoreLabel}</span>
          <div>
            <strong>{latest.score}</strong>
            <small>/100</small>
            {hasMultiple && <em data-good={scoreDelta >= 0}>{scoreDelta >= 0 ? `+${scoreDelta} ↑` : `${scoreDelta}`}</em>}
          </div>
        </div>
        <div className="rehab-kpi">
          <span>{copy.cciLabel}</span>
          <div>
            <strong>{latest.cci.toFixed(2)}</strong>
            {hasMultiple && <em data-good={cciDelta <= 0}>{cciDelta <= 0 ? `${cciDelta.toFixed(2)} ↓` : `+${cciDelta.toFixed(2)}`}</em>}
          </div>
        </div>
        <div className="rehab-kpi">
          <span>{copy.durationLabel}</span>
          <div>
            <strong>{latest.seconds.toFixed(1)}<small> s</small></strong>
            {hasMultiple && <em data-good={secDelta <= 0}>{secDelta <= 0 ? `${secDelta.toFixed(1)}s ↓` : `+${secDelta.toFixed(1)}s`}</em>}
          </div>
        </div>
        <div className="rehab-kpi">
          <span>{copy.stabilityLabel}</span>
          <div>
            <strong>{latest.stabilityScore}</strong>
            {hasMultiple && <em data-good={stabDelta >= 0}>{stabDelta >= 0 ? `+${stabDelta} ↑` : `${stabDelta}`}</em>}
          </div>
        </div>
      </div>

      <div className="rehab-chart-box">
        <svg viewBox={`0 0 ${W} ${H}`} className="rehab-svg" role="img" aria-label={copy.rehabTrend}>
          <defs>
            <linearGradient id="rehabAreaGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#272A34" stopOpacity="0.14" />
              <stop offset="100%" stopColor="#272A34" stopOpacity="0.0" />
            </linearGradient>
          </defs>
          <line x1={padX} x2={W - padX} y1={yScore(60)} y2={yScore(60)} stroke="rgba(15,23,42,0.07)" />
          {healthyBaselineScore !== null && (
            <line
              x1={padX} x2={W - padX}
              y1={yScore(healthyBaselineScore)} y2={yScore(healthyBaselineScore)}
              stroke="#10B981" strokeWidth="1.4" strokeDasharray="4 3" opacity="0.78"
            />
          )}
          {areaPath && <path d={areaPath} fill="url(#rehabAreaGrad)" />}
          {hasMultiple && <path d={stabPath} fill="none" stroke="#009E73" strokeWidth="1.4" strokeDasharray="3 3" opacity="0.65" />}
          {hasMultiple && <path d={scorePath} fill="none" stroke="#16181F" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />}
          {days.map((d, i) => {
            const cx = xAt(i);
            const cy = yScore(d.score);
            const isSel = selectedDate === d.dateKey;
            return <g key={d.dateKey} className="rehab-node" onClick={() => onSelectDate(isSel ? null : d.dateKey)}>
              <circle cx={cx} cy={cy} r={isSel ? 6 : 4.2} fill={isSel ? '#10B981' : '#16181F'} stroke="#FFFFFF" strokeWidth="2" />
              <text x={cx} y={cy - 8} textAnchor="middle" className="rehab-node-val">{d.score}</text>
              <text x={cx} y={H - 2} textAnchor="middle" className="rehab-node-date">{d.shortDate}</text>
            </g>;
          })}
        </svg>
      </div>
    </div>
  </section>;
}

const formatTimeOnly = new Intl.DateTimeFormat('sv-SE', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

type PillState = { y: number; h: number; visible: boolean };

export function ArchiveDesk({ copy, lang, subjects, entries, allTrials, folder, active, setFolder, setActive, saveSubject, open, onCompare, onStripVideo, onClearAllVideos, header, selectMode, selectedId }: {
  copy: ArchiveText; lang: Lang; subjects: ArchiveSubject[]; entries: ArchiveEntry[]; allTrials: readonly Trial[];
  folder: string | null; active: string | null;
  setFolder: (id: string | null) => void; setActive: (id: string) => void;
  saveSubject: (subject: ArchiveSubject, editing: boolean) => string | undefined;
  open: (entry: ArchiveEntry) => void;
  onCompare: (idA: string, idB: string) => void;
  onStripVideo: (trial: Trial) => Promise<void>;
  onClearAllVideos: () => Promise<void>;
  header: ReactNode; selectMode: boolean; selectedId: string | null;
}) {
  const [editor, setEditor] = useState<{ original: ArchiveSubject | null } | null>(null);
  const [dateFilter, setDateFilter] = useState<string | null>(null);
  const [compareMode, setCompareMode] = useState(false);
  const [comparePick, setComparePick] = useState<string[]>([]);
  const [storageOpen, setStorageOpen] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const desk = useRef<HTMLElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const fly = useRef<{ id: string; bounds: DOMRect; opening: boolean } | null>(null);
  const [fanning, setFanning] = useState(false);
  const [pill, setPill] = useState<PillState>({ y: 0, h: 58, visible: false });
  const userSubject = subjects.find((subject) => subject.id === folder);
  const storageSummary = useMemo(() => summarizeLocalStorage(allTrials), [allTrials]);

  const folders: ArchiveSubject[] = [
    ...subjects,
    ...(entries.some((entry) => entry.kind === 'trial' && (!entry.trial.subjectId || !subjects.some((subject) => subject.id === entry.trial.subjectId)))
      ? [{ id: unassignedFolder, name: copy.unassigned }] : []),
    { id: exampleFolder, name: copy.examples },
  ];
  const chosen = folders.find((item) => item.id === folder);

  const inFolder = useMemo(() => entries.filter((entry) => entry.kind === 'example'
    ? folder === exampleFolder
    : folder === (subjects.some((subject) => subject.id === entry.trial.subjectId) ? entry.trial.subjectId : unassignedFolder)),
  [entries, folder, subjects]);

  // Compute clinical quality & dateKey for every entry in the opened folder
  const enriched = useMemo(() => inFolder.map((entry) => {
    if (entry.kind === 'example') {
      const evs = createBaEvents(entry.record);
      const sig = baSignal(entry.record.signalId, entry.record.id);
      const quality = evaluateMovementQuality({
        record: entry.record, events: evs, signal: sig, positionMs: entry.record.endMs, complete: true,
      });
      return { entry, dateKey: null as string | null, quality };
    }
    const dk = entry.trial.dateKey ?? formatLocalDateKey(entry.trial.started);
    const quality: QualityReport = trialQuality(entry.trial, entry.trial.ba?.record ?? demoRecord);
    return { entry, dateKey: dk, quality };
  }), [inFolder]);

  // Aggregate daily rehabilitation trajectory (chronological, paretic trials only) + healthy baseline ref
  const daySummaries = useMemo<DaySummary[]>(() => {
    const byDate = new Map<string, { scores: number[]; muscles: number[]; stabs: number[]; ccis: number[]; secs: number[] }>();
    for (const item of enriched) {
      if (!item.dateKey) continue;
      if (item.entry.kind === 'trial' && item.entry.trial.limbRole === 'healthy') continue;
      const bucket = byDate.get(item.dateKey) ?? { scores: [], muscles: [], stabs: [], ccis: [], secs: [] };
      bucket.scores.push(item.quality.total);
      bucket.muscles.push(item.quality.muscleScore);
      bucket.stabs.push(item.quality.stabilityScore);
      bucket.ccis.push(item.quality.cci);
      bucket.secs.push(item.quality.totalSeconds);
      byDate.set(item.dateKey, bucket);
    }
    const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;
    return [...byDate.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([dateKey, b]) => ({
        dateKey,
        shortDate: dateKey.slice(5),
        count: b.scores.length,
        score: Math.round(avg(b.scores)),
        muscleScore: Math.round(avg(b.muscles)),
        stabilityScore: Math.round(avg(b.stabs)),
        cci: Number(avg(b.ccis).toFixed(2)),
        seconds: Number(avg(b.secs).toFixed(2)),
      }));
  }, [enriched]);

  const folderTrials = useMemo(
    () => enriched.filter((item): item is { entry: Extract<ArchiveEntry, { kind: 'trial' }>; dateKey: string; quality: QualityReport } => item.entry.kind === 'trial'),
    [enriched],
  );
  const pareticTrialsChrono = useMemo(
    () => [...folderTrials.filter((item) => item.entry.trial.limbRole !== 'healthy')].sort((a, b) => a.entry.trial.started - b.entry.trial.started),
    [folderTrials],
  );
  const healthyTrialsChrono = useMemo(
    () => [...folderTrials.filter((item) => item.entry.trial.limbRole === 'healthy')].sort((a, b) => b.entry.trial.started - a.entry.trial.started),
    [folderTrials],
  );
  const healthyBaselineScore = healthyTrialsChrono.length > 0 ? healthyTrialsChrono[0].quality.total : null;
  const canFirstLast = pareticTrialsChrono.length >= 2;
  const canBilateral = pareticTrialsChrono.length >= 1 && healthyTrialsChrono.length >= 1;

  const visibleRows = useMemo(() => (
    dateFilter ? enriched.filter((item) => item.dateKey === dateFilter) : enriched
  ), [enriched, dateFilter]);

  const folderMeta = (item: ArchiveSubject) => {
    if (item.id === exampleFolder) return copy.examplesId;
    if (item.id === unassignedFolder) return undefined;
    return subjectMetaLine(item, copy);
  };

  function moveFolder(id: string, bounds: DOMRect | undefined, opening: boolean) {
    if (bounds) fly.current = { id, bounds, opening };
    setPill((current) => ({ ...current, visible: false }));
    setDateFilter(null);
    setCompareMode(false);
    setComparePick([]);
    setFanning(opening);
    setFolder(opening ? id : null);
  }

  function toggleComparePick(trialId: string) {
    setComparePick((prev) => {
      if (prev.includes(trialId)) return prev.filter((id) => id !== trialId);
      if (prev.length >= 2) return [prev[1], trialId];
      return [...prev, trialId];
    });
  }

  function returnToSubjects() {
    if (folder) moveFolder(folder, desk.current?.querySelector('.subject-card--open')?.getBoundingClientRect(), false);
  }

  useLayoutEffect(() => {
    const motion = fly.current;
    if (!motion) return;
    fly.current = null;
    const card = [...(desk.current?.querySelectorAll<HTMLElement>('[data-folder-id]') ?? [])]
      .find((element) => element.dataset.folderId === motion.id);
    if (!card) return;
    const target = card.getBoundingClientRect();
    if (target.width && !matchMedia('(prefers-reduced-motion: reduce)').matches) card.animate([
      { transform: 'translate3d(' + (motion.bounds.left - target.left) + 'px,' + (motion.bounds.top - target.top) + 'px,0) scale(' + motion.bounds.width / target.width + ')' },
      { transform: 'translate3d(0,0,0) scale(1)' },
    ], { duration: 420, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' });
    if (motion.opening) heading.current?.focus();
    else card.focus();
  }, [folder]);

  useEffect(() => {
    if (!fanning) return;
    const timeout = window.setTimeout(() => setFanning(false), 620);
    return () => clearTimeout(timeout);
  }, [fanning, folder]);

  const movePillTo = useCallback((element: HTMLElement | null) => {
    const list = listRef.current;
    if (!list || !element) return;
    setPill({ y: element.offsetTop, h: element.offsetHeight, visible: true });
  }, []);

  function choose(event: MouseEvent<HTMLButtonElement>, subject: ArchiveSubject) {
    if (selectMode && subject.id !== exampleFolder && subject.id !== unassignedFolder) setActive(subject.id);
    else moveFolder(subject.id, event.currentTarget.getBoundingClientRect(), true);
  }

  return <section ref={desk} className="archive-desk" data-subject-open={Boolean(chosen)}
    onKeyDown={(event) => { if (event.key === 'Escape' && chosen && !editor) returnToSubjects(); }}>
    {header}
    {chosen ? <div className="archive-spread">
      <div className="archive-recordings">
        <header className="archive-records-head">
          <div className="archive-person">
            <h1 tabIndex={-1} ref={heading} title={chosen.name}>{chosen.name}</h1>
            <p>
              {[
                folderMeta(chosen),
                userSubject?.onsetNote,
                inFolder.length + (lang === 'en' ? ' ' : '') + (inFolder.length === 1 ? copy.recording : copy.recordings),
              ].filter(Boolean).join(' · ')}
            </p>
          </div>
          <div className="archive-actions">
            {folderTrials.length >= 2 && (
              <button
                type="button"
                className="button"
                aria-pressed={compareMode}
                onClick={() => {
                  setCompareMode((cur) => !cur);
                  setComparePick([]);
                }}
              >
                <ArrowLeftRight size={14} /><span>{compareMode ? copy.exitCompare : copy.compareMode}</span>
              </button>
            )}
            <button type="button" className="button" onClick={() => setStorageOpen(true)}>
              <HardDrive size={14} /><span>{copy.storageManage} ({storageSummary.videoTrials})</span>
            </button>
            {userSubject && <>
              <button type="button" className="button" aria-pressed={active === chosen.id}
                onClick={() => setActive(chosen.id)}>{active === chosen.id ? copy.active : copy.useSubject}</button>
              <button type="button" className="button" onClick={() => setEditor({ original: userSubject })}>{copy.edit}</button>
            </>}
          </div>
        </header>

        {daySummaries.length > 0 && <RehabTrajectoryCard
          days={daySummaries}
          healthyBaselineScore={healthyBaselineScore}
          selectedDate={dateFilter}
          onSelectDate={(dk) => { setPill((p) => ({ ...p, visible: false })); setDateFilter(dk); }}
          copy={copy}
        />}

        {compareMode && <div className="glass compare-quick-bar">
          <div className="compare-quick-left">
            <span>{copy.comparePrompt}</span>
            {canFirstLast && <button
              type="button"
              className="button"
              onClick={() => onCompare(pareticTrialsChrono[0].entry.id, pareticTrialsChrono[pareticTrialsChrono.length - 1].entry.id)}
            >
              {copy.quickFirstLast}
            </button>}
            {canBilateral && <button
              type="button"
              className="button"
              onClick={() => onCompare(healthyTrialsChrono[0].entry.id, pareticTrialsChrono[pareticTrialsChrono.length - 1].entry.id)}
            >
              {copy.quickBilateral}
            </button>}
          </div>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <span className="compare-slot-pill">
              A: {comparePick[0] ? '✓' : '—'} · B: {comparePick[1] ? '✓' : '—'}
            </span>
            <button
              type="button"
              className="button btn-primary"
              style={{ minHeight: 30, paddingInline: 14, fontSize: 12 }}
              disabled={comparePick.length !== 2}
              onClick={() => comparePick.length === 2 && onCompare(comparePick[0], comparePick[1])}
            >
              {copy.compareSelected}
            </button>
          </div>
        </div>}

        {daySummaries.length > 1 && <div className="archive-date-pills" role="group" aria-label={copy.allDays}>
          <button type="button" className="button archive-date-pill" aria-pressed={dateFilter === null}
            onClick={() => { setPill((p) => ({ ...p, visible: false })); setDateFilter(null); }}>
            <Calendar size={12} />{copy.allDays} ({inFolder.length})
          </button>
          {[...daySummaries].reverse().map((d) => (
            <button key={d.dateKey} type="button" className="button archive-date-pill"
              aria-pressed={dateFilter === d.dateKey}
              onClick={() => { setPill((p) => ({ ...p, visible: false })); setDateFilter(dateFilter === d.dateKey ? null : d.dateKey); }}>
              {d.dateKey} · {d.score}{lang === 'zh' ? '分' : 'pt'} ({d.count})
            </button>
          ))}
        </div>}

        <div className="archive-record-viewport">
          <ul ref={listRef} className={'archive-record-list' + (fanning ? ' is-fanning' : '')}
            onPointerLeave={() => setPill((current) => ({ ...current, visible: false }))}>
            <li className="archive-hover-pill" aria-hidden="true" data-visible={pill.visible}
              style={{ transform: `translate3d(0, ${pill.y}px, 0)`, height: pill.h + 'px' }} />
            {visibleRows.length === 0 && <li className="archive-no-trials">{copy.empty}</li>}
            {visibleRows.map(({ entry, dateKey, quality }, index) => {
              const trial = entry.kind === 'trial' ? entry.trial : null;
              const numBadge = trial
                ? (lang === 'zh' ? `第 ${String(trial.subjectTrialNumber ?? trial.number).padStart(2, '0')} 次` : `#${String(trial.subjectTrialNumber ?? trial.number).padStart(2, '0')}`)
                : null;
              const title = entry.kind === 'example'
                ? entry.record.id
                : `${dateKey} ${formatTimeOnly.format(entry.trial.started)}`;
              const seconds = entry.kind === 'example' ? (entry.record.endMs - entry.record.originMs) / 1000 : entry.trial.elapsed;
              const statusText = trial ? (trial.reviewed ? copy.reviewed : copy.pending) : copy.repo;
              const statusTone = trial ? (trial.reviewed ? 'ok' : 'pending') : 'neutral';
              const scoreTone = quality.grade === 'excellent' ? 'ok' : quality.grade === 'mild' ? 'warn' : 'danger';
              const slotIdx = trial ? comparePick.indexOf(trial.id) : -1;
              const slotLabel = slotIdx === 0 ? 'A' : slotIdx === 1 ? 'B' : '';
              const annCount = trial?.annotations?.length ?? 0;
              const hasNote = Boolean(trial?.clinicalNote?.trim());
              const step = Math.min(index, 8);
              const style = { '--record-delay': (36 + step * 32) + 'ms' } as CSSProperties;

              return <li key={entry.id} style={style}>
                <button type="button" className="archive-record-row"
                  data-selected={selectedId === entry.id || slotIdx >= 0 || undefined} title={title}
                  onPointerEnter={(event) => movePillTo(event.currentTarget.parentElement)}
                  onFocus={(event) => movePillTo(event.currentTarget.parentElement)}
                  onClick={() => {
                    if (compareMode && trial) toggleComparePick(trial.id);
                    else open(entry);
                  }}>
                  <span className="record-main">
                    <span className="record-title-group">
                      {compareMode && trial && <span className="record-compare-badge" data-slot={slotLabel || undefined}>{slotLabel || '+'}</span>}
                      <strong>{title}</strong>
                      {numBadge && <span className="record-badge">{numBadge}</span>}
                      {trial && <span className="record-limb-tag" data-role={trial.limbRole ?? 'paretic'}>
                        {trial.limbRole === 'healthy' ? copy.limbShortHealthy : copy.limbShortParetic}
                      </span>}
                      {(annCount > 0 || hasNote) && <span className="record-note-tag">
                        <MessageSquareText size={11} />
                        {annCount > 0 ? `${annCount} ${copy.annotationBadge}` : copy.hasNoteBadge}
                      </span>}
                      {trial?.video && <span className="record-video-tag" title="Video"><Video size={12} /></span>}
                    </span>
                    <span className="record-meta">
                      <span className="record-score-pill" data-tone={scoreTone}>
                        {lang === 'zh' ? '评分' : 'Score'} <b>{quality.total}</b>
                      </span>
                      <span className="record-dim-mini">CCI {quality.cci.toFixed(2)}</span>
                      <span className="record-duration">{seconds.toFixed(2)} s</span>
                      <span className="record-status" data-tone={statusTone}><i aria-hidden="true" />{statusText}</span>
                    </span>
                  </span>
                  <span className="record-open-cue" aria-hidden="true"><ArrowUpRight size={15} /></span>
                </button>
              </li>;
            })}
          </ul>
        </div>
      </div>
      <aside className="archive-folder-wing">
        <button className="button" type="button" onClick={returnToSubjects}>{copy.all}</button>
        <div className="subject-card subject-card--open" data-folder-id={chosen.id} data-active={active === chosen.id}>
          <Folder name={chosen.name} meta={folderMeta(chosen)} activeBadge={active === chosen.id ? copy.activeBadge : undefined} />
        </div>
      </aside>
    </div> : <div className="archive-subjects">
      <header>
        <h1>{selectMode ? copy.chooseFirst : copy.subjects}</h1>
        {!selectMode && <p>{copy.subjectPrompt}</p>}
        <div style={{ marginTop: 10, display: 'inline-flex', gap: 8 }}>
          <button type="button" className="button" style={{ minHeight: 30, paddingInline: 12, fontSize: 12 }} onClick={() => setStorageOpen(true)}>
            <HardDrive size={13} /><span>{copy.storageManage} ({storageSummary.totalTrials} / {storageSummary.videoTrials} {lang === 'zh' ? '录像' : 'videos'})</span>
          </button>
        </div>
      </header>
      <div className="archive-subject-list">
        {folders.map((subject) => <button key={subject.id} className="subject-card" type="button"
          data-folder-id={subject.id} data-active={active === subject.id} title={subject.name}
          aria-description={active === subject.id ? copy.active : undefined} onClick={(event) => choose(event, subject)}>
          <Folder name={subject.name} meta={folderMeta(subject)} activeBadge={active === subject.id ? copy.activeBadge : undefined} />
        </button>)}
        <button className="subject-card subject-add" type="button" onClick={() => setEditor({ original: null })}>
          <Folder name={copy.add} add />
        </button>
      </div>
    </div>}
    <svg className="archive-folder-outlines" width="0" height="0" aria-hidden="true"><defs>
      <clipPath id="subject-back-outline" clipPathUnits="objectBoundingBox">
        <path d="M0,.28 Q0,.15 .09,.15 H.53 C.60,.15 .62,0 .70,0 H.91 Q1,0 1,.13 V.88 Q1,1 .91,1 H.09 Q0,1 0,.88Z" />
      </clipPath>
      <clipPath id="subject-front-outline" clipPathUnits="objectBoundingBox">
        <path d="M0,.51 Q0,.38 .09,.38 H.34 C.42,.38 .44,.51 .52,.51 H.91 Q1,.51 1,.64 V.88 Q1,1 .91,1 H.09 Q0,1 0,.88Z" />
      </clipPath>
    </defs></svg>
    {editor && <SubjectEditor original={editor.original} copy={copy} dismiss={() => setEditor(null)} save={(subject) => {
      const problem = saveSubject(subject, Boolean(editor.original));
      if (!problem && selectMode) setActive(subject.id);
      return problem;
    }} />}
    <StorageManagerModal
      open={storageOpen}
      onClose={() => setStorageOpen(false)}
      trials={allTrials}
      subjects={subjects}
      lang={lang}
      copy={copy}
      onStripVideo={onStripVideo}
      onClearAllVideos={onClearAllVideos}
    />
  </section>;
}
