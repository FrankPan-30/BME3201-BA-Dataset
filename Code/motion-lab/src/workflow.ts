import { useCallback, useEffect, useRef, useState } from 'react';
import { clampTime, freshOutcome, type Outcome, type RecordingPause, type Trial } from './model';
import { baElapsed, baPosition, baSnapshot, createBaSource, type BaEvent, type BaRecord } from './ba';
import { openCamera, recordCamera, releaseCamera, withDeadline, type Capture, type RecordedVideo } from './video';

type Mode = 'idle' | 'starting' | 'recording' | 'paused' | 'finalizing' | 'confirming';
type CameraState = 'off' | 'loading' | 'ready' | 'unavailable' | 'interrupted';

export function useWorkflow(onFinish: (trial: Trial) => void) {
  const [mode, setMode] = useState<Mode>('idle');
  const [camera, setCamera] = useState<CameraState>('off');
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const modeRef = useRef<Mode>('idle');
  const media = useRef<MediaStream | null>(null);
  const request = useRef(0);
  const capture = useRef<Capture | null>(null);
  const recordingEndedAt = useRef<number | null>(null);
  const videoPauses = useRef<RecordingPause[]>([]);
  const pauseStarted = useRef(0);
  const anchors = useRef({ start: 0, elapsed: 0, since: 0 });
  const number = useRef(1);
  const run = useRef<{ record: BaRecord; source: ReturnType<typeof createBaSource>; events: BaEvent[] } | null>(null);
  const [events, setEvents] = useState<readonly BaEvent[]>([]);

  const changeMode = useCallback((value: Mode) => {
    modeRef.current = value;
    setMode(value);
  }, []);

  const currentTime = useCallback(() => {
    const { since, elapsed: already } = anchors.current;
    return clampTime(already + (since ? (performance.now() - since) / 1000 : 0));
  }, []);

  const closePreview = useCallback(() => {
    request.current++;
    releaseCamera(media.current);
    media.current = null;
    setStream(null);
    setCamera('off');
  }, []);

  const getPreview = useCallback(async () => {
    if (media.current?.getVideoTracks().some((track) => track.readyState === 'live')) return media.current;
    setCamera('loading');
    const token = ++request.current;
    try {
      let expired = false;
      const opening = openCamera().then((cameraStream) => {
        if (expired) releaseCamera(cameraStream);
        return cameraStream;
      });
      const preview = await withDeadline(opening, 5500, () => { expired = true; });
      if (token !== request.current) {
        releaseCamera(preview);
        return null;
      }
      media.current = preview;
      setStream(preview);
      setCamera('ready');
      for (const track of preview.getVideoTracks()) {
        track.addEventListener('ended', () => {
          if (media.current !== preview) return;
          media.current = null;
          setStream(null);
          setCamera(capture.current ? 'interrupted' : 'unavailable');
          if (capture.current) recordingEndedAt.current = currentTime();
        }, { once: true });
      }
      return preview;
    } catch {
      if (token === request.current) setCamera('unavailable');
      return null;
    }
  }, [currentTime]);

  useEffect(() => () => releaseCamera(media.current), []);

  async function start(nextNumber: number, record: BaRecord) {
    if (modeRef.current !== 'idle') return;
    changeMode('starting');
    setElapsed(0);
    number.current = nextNumber;
    run.current = { record, source: createBaSource(record), events: [] };
    setEvents([]);
    recordingEndedAt.current = null;
    videoPauses.current = [];
    pauseStarted.current = 0;
    const preview = await getPreview();
    if (preview) {
      try {
        const active = recordCamera(preview);
        capture.current = active;
        await withDeadline(active.started, 7500);
        void active.stopped.then((result) => {
          if (result.interrupted && capture.current === active) {
            recordingEndedAt.current ??= currentTime();
            releaseCamera(media.current);
            media.current = null;
            setStream(null);
            setCamera('interrupted');
          }
        });
      } catch {
        void capture.current?.stop();
        capture.current = null;
        releaseCamera(media.current);
        media.current = null;
        setStream(null);
        setCamera('unavailable');
      }
    }
    anchors.current = { start: Date.now(), elapsed: 0, since: performance.now() };
    changeMode('recording');
  }

  const advance = useCallback((elapsed: number) => {
    const current = run.current;
    if (!current) return undefined;
    const next = current.source.advance(baPosition(current.record, elapsed));
    if (next.length) {
      current.events = [...current.events, ...next];
      setEvents(current.events);
    }
    return next.find((event) => event.kind === 'trial-end');
  }, []);

  const finish = useCallback(async (endedAtMs?: number) => {
    const current = run.current;
    if (!current || (modeRef.current !== 'recording' && modeRef.current !== 'paused')) return;
    const requested = endedAtMs === undefined ? currentTime() : baElapsed(current.record, endedAtMs);
    const end = clampTime(requested, baElapsed(current.record, current.record.endMs));
    advance(end);
    const complete = current.events.some((event) => event.kind === 'trial-end');
    anchors.current.since = 0;
    anchors.current.elapsed = end;
    setElapsed(end);
    changeMode('finalizing');
    let recorded: RecordedVideo = { blob: null, interrupted: false };
    if (capture.current) recorded = await capture.current.stop();
    capture.current = null;
    closePreview();
    onFinish({
      id: crypto.randomUUID(), number: number.current, started: anchors.current.start,
      source: 'ba-repository-v1', ba: baSnapshot(current.record, current.events),
      elapsed: end, complete, outcome: { ...freshOutcome },
      video: recorded.blob, videoTime: recorded.blob ? Math.min(recordingEndedAt.current ?? end, end) : 0,
      videoPauses: videoPauses.current,
      videoState: recorded.interrupted ? 'interrupted' : recorded.blob ? 'recorded' : 'none',
    });
    changeMode('confirming');
  }, [advance, changeMode, closePreview, currentTime, onFinish]);

  useEffect(() => {
    if (mode !== 'recording') return;
    let frame = 0;
    const update = () => {
      if (modeRef.current !== 'recording') return;
      const time = currentTime();
      const terminal = advance(time);
      if (terminal) {
        void finish(terminal.atMs);
      } else {
        setElapsed(time);
        frame = requestAnimationFrame(update);
      }
    };
    frame = requestAnimationFrame(update);
    return () => cancelAnimationFrame(frame);
  }, [mode, currentTime, advance, finish]);

  function pause() {
    if (modeRef.current !== 'recording') return;
    const time = currentTime();
    const terminal = advance(time);
    if (terminal) {
      void finish(terminal.atMs);
      return;
    }
    anchors.current.elapsed = time;
    anchors.current.since = 0;
    setElapsed(time);
    pauseStarted.current = performance.now();
    capture.current?.pause();
    changeMode('paused');
  }

  function resume() {
    if (modeRef.current !== 'paused') return;
    if (capture.current && recordingEndedAt.current === null && pauseStarted.current) {
      videoPauses.current.push({
        at: anchors.current.elapsed, seconds: (performance.now() - pauseStarted.current) / 1000,
      });
    }
    pauseStarted.current = 0;
    capture.current?.resume();
    anchors.current.since = performance.now();
    changeMode('recording');
  }

  const reset = () => {
    run.current = null;
    setEvents([]);
    setElapsed(0);
    changeMode('idle');
  };

  return { mode, elapsed, events, camera, stream, start, getPreview, closePreview, pause, resume, finish, reset };
}

export function usePlayback(trial: Trial | null, rate = 1) {
  const video = useRef<HTMLVideoElement>(null);
  const cursor = useRef(0);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [asset, setAsset] = useState<{ blob: Blob; url: string }>();
  const url = asset?.blob === trial?.video ? asset?.url : undefined;
  const limit = trial?.elapsed ?? 0;
  const recordedUntil = trial?.videoTime ?? 0;
  const pauseGaps = trial?.videoPauses;
  const trialId = trial?.id;
  const blob = trial?.video;

  useEffect(() => {
    cursor.current = 0;
    setTime(0);
    setPlaying(false);
    const objectUrl = blob ? URL.createObjectURL(blob) : undefined;
    setAsset(blob && objectUrl ? { blob, url: objectUrl } : undefined);
    return () => {
      if (objectUrl) window.setTimeout(() => URL.revokeObjectURL(objectUrl), 500);
    };
  }, [trialId, blob]);

  const sync = useCallback((position: number, force = false) => {
    const media = video.current;
    if (!media || media.readyState < 1) return;
    const activePosition = Math.min(position, recordedUntil);
    const totalPause = pauseGaps?.reduce((sum, gap) => sum + gap.seconds, 0) ?? 0;
    // Chromium can keep skipped time in WebM timestamps even while video frames are paused.
    const hasGaps = totalPause > 0.05 && media.duration >= recordedUntil + totalPause / 2;
    const skipped = hasGaps
      ? pauseGaps?.reduce((sum, gap) => sum + (gap.at <= activePosition ? gap.seconds : 0), 0) ?? 0 : 0;
    const target = Number.isFinite(media.duration) ? Math.min(activePosition + skipped, media.duration) : activePosition;
    if (force || Math.abs(media.currentTime - target) > 0.16) media.currentTime = target;
    if (position >= recordedUntil) media.pause();
  }, [pauseGaps, recordedUntil]);

  const seek = useCallback((position: number) => {
    const next = clampTime(position, limit);
    cursor.current = next;
    setTime(next);
    sync(next, true);
    const media = video.current;
    if (playing && media?.paused && next < recordedUntil) void media.play().catch(() => {});
  }, [limit, playing, recordedUntil, sync]);

  useEffect(() => {
    if (!playing) {
      video.current?.pause();
      return;
    }
    if (video.current) video.current.playbackRate = rate;
    if (cursor.current < recordedUntil) void video.current?.play().catch(() => {});
    let last = performance.now();
    let frame = 0;
    const update = (now: number) => {
      const position = clampTime(cursor.current + (now - last) / 1000 * rate, limit);
      last = now;
      cursor.current = position;
      setTime(position);
      sync(position);
      if (position >= limit) setPlaying(false);
      else frame = requestAnimationFrame(update);
    };
    frame = requestAnimationFrame(update);
    return () => cancelAnimationFrame(frame);
  }, [playing, limit, recordedUntil, sync, rate]);

  function toggle() {
    if (!limit) return;
    if (!playing && cursor.current >= limit - 0.01) seek(0);
    setPlaying(!playing);
  }

  return { video, time, url, seek, playing, toggle, onMetadata: () => {
    if (video.current) video.current.playbackRate = rate;
    sync(cursor.current, true);
  } };
}

export function applyOutcome(trial: Trial, outcome: Outcome): Trial {
  return { ...trial, outcome };
}





