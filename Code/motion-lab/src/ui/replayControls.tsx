import { useEffect, useState } from 'react';
import { Pause, Play, RotateCcw, SkipBack, SkipForward } from 'lucide-react';
import type { Trial } from '../model';
import { usePlayback } from '../workflow';
import type { FlowText } from './flowText';

type Rate = .5 | 1 | 2;
export type ReplayController = ReturnType<typeof useReplay>;

export function useReplay(trial: Trial | null, originMs: number, edges: readonly number[]) {
  const [rate, setRate] = useState<Rate>(1);
  const [startedId, setStartedId] = useState<string>();
  const player = usePlayback(trial, rate);
  const started = startedId === trial?.id && Boolean(trial);
  const position = originMs + Math.round(player.time * 1000);
  const end = originMs + Math.round((trial?.elapsed ?? 0) * 1000);
  const atEnd = started && position >= end - 2;
  const prev = [...edges].reverse().find((edge) => edge < position - 2);
  const next = edges.find((edge) => edge > position + 2 && edge <= end);
  function toggle() {
    if (!trial) return;
    setStartedId(trial.id);
    player.toggle();
  }
  function seekMs(at: number) {
    if (!trial) return;
    setStartedId(trial.id);
    player.seek((at - originMs) / 1000);
  }
  return { ...player, toggle, seekMs, position, atEnd, started, prev, next, rate, setRate };
}

export function ReplayShortcuts({ replay }: { replay: ReplayController }) {
  useEffect(() => {
    function key(event: KeyboardEvent) {
      const target = event.target;
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || !(target instanceof HTMLElement)
        || target.closest('input, textarea, select, [contenteditable], dialog')) return;
      if (event.code === 'Space' && !target.closest('button, a') && !event.repeat) {
        event.preventDefault();
        replay.toggle();
      }
      if ((event.key === 'ArrowLeft' || event.key === 'ArrowRight') && !target.closest('[role="slider"]')) {
        event.preventDefault();
        replay.seekMs(replay.position + (event.key === 'ArrowLeft' ? -1 : 1) * (event.shiftKey ? 1000 : 100));
      }
    }
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [replay]);
  return null;
}

export function ReplayControls({ t, replay }: { t: FlowText; replay: ReplayController }) {
  const { prev, next, seekMs } = replay;
  const label = replay.playing ? t.pause : replay.atEnd ? t.replayAgain : replay.started ? t.play : t.startReplay;
  const Icon = replay.playing ? Pause : replay.atEnd ? RotateCcw : Play;
  return <div className="replay-controls">
    <label className="history-select replay-speed"><select aria-label={t.speed} title={t.speed}
      value={replay.rate} onChange={(event) => replay.setRate(Number(event.target.value) as Rate)}>
      <option value={.5}>0.5×</option><option value={1}>1×</option><option value={2}>2×</option>
    </select></label>
    <button className="icon-button" aria-label={t.previous} title={t.previous} disabled={prev === undefined}
      onClick={() => prev !== undefined && seekMs(prev)}><SkipBack size={17} /></button>
    <button className="icon-button" aria-label={t.next} title={t.next} disabled={next === undefined}
      onClick={() => next !== undefined && seekMs(next)}><SkipForward size={17} /></button>
    <button className="button btn-primary stable-replay-button" onClick={replay.toggle}>
      <Icon size={16} />{label}
    </button>
  </div>;
}
