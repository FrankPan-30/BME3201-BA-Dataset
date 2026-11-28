export const baPhases = ['REST', 'REACH', 'LIFT_TRANSFER', 'RETURN'] as const;
export type BaPhase = typeof baPhases[number];
export type BoundaryStatus = 'auto' | 'review' | 'unresolved';

export type BaInterval = {
  code: BaPhase;
  startMs: number | null;
  endMs: number | null;
  status: BoundaryStatus;
  startSource: string;
  endSource: string;
  notes: string;
};

export type BaRecord = {
  id: string;
  method: string;
  originMs: number;
  endMs: number;
  phaseBlob: string;
  trialBlob: string;
  signalId: string | null;
  phases: readonly BaInterval[];
};

type PhaseEvent = {
  kind: 'phase-start' | 'phase-end';
  phase: BaPhase;
  atMs: number;
};

export type BaEvent = PhaseEvent | { kind: 'trial-end'; atMs: number };

export type BaSnapshot = {
  record: BaRecord;
  events: readonly BaEvent[];
  segmentationComplete: boolean;
};

export const baPosition = (record: BaRecord, elapsed: number) =>
  record.originMs + Math.floor(elapsed * 1000 + 0.000001);

export const baElapsed = (record: BaRecord, atMs: number) => (atMs - record.originMs) / 1000;

export function baSeconds(ms: number) {
  return (ms < 0 ? '−' : '') + (Math.abs(ms) / 1000).toFixed(3);
}

export function createBaEvents(record: BaRecord): BaEvent[] {
  const events: BaEvent[] = [];
  for (const phase of record.phases) {
    if (phase.startMs !== null) events.push({ kind: 'phase-start', phase: phase.code, atMs: phase.startMs });
    if (phase.endMs !== null) events.push({ kind: 'phase-end', phase: phase.code, atMs: phase.endMs });
  }
  events.push({ kind: 'trial-end', atMs: record.endMs });
  const priority: Record<BaEvent['kind'], number> = { 'phase-end': 0, 'phase-start': 1, 'trial-end': 2 };
  return events.sort((a, b) => a.atMs - b.atMs || priority[a.kind] - priority[b.kind]);
}

export function createBaSource(record: BaRecord) {
  const events = createBaEvents(record);
  let next = 0;
  return {
    advance(atMs: number) {
      const begin = next;
      while (next < events.length && events[next].atMs <= atMs) next++;
      return events.slice(begin, next);
    },
  };
}

export function baObserved(events: readonly BaEvent[], phase: BaPhase) {
  return {
    startMs: events.find((event) => event.kind === 'phase-start' && event.phase === phase)?.atMs ?? null,
    endMs: events.find((event) => event.kind === 'phase-end' && event.phase === phase)?.atMs ?? null,
  };
}

export function baSnapshot(record: BaRecord, events: readonly BaEvent[]): BaSnapshot {
  return {
    record,
    events,
    segmentationComplete: baPhases.every((phase) => {
      const edges = baObserved(events, phase);
      return edges.startMs !== null && edges.endMs !== null;
    }),
  };
}

