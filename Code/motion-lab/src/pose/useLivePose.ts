import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { baObserved, type BaEvent } from '../ba';
import { emptyPoseSource } from './PoseSource';
import { createPoseClock } from './poseClock';
import { createLivePose, type LiveHeader } from './livePose';
import { followPoseFile, pickLivePoseFile, type ReadablePoseFile } from './liveFile';
import { checkCalibration, type RestWindow } from './poseRecord';
import { imuTimeOffsetMs, maxPoseFramesPerSecond, readoutsPerSecond } from './poseConfig';
import type { PoseData } from '../components/PosePanel';

const initial = {
  connected: false, file: '', data: { source: emptyPoseSource, calibration: null, calibrationWarning: false } as PoseData,
  events: [] as BaEvent[], error: null as 'read' | 'picker' | 'packet' | null,
};

export function useLivePose(enabled: boolean) {
  const clock = useMemo(createPoseClock, []);
  const [snapshot, update] = useState(initial);
  const [positionMs, setPosition] = useState(0);
  const active = useRef<AbortController | null>(null);
  const generation = useRef(0);

  const disconnect = useCallback(() => {
    generation.current++;
    active.current?.abort();
    active.current = null;
    update(initial);
    setPosition(0);
    clock.publish({ timeMs: 0, running: false, transfer: false });
  }, [clock]);

  useEffect(() => {
    if (!enabled) disconnect();
    return () => {
      generation.current++;
      active.current?.abort();
    };
  }, [enabled, disconnect]);

  function open(handle: ReadablePoseFile) {
    active.current?.abort();
    const lifetime = new AbortController();
    active.current = lifetime;
    const events: BaEvent[] = [];
    update({ ...initial, connected: true, file: handle.name });
    setPosition(0);

    let metadata: LiveHeader | undefined;
    let session: ReturnType<typeof createLivePose> | undefined;
    let firstData = false;
    let restChecked = false;
    let nextVisual = 0;
    let lastReadout = -Infinity;
    let animation = 0;
    let stop = () => {};
    lifetime.signal.addEventListener('abort', () => { stop(); cancelAnimationFrame(animation); }, { once: true });

    const deviceRest = (): RestWindow | undefined => {
      if (metadata?.rest) return metadata.rest;
      const rest = baObserved(events, 'REST');
      return rest.startMs !== null && rest.endMs !== null
        ? [(rest.startMs - imuTimeOffsetMs) / 1000, (rest.endMs - imuTimeOffsetMs) / 1000] : undefined;
    };

    const animate = (now: number) => {
      const newTime = session?.time();
      if (newTime && now >= nextVisual) {
        const interval = 1000 / maxPoseFramesPerSecond;
        nextVisual += (Math.floor((now - nextVisual) / interval) + 1) * interval;
        const timeMs = newTime.t * 1000 + imuTimeOffsetMs;
        const lift = baObserved(events, 'LIFT_TRANSFER');
        const transfer = lift.startMs !== null && timeMs >= lift.startMs && (lift.endMs === null || timeMs < lift.endMs);
        clock.publish({ timeMs, running: newTime.running, transfer });
        if (now - lastReadout >= 1000 / readoutsPerSecond) {
          lastReadout = now;
          setPosition(Math.round(timeMs));
        }
      }
      if (!lifetime.signal.aborted) animation = requestAnimationFrame(animate);
    };
    animation = requestAnimationFrame(animate);

    stop = followPoseFile(handle, {
      header(input) {
        metadata = input;
        session = createLivePose(input.side, input.segments);
        const data = { source: session.source, ...checkCalibration([], input.side, undefined, input.calibration) };
        update((value) => ({ ...value, data }));
      },
      packet(packet) {
        if (packet.type === 'event') {
          const event = packet.event;
          if (!events.some((previous) => previous.kind === event.kind &&
              ('phase' in previous ? 'phase' in event && previous.phase === event.phase : !('phase' in event)))) {
            events.push(event);
            events.sort((a, b) => a.atMs - b.atMs);
            update((value) => ({ ...value, events: [...events] }));
          }
          return;
        }
        if (!session || !metadata || !session.push(packet.pose)) return;
        const quiet = deviceRest();
        const finishedRest = !restChecked && quiet && packet.pose.t >= quiet[1];
        if ((!firstData && session.source.hasData) || finishedRest) {
          firstData = session.source.hasData;
          restChecked ||= Boolean(finishedRest);
          const data = { source: session.source, ...checkCalibration(session.rows(), metadata.side, quiet, metadata.calibration) };
          update((value) => ({ ...value, data }));
        }
      },
      invalidPacket() { update((value) => value.error ? value : { ...value, error: 'packet' }); },
      failed() {
        disconnect();
        update({ ...initial, error: 'read' });
      },
    });
  }

  async function connect() {
    if (!enabled) return;
    const id = ++generation.current;
    try {
      const handle = await pickLivePoseFile();
      if (id !== generation.current) return;
      if (!handle) { update((value) => ({ ...value, error: 'picker' })); return; }
      open(handle);
    } catch (error) {
      if (id !== generation.current || (error instanceof DOMException && error.name === 'AbortError')) return;
      update((value) => ({ ...value, error: 'read' }));
    }
  }

  return { ...snapshot, positionMs, clock, connect, disconnect };
}
