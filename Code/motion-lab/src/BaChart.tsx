import { Activity, Box, MoreHorizontal } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { baSeconds, type BaRecord } from './ba';
import { BaWaveCanvas } from './BaWaveCanvas';
import { baSignal, baSignalMetrics, waveformTrack, type BaChannel, type BaSignal } from './baSignal';
import { PosePanel, type PoseData } from './components/PosePanel';
import { emptyPoseSource, type Side } from './pose/PoseSource';
import { createMockPose } from './pose/mockPose';
import { createRecordedPose, parsePoseRecord, type PoseRecord } from './pose/poseRecord';
import { createActivationReader, noActivation } from './pose/activation';
import type { PoseClock, PoseTick } from './pose/poseClock';
import type { PoseLabels } from './pose/poseText';
import { Spectrum } from './Chart';
import { emgPalette } from './emgPalette';
import { channels, type TrialAnnotation } from './model';
import type { Labels } from './text';
import { annotationTagLabels } from './ui/archive';

type Window = { name: string; startMs: number; endMs: number };

export type DemoWaveDisplay = {
  signal: BaSignal | null;
  window: readonly [number, number];
  deviceKnown: boolean;
  emgOnline: boolean;
  empty: string;
  poseEmpty: string;
  uncalibrated?: string;
  gaps: readonly { from: number; to: number | null }[];
  markers: readonly number[];
};

type ChartProps = {
  t: Labels;
  poseText: PoseLabels;
  clock: PoseClock;
  poseRecord?: PoseRecord;
  live?: boolean;
  liveData?: PoseData;
  defaultSide?: Side;
  limbBadge?: string;
  annotations?: readonly TrialAnnotation[];
  demo?: DemoWaveDisplay;
  onPoseRecord: (record: PoseRecord | null) => void;
  record: BaRecord;
  positionMs: number;
  availableMs: number;
  review: boolean;
  started: boolean;
  analysis?: Window;
  onClearAnalysis: () => void;
  onSeek: (atMs: number) => void;
};

const emptyPower = new Float64Array();
const emptyPose = { source: emptyPoseSource, calibration: null, calibrationWarning: false };

function PlotGridLine({ at, minor }: { at: number; minor?: boolean }) {
  return <svg className="ba-grid-line" style={{ left: at + '%' }} aria-hidden="true">
    <line className={minor ? 'plot-grid-minor' : 'plot-grid-major'} x1=".5" x2=".5" y1="0" y2="100%" />
  </svg>;
}

export function BaChart({ t, poseText: pt, clock, record, positionMs, availableMs, review, started, analysis, poseRecord, live = false, liveData, defaultSide = 'right', limbBadge, annotations = [], demo, onPoseRecord, onClearAnalysis, onSeek }: ChartProps) {
  const signal = demo ? demo.signal : baSignal(record.signalId, record.id);
  const tracks = useMemo(() => channels.map((code) => {
    const wave = signal?.values[code];
    const geometry = signal && wave ? waveformTrack(wave, signal.rate, signal.thresholdMv?.[code]) : null;
    return { geometry, color: emgPalette[code] };
  }), [signal]);
  const [channel, setChannel] = useState<BaChannel>('BB');
  const [requestedView, setView] = useState<'waves' | 'spectrum'>('waves');
  const [dragging, setDragging] = useState(false);
  const [pane, setPane] = useState<'waves' | 'pose'>('waves');
  const [mock, setMock] = useState(!live);
  const [poseMenuOpen, setPoseMenuOpen] = useState(false);
  const poseMenuRef = useRef<HTMLDivElement>(null);
  const [activeMuscle, setActiveMuscle] = useState<BaChannel | null>(null);
  const [importError, setImportError] = useState(false);
  const imuFile = useRef<HTMLInputElement>(null);
  const importRequest = useRef(0);
  const [mockSide, setMockSide] = useState<Side>(defaultSide);
  useEffect(() => { setMockSide(defaultSide); }, [defaultSide]);
  useEffect(() => {
    if (!poseMenuOpen) return;
    const onDown = (event: PointerEvent) => {
      if (poseMenuRef.current && !poseMenuRef.current.contains(event.target as Node)) setPoseMenuOpen(false);
    };
    window.addEventListener('pointerdown', onDown);
    return () => window.removeEventListener('pointerdown', onDown);
  }, [poseMenuOpen]);
  const isZh = t.muscle.includes('肌电');
  const tagMap = annotationTagLabels[isZh ? 'zh' : 'en'];
  const mockPose = useMemo(() => mock ? createMockPose(record, mockSide) : null, [mock, record, mockSide]);
  const realPose = useMemo(() => {
    if (!poseRecord) return null;
    const quiet = record.phases.find((phase) => phase.code === 'REST');
    const rest = quiet && quiet.startMs !== null && quiet.endMs !== null
      ? [quiet.startMs / 1000, quiet.endMs / 1000] as const : undefined;
    return createRecordedPose(poseRecord, rest);
  }, [poseRecord, record]);
  const activation = useMemo(() => createActivationReader(signal), [signal]);
  const activePose = live ? liveData ?? emptyPose : mockPose ?? realPose ?? emptyPose;
  const view = review ? requestedView : 'waves';

  async function importPose(file: File) {
    const request = ++importRequest.current;
    setImportError(false);
    try {
      const data = parsePoseRecord(JSON.parse(await file.text()), record.id);
      if (request !== importRequest.current) return;
      onPoseRecord(data);
      setMock(false);
      setPane('pose');
    } catch {
      if (request === importRequest.current) setImportError(true);
    }
  }
  const startMs = analysis?.startMs ?? 0;
  const endMs = analysis?.endMs ?? availableMs;
  const metrics = useMemo(() => review && !demo ? baSignalMetrics(signal, channel, startMs, endMs) : null,
    [review, demo, signal, channel, startMs, endMs]);

  const domainStart = demo?.window[0] ?? record.originMs;
  const domainEnd = demo?.window[1] ?? (review
    ? Math.max(domainStart + 1, availableMs)
    : Math.max(5000, Math.ceil((positionMs + 300) / 5000) * 5000));
  const span = domainEnd - domainStart;
  const percent = (atMs: number) => (atMs - domainStart) * 100 / span;
  const ticks = Array.from({ length: 5 }, (_, index) =>
    Math.round(domainStart + index * span / 4));
  const signalStart = signal?.originMs ?? domainStart;
  const signalSpan = signal ? signal.count * 1000 / signal.rate : 0;
  const traceWidth = signalSpan / span * 100;
  const revealLimit = review ? availableMs : null;
  const revealAt = useCallback(({ timeMs }: PoseTick) => review || started
    ? Math.max(0, Math.min(100, ((revealLimit ?? timeMs) - domainStart) * 100 / span)) : 0,
    [review, started, revealLimit, domainStart, span]);
  const hasThreshold = tracks.some(({ geometry }) => geometry?.threshold != null);
  const seekFromPointer = (event: React.PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    onSeek(Math.round(domainStart + (event.clientX - rect.left) / rect.width * span));
  };
  const smallValue = (value: number | undefined) =>
    value === undefined ? undefined : (value > 0 && value < 0.001 ? value.toPrecision(3) : value.toFixed(3));
  const entries = [
    { name: 'RMS', value: smallValue(metrics?.rms), unit: 'mV' },
    { name: 'MAV', value: smallValue(metrics?.mav), unit: 'mV' },
    { name: t.medianFreq, value: metrics?.median?.toFixed(1), unit: 'Hz' },
    { name: t.activations, value: metrics?.activations?.toString(), unit: '' },
  ];

  return <section className="glass glass--plot ba-wave-panel" aria-labelledby="ba-waves-title" data-panel="wave">
    <div className="pose-signal-grid" data-pane={pane}>
    <div className="panel-heading ba-wave-heading">
      <div className="panel-title"><Activity size={18} /><h2 id="ba-waves-title">{t.muscle}</h2></div>
      <div className="graph-tools">
        <div className="signal-pane-switch" role="group" aria-label={pt.panelView}>
          <button type="button" aria-pressed={pane === 'waves'} onClick={() => setPane('waves')}>{pt.waveform}</button>
          <button type="button" aria-pressed={pane === 'pose'} onClick={() => setPane('pose')}>{pt.poseView}</button>
        </div>
        {review && !demo && signal && <>
          <label className="channel-select"><span>{t.channel}</span>
            <select value={channel} aria-label={t.channel} onChange={(event) => setChannel(event.target.value as BaChannel)}>
              {channels.filter((code) => signal.values[code]).map((code) => <option key={code} value={code}>{code}</option>)}
            </select></label>
          <div className="plot-toggle">
            <button type="button" aria-pressed={view === 'waves'} onClick={() => setView('waves')}>{t.waveforms}</button>
            <button type="button" aria-pressed={view === 'spectrum'} onClick={() => setView('spectrum')}>{t.spectrum}</button>
          </div>
        </>}
        {signal && <span className="ba-source-rate">{signal.rate} Hz · mV</span>}
      </div>
    </div>
    <div className="pose-column-heading">
      <div className="panel-title"><Box size={18} /><h2>{pt.pose}</h2></div>
      <div className="pose-heading-tools">
        <span className="chip chip--accent">{live && <i className="pose-live-dot" aria-hidden="true" />}{live && !review ? pt.live : mock || demo ? pt.demo : pt.replay}</span>
        {!live && <div className="pose-more-wrap" ref={poseMenuRef}>
          <button
            type="button"
            className="icon-button pose-more-btn"
            aria-label="IMU options"
            aria-expanded={poseMenuOpen}
            onClick={() => setPoseMenuOpen((cur) => !cur)}
          >
            <MoreHorizontal size={16} />
          </button>
          <input hidden type="file" accept=".json,application/json" ref={imuFile} data-testid="imu-file"
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = '';
              if (file) void importPose(file);
            }} />
          {poseMenuOpen && <div className="glass pose-more-menu" role="menu">
            <div className="pose-more-limb">
              <span>{isZh ? '采集肢体' : 'Limb'}:</span>
              <b>{limbBadge ?? (defaultSide === 'left' ? pt.left : pt.right)}</b>
            </div>
            <button type="button" className="export-item" role="menuitemcheckbox" aria-checked={mock}
              onClick={() => { setMock(!mock); setPane('pose'); setPoseMenuOpen(false); }}>
              <span>{pt.mock}</span>
              <b>{mock ? (isZh ? '已开启' : 'On') : (isZh ? '关闭' : 'Off')}</b>
            </button>
            <button type="button" className="export-item" role="menuitem"
              onClick={() => { setPoseMenuOpen(false); imuFile.current?.click(); }}>
              <span>{pt.importImu}</span>
            </button>
            {poseRecord && <button type="button" className="export-item" role="menuitem"
              onClick={() => { importRequest.current++; onPoseRecord(null); setImportError(false); setPoseMenuOpen(false); }}>
              <span>{pt.detach}</span>
            </button>}
            {importError && <small className="pose-more-msg" role="alert">{pt.importError}</small>}
            {!mock && poseRecord && <small className="pose-more-msg">{pt.imported}</small>}
          </div>}
        </div>}
      </div>
    </div>
    <div className="ba-signal-content">

    {view === 'spectrum'
      ? <Spectrum t={t} power={metrics?.power ?? emptyPower} maxHz={(signal?.rate ?? 1000) / 2} empty={t.baUnavailable} />
      : <>
        <div className="plot-grid" style={{ '--channel-count': channels.length } as CSSProperties}>
          {channels.map((code, index) => {
            const { geometry, color } = tracks[index];
            const available = Boolean(geometry);
            const unavailable = available ? '' : ' channel--unavailable';
            const rowStyle = { gridRow: index + 1, '--channel-color': color.raw } as CSSProperties;
            const label = <><b>{code}</b><span title={t[code]}>{t[code]}</span></>;
            return <div className="plot-channel" key={code}>
              <div className={'ba-wave-label channel' + unavailable} style={rowStyle} data-channel={code} data-available={available}
                onPointerEnter={available ? () => setActiveMuscle(code) : undefined}
                onPointerLeave={available ? () => setActiveMuscle(null) : undefined}
                onFocus={available ? () => setActiveMuscle(code) : undefined}
                onBlur={available ? () => setActiveMuscle(null) : undefined}>
                <i className="ba-channel-dot" aria-hidden="true" />
                {review && available
                  ? <button type="button" className="ba-channel-button" title={t[code]} aria-label={code + ' ' + t[code]} aria-pressed={channel === code}
                      onClick={() => setChannel(code)}>{label}</button>
                  : <div className="ba-channel-button" title={t[code]}>{label}</div>}
              </div>
              <div className={'ba-range' + unavailable} data-channel={code} style={rowStyle}>
                {demo && (!demo.deviceKnown || (!demo.emgOnline && (available || index < 4)))
                  ? '—' : geometry ? '±' + geometry.peak.toPrecision(2) + ' mV' : t.baUnavailable}
              </div>
            </div>;
          })}
          <div className="ba-wave-lane">
            <div className={'ba-plot' + (review ? ' interactive' : '')}
              role={review ? 'slider' : undefined} tabIndex={review ? 0 : undefined}
              aria-label={review ? t.seek : undefined}
              aria-valuemin={review ? domainStart : undefined} aria-valuemax={review ? availableMs : undefined}
              aria-valuenow={review ? positionMs : undefined} aria-valuetext={review ? baSeconds(positionMs) + ' s' : undefined}
              onKeyDown={review ? (event) => {
                const step = event.shiftKey ? 1000 : 100;
                const target = { Home: domainStart, End: availableMs, ArrowLeft: positionMs - step, ArrowRight: positionMs + step }[event.key];
                if (target !== undefined) { event.preventDefault(); onSeek(target); }
              } : undefined}
              onPointerDown={review ? (event) => {
                event.currentTarget.setPointerCapture(event.pointerId);
                setDragging(true);
                seekFromPointer(event);
              } : undefined}
              onPointerMove={review && dragging ? seekFromPointer : undefined}
              onLostPointerCapture={() => setDragging(false)}>
              {ticks.map((tick, index) => <PlotGridLine key={index} at={percent(tick)} />)}
              {ticks.slice(1).map((tick, index) => <PlotGridLine key={index} at={percent((ticks[index] + tick) / 2)} minor />)}
              {channels.map((code, index) => {
                const available = tracks[index].geometry !== null;
                return <div className={'ba-trace-row' + (available ? '' : ' channel--unavailable')}
                  key={code} data-channel={code} data-available={available} aria-hidden="true" />;
              })}
              {signal && <BaWaveCanvas tracks={tracks} traceStart={percent(signalStart)} traceWidth={traceWidth} clock={clock} revealAt={revealAt} />}
              {demo?.gaps.map((gap, index) => {
                const from = Math.max(domainStart, gap.from);
                const to = Math.min(domainEnd, gap.to ?? positionMs);
                return to > from && <i key={index} className="demo-gap" aria-hidden="true"
                  style={{ left: percent(from) + '%', width: (percent(to) - percent(from)) + '%' }} />;
              })}
              {demo?.markers.filter((mark) => mark >= domainStart && mark <= domainEnd).map((mark, index) =>
                <i key={index} className="demo-mark" style={{ left: percent(mark) + '%' }} aria-hidden="true" />)}
              {annotations.filter((ann) => ann.atMs >= domainStart && ann.atMs <= domainEnd).map((ann) => {
                const label = `${tagMap[ann.tag]} · ${(ann.atMs / 1000).toFixed(2)} s${ann.note ? ` · ${ann.note}` : ''}`;
                return <button
                  key={ann.id}
                  type="button"
                  className="annotation-pin"
                  data-tag={ann.tag}
                  style={{ left: percent(ann.atMs) + '%' }}
                  title={label}
                  aria-label={label}
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => { event.stopPropagation(); onSeek(ann.atMs); }}
                >
                  <i aria-hidden="true" />
                  <span className="annotation-bubble">{label}</span>
                </button>;
              })}
              {(!signal || (demo && !demo.emgOnline) || (demo && !demo.deviceKnown))
                && <span className="ba-wave-empty">{demo?.empty ?? t.baNoSignal}</span>}
              {(review || started || demo?.deviceKnown) && <div className="cursor ba-playhead" style={{ left: percent(positionMs) + '%' }}
                data-edge={percent(positionMs) < 12 ? 'start' : percent(positionMs) > 88 ? 'end' : undefined}
                data-testid="ba-wave-cursor" aria-hidden="true">
                <span className="ba-playhead-label" data-testid="ba-wave-time">{live && !review ? pt.live : baSeconds(positionMs) + ' s'}</span>
              </div>}
            </div>
          </div>
          <div className="ba-axis-lane" aria-hidden="true">
            <div className="ba-x-scale">
              {ticks.map((tick, index) => <span className="ba-x-tick" key={index} style={{ left: percent(tick) + '%' }}>
                {baSeconds(tick)}{index === ticks.length - 1 && <small className="ba-axis-unit"> s</small>}
              </span>)}
            </div>
          </div>
        </div>
        <div className="chart-key ba-chart-key">
          <span><i className="legend-raw" />{t.baRaw}</span>
          <span><i className="legend-rms" />± {t.baRms}</span>
          {hasThreshold && <span><i className="legend-threshold" />{t.threshold}</span>}
          {demo && demo.gaps.length > 0 && <span><i className="legend-gap" />{t.baSignalGap}</span>}
        </div>
      </>}
    </div>
    <PosePanel t={pt} data={activePose} clock={clock} live={live} muscle={activeMuscle} activation={mock ? noActivation : activation}
      emptyText={demo?.poseEmpty} uncalibratedText={demo?.uncalibrated} />
    </div>
    {review && !demo && <div className="pose-review-metrics">
      <div className="ba-analysis-window">
        <span>{t.baWindow}</span><b>{analysis?.name ?? t.baTaskWindow}</b>
        <span data-testid="ba-window">{endMs > startMs ? baSeconds(startMs) + ' – ' + baSeconds(endMs) + ' s' : t.baUnavailable}</span>
        {analysis && <button type="button" onClick={onClearAnalysis}>{t.baTaskWindow}</button>}
      </div>
      <div className="signal-stats" aria-label={t.signalStats}>
        {entries.map(({ name, value, unit }) => <div className="signal-stat" key={name}>
          <span>{name}</span><div><b>{value ?? '—'}</b><small>{value === undefined ? t.baUnavailable : unit}</small></div>
        </div>)}
      </div>
    </div>}
  </section>;
}




