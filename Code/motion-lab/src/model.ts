import type { BaSnapshot } from './ba';

export const phases = [
  { id: 'prepare', start: 0, end: 2, color: '#e3e7f1' },
  { id: 'reach', start: 2, end: 5, color: '#dce0f1' },
  { id: 'transport', start: 5, end: 9, color: '#e6e8f1' },
  { id: 'hold', start: 9, end: 12, color: '#e4e6ef' },
  { id: 'return', start: 12, end: 15, color: '#eaecf4' },
] as const;

export const duration = phases[phases.length - 1].end;
export const channels = ['BB', 'TB', 'AD', 'MD', 'FCR', 'ECR'] as const;
export const kinematics = ['elbow', 'shoulder', 'forearm'] as const;
export type Kinematic = typeof kinematics[number];
export type TimelineEvent = { kind: 'detour' | 'activation'; from: number; to: number };

// The renderer consumes timed decisions, so a future algorithm can supply the same event shape.
export const sampleSource = {
  id: 'ba-demo-01',
  grip: 5,
  arrival: 9,
  events: [
    { kind: 'detour', from: 3.2, to: 4.65 },
    { kind: 'activation', from: 2.85, to: 4.85 },
  ] as readonly TimelineEvent[],
  metrics: { cci: 0.42, shoulder: 19.4, rom: 82.0, ad: 0.68, md: 0.74, variation: 2.8, sd: 1.6 },
  scores: [78, 88, 80] as const,
  total: 82,
};

export const detour = sampleSource.events[0];
export const activation = sampleSource.events[1];

export function clampTime(time: number, end: number = Number.POSITIVE_INFINITY) {
  return Number.isFinite(time) ? Math.max(0, Math.min(end, time)) : 0;
}

export function clock(time: number) {
  const ticks = Math.floor(clampTime(time) * 100 + 0.00001);
  const minutes = String(Math.floor(ticks / 6000)).padStart(2, '0');
  const seconds = String(Math.floor(ticks / 100) % 60).padStart(2, '0');
  return minutes + ':' + seconds + '.' + String(ticks % 100).padStart(2, '0');
}

const gaussian = (time: number, center: number, width: number) =>
  Math.exp(-0.5 * ((time - center) / width) ** 2);

const smooth = (value: number) => {
  const x = Math.max(0, Math.min(1, value));
  return x * x * (3 - 2 * x);
};

function angle(time: number, kind: Kinematic) {
  if (kind === 'shoulder') return 2.2 + 17.2 * gaussian(time, 3.85, 0.61)
    + smooth((time - 5) / 0.8) * (1 - smooth((time - 11) / 2)) * (5 + 1.8 * Math.sin(time * 3));
  if (kind === 'forearm') {
    const carrying = smooth((time - 4.4) / 0.8) * (1 - smooth((time - 8.82) / 0.8));
    return 15 + 28 * smooth((time - 2.1) / 3.2) * (1 - smooth((time - 11.7) / 2.5))
      + carrying * (3.5 * Math.sin(time * 10) + 1.1 * Math.sin(time * 21));
  }
  return 36 + 82 * smooth((time - 2) / 4.2) * (1 - smooth((time - 11.84) / 3.1))
    + 2.25 * smooth((time - 8.6) / 0.4) * (1 - smooth((time - 11.65) / 0.35)) * Math.sin(time * 17);
}

const pathFrom = (sample: (time: number) => number) =>
  Array.from({ length: 951 }, (_, index) => {
    const x = index / 950;
    return (index ? 'L' : 'M') + (x * 1000).toFixed(1) + ',' + sample(x * duration).toFixed(2);
  }).join(' ');

export const bounds: Record<Kinematic, number> = { elbow: 150, shoulder: 30, forearm: 60 };
export const motionPaths = Object.fromEntries(kinematics.map((kind) =>
  [kind, pathFrom((time) => 39 - angle(time, kind) / bounds[kind] * 34)])) as Record<Kinematic, string>;

export type Answer = 'unknown' | 'yes' | 'no';
export type Outcome = Record<'success' | 'drop' | 'assist', Answer>;
export type RecordingPause = { at: number; seconds: number };
export type LimbRole = 'paretic' | 'healthy';
export type AnnotationTag = 'shrug' | 'trunk_lean' | 'elbow_deficit' | 'grip_slip' | 'fatigue_tremor' | 'custom';
export type TrialAnnotation = {
  id: string;
  atMs: number;
  tag: AnnotationTag;
  note: string;
  createdAt: number;
};

export type Trial = {
  id: string;
  number: number;
  subjectTrialNumber?: number;
  dateKey?: string;
  started: number;
  source: typeof sampleSource.id | 'ba-repository-v1' | 'ui-preview';
  subjectId?: string;
  limbRole?: LimbRole;
  recordedSide?: 'left' | 'right';
  reviewed?: boolean;
  demo?: import('./ui/liveFlow').UiTrial;
  ba?: BaSnapshot;
  quality?: import('./assessment').QualityReport;
  annotations?: TrialAnnotation[];
  clinicalNote?: string;
  prescription?: string;
  elapsed: number;
  complete: boolean;
  outcome: Outcome;
  video: Blob | null;
  videoTime: number;
  videoPauses?: RecordingPause[];
  videoState: 'recorded' | 'none' | 'interrupted';
};
export const freshOutcome: Outcome = { success: 'unknown', drop: 'unknown', assist: 'unknown' };





