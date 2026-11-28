import { memo, useId, useState, type CSSProperties } from 'react';
import { Activity, ChevronDown, CircleDot, Flag } from 'lucide-react';
import { activation, bounds, channels, detour, duration, kinematics, motionPaths, phases, sampleSource, type Kinematic } from './model';
import { channelColors, channelStatus, emgTracks, monitorAt, spectrumPath, thresholdY } from './emgView';
import type { Labels } from './text';

const ticks = [0, 2.5, 5, 7.5, 10, 12.5, 15];
const percent = (time: number) => (time / duration * 100) + '%';

const Traces = memo(function Traces({ kind }: { kind: Kinematic }) {
  return <>
    {emgTracks.map(({ path, envelope, bands }, index) => <div className="trace-row" key={channels[index]}>
      {bands.map((band) => <i className="emg-band" key={band.from} style={{ left: percent(band.from), width: percent(band.to - band.from) }} />)}
      <svg className="trace" viewBox="0 0 1000 40" preserveAspectRatio="none" aria-hidden="true">
        <path className="raw-signal" d={path} />
        <line className="emg-threshold" x1="0" x2="1000" y1={thresholdY} y2={thresholdY} />
        <path className="rms-signal" d={envelope} />
      </svg>
    </div>)}
    <div className="trace-row motion-trace">
      <svg className="trace" viewBox="0 0 1000 40" preserveAspectRatio="none" aria-hidden="true"><path d={motionPaths[kind]} /></svg>
    </div>
  </>;
});

export function Spectrum({ t, power, maxHz = 224, empty }: { t: Labels; power: Float64Array; maxHz?: number; empty?: string }) {
  const frequencies = Array.from({ length: 5 }, (_, index) => maxHz * index / 4);
  const id = useId();
  const line = spectrumPath(power);
  return <div className="spectrum">
    <div className="spectrum-axis"><span>0</span><span>−20</span><span>−40</span><span>−60 <small>dB</small></span></div>
    <div className="spectrum-plot">
      <svg viewBox="0 0 640 184" preserveAspectRatio="none" role="img" aria-label={t.powerSpectrum}>
        <defs><linearGradient id={id} x1="0%" x2="0%" y1="100%" y2="0%">
          <stop offset="0%" stopColor="#EEF0F7" /><stop offset="44%" stopColor="#B7BEF0" />
          <stop offset="83%" stopColor="#4F5BD5" /><stop offset="100%" stopColor="#F2A03D" />
        </linearGradient></defs>
        {[0, 61.33, 122.67, 184].map((y) => <line key={y} className="spectrum-gridline" x1="0" x2="640" y1={y} y2={y} />)}
        {[0, 160, 320, 480, 640].map((x) => <line key={x} className="spectrum-gridline" x1={x} x2={x} y1="0" y2="184" />)}
        {line && <>
          <path d={line + ' L640,184 L0,184 Z'} fill={'url(#' + id + ')'} opacity=".82" />
          <path className="spectrum-line" d={line} />
        </>}
      </svg>
      {!line && <span className="spectrum-empty">{empty ?? t.noSamples}</span>}
      <div className="spectrum-ticks">
        {frequencies.map((frequency, index) => <span key={frequency} style={{ left: (index / (frequencies.length - 1) * 100) + '%' }}>{frequency}</span>)}
        <small>Hz</small>
      </div>
    </div>
  </div>;
}

type ChartProps = {
  t: Labels;
  kind: Kinematic;
  setKind: (kind: Kinematic) => void;
  time: number;
  available: number;
  active: boolean;
  interactive: boolean;
  focus: 'detour' | 'activation' | null;
  onSeek: (time: number) => void;
};

export function Chart({ t, kind, setKind, time, available, active, interactive, focus, onSeek }: ChartProps) {
  const [dragging, setDragging] = useState(false);
  const [channel, setChannel] = useState(0);
  const [view, setView] = useState<'waves' | 'spectrum'>('waves');
  const overview = monitorAt(channel, active ? time : 0);
  const shown = focus === 'activation' ? activation : detour;
  const shaded = active && available >= shown.from;

  const arrowKeys = (event: React.KeyboardEvent) => {
    const step = event.shiftKey ? 1 : .1;
    const offsets: Record<string, number> = { ArrowLeft: -step, ArrowDown: -step, ArrowRight: step, ArrowUp: step };
    if (event.key === 'Home') { onSeek(0); event.preventDefault(); }
    if (event.key === 'End') { onSeek(available); event.preventDefault(); }
    if (event.key in offsets) { onSeek(time + offsets[event.key]); event.preventDefault(); }
  };
  const movePointer = (event: React.PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    onSeek((event.clientX - rect.left) / rect.width * duration);
  };

  const statistics = [
    { name: 'RMS', value: overview.rms?.toFixed(3), unit: t.normalizedShort, note: t.rms },
    { name: 'MAV', value: overview.mav?.toFixed(3), unit: t.normalizedShort, note: t.mav },
    { name: t.medianFreq, value: overview.median?.toFixed(0), unit: 'Hz', note: t.psd },
    { name: t.activations, value: active ? String(overview.activations) : undefined, unit: '', note: t.aboveThreshold },
  ];
  return <section className="glass glass--plot wave-panel" aria-labelledby="waves-title">
    <div className="panel-heading graph-heading">
      <div className="panel-title"><Activity size={19} /><h2 id="waves-title">{t.muscle}</h2></div>
      <div className="graph-tools">
        <label className="channel-select"><span>{t.channel}</span><select value={channel} aria-label={t.channel}
          onChange={(event) => setChannel(Number(event.target.value))}>
          {channels.map((code, index) => <option key={code} value={index}>{code}</option>)}
        </select></label>
        <div className="plot-toggle">
          <button aria-pressed={view === 'waves'} onClick={() => setView('waves')}>{t.waveforms}</button>
          <button aria-pressed={view === 'spectrum'} onClick={() => setView('spectrum')}>{t.spectrum}</button>
        </div>
      </div>
    </div>
    <div className="signal-stats" aria-label={t.signalStats}>
      {statistics.map((stat) => <div className="signal-stat" key={stat.name}>
        <span>{stat.name}</span><div><b>{stat.value ?? '—'}</b>{stat.value && stat.unit && <small>{stat.unit}</small>}</div><small title={stat.note}>{stat.note}</small>
      </div>)}
    </div>
    {view === 'waves' ? <div className="graph">
      <div className="track-labels">
        {channels.map((code, index) => {
          const state = channelStatus(index, active ? time : 0);
          return <div className="track-label" key={code}>
            <button className="channel channel-row" type="button" onClick={() => setChannel(index)}
              aria-pressed={channel === index} title={t[code] + ' · ' + t[state]}
              aria-label={code + ' ' + t[code] + ', ' + t[state]}>
              <b><i className={'channel-dot ' + state} /><span style={{ '--channel': channelColors[index] } as CSSProperties}>{code}</span></b>
              <span>{t[code]}</span>
            </button>
            <div className="y-values" aria-hidden="true"><span>1</span><span>0</span><span>−1</span></div>
          </div>;
        })}
        <div className="track-label motion-label">
          <div className="channel select-holder">
            <select value={kind} aria-label={t.path} onChange={(event) => setKind(event.target.value as Kinematic)}>
              {kinematics.map((item) => <option key={item} value={item}>{t[item]}</option>)}
            </select>
            <ChevronDown size={12} /><span>°</span>
          </div>
          <div className="y-values" aria-hidden="true"><span>{bounds[kind]}</span><span>{bounds[kind] / 2}</span><span>0</span></div>
        </div>
      </div>
      <div className={'plot' + (interactive ? ' interactive' : '')}
        role={interactive ? 'slider' : undefined} tabIndex={interactive ? 0 : undefined}
        aria-label={interactive ? t.seek : undefined} aria-valuemin={0} aria-valuemax={available}
        aria-valuenow={Number(time.toFixed(2))} onKeyDown={interactive ? arrowKeys : undefined}
        onPointerDown={interactive ? (event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          setDragging(true);
          movePointer(event);
        } : undefined}
        onPointerMove={interactive && dragging ? movePointer : undefined}
        onLostPointerCapture={() => setDragging(false)}>
        {ticks.map((tick) => <i key={tick} className="gridline" style={{ left: percent(tick) }} />)}
        {shaded && <i className={'range-highlight ' + (focus === 'activation' ? 'activation' : '')}
          style={{ left: percent(shown.from), width: percent(Math.min(shown.to, available) - shown.from) }} />}
        {interactive && <div className="traces faint" style={{ clipPath: 'inset(0 ' + percent(duration - available) + ' 0 0)' }}><Traces kind={kind} /></div>}
        <div className={'traces' + (active ? '' : ' preview-traces')}
          style={active ? { clipPath: 'inset(0 ' + percent(duration - time) + ' 0 0)' } : undefined}>
          <Traces kind={kind} />
        </div>
        {active && <i className="cursor" style={{ left: percent(time) }} />}
      </div>
      <div />
      <div className="x-scale" aria-hidden="true">
        {ticks.map((tick) => <span key={tick} style={{ left: percent(tick) }}>{tick.toFixed(1)}</span>)}
        <span className="x-unit">{t.resize} ({t.seconds})</span>
      </div>
    </div> : <Spectrum t={t} power={overview.power} />}
    <div className="phase-wrap">
      <h3 className="phase-title">{t.timeline}</h3>
      <div className="phase-section">
        <div className="phase-bar">
          {phases.map((phase) => <button key={phase.id}
            className={active && time >= phase.start && (time < phase.end || time === duration && phase.end === duration) ? 'current-phase' : ''}
            style={{ '--phase': phase.color, flexGrow: phase.end - phase.start } as CSSProperties}
            disabled={!interactive || phase.start > available} onClick={() => onSeek(phase.start)}>
            <span>{t[phase.id]}</span><small>{phase.end - phase.start}{t.seconds}</small>
          </button>)}
        </div>
        <div className="timeline-markers">
          <button style={{ left: percent(sampleSource.grip) }} disabled={!interactive || sampleSource.grip > available} onClick={() => onSeek(sampleSource.grip)}><Flag size={12} />{t.grip}</button>
          <button style={{ left: percent(sampleSource.arrival) }} disabled={!interactive || sampleSource.arrival > available} onClick={() => onSeek(sampleSource.arrival)}><CircleDot size={12} />{t.arrival}</button>
        </div>
      </div>
    </div>
    {view === 'waves' && <div className="chart-key"><span><i className="legend-raw" />{t.raw}</span><span><i className="legend-rms" />{t.envelope}</span><span><i className="legend-threshold" />{t.threshold}</span></div>}
  </section>;
}


