import type { AnnotationTag, LimbRole, Trial } from '../model';
import type { Lang } from '../text';

export type Sex = 'male' | 'female';
export type PareticSide = 'left' | 'right';

export type ArchiveSubject = {
  id: string;
  name: string;
  age?: number;
  sex?: Sex;
  pareticSide?: PareticSide;
  onsetNote?: string;
};

export function resolveRecordingSide(subject: ArchiveSubject | undefined, limbRole: LimbRole = 'paretic'): PareticSide {
  const paretic: PareticSide = subject?.pareticSide ?? 'right';
  if (limbRole === 'paretic') return paretic;
  return paretic === 'right' ? 'left' : 'right';
}

export const annotationTagLabels: Record<Lang, Record<AnnotationTag, string>> = {
  zh: {
    shrug: '耸肩代偿',
    trunk_lean: '躯干前倾',
    elbow_deficit: '肘伸展不足',
    grip_slip: '抓握滑脱',
    fatigue_tremor: '疲劳抖动',
    custom: '自定义标记',
  },
  en: {
    shrug: 'Shoulder shrug',
    trunk_lean: 'Trunk lean',
    elbow_deficit: 'Elbow deficit',
    grip_slip: 'Grip slip',
    fatigue_tremor: 'Fatigue tremor',
    custom: 'Custom marker',
  },
};

export function formatLocalDateKey(timestampMs: number): string {
  const d = new Date(timestampMs);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function nextSubjectDayTrialNumber(trials: readonly Trial[], subjectId: string | undefined, nowMs = Date.now()): number {
  const today = formatLocalDateKey(nowMs);
  const matching = trials.filter((t) =>
    (t.subjectId ?? '') === (subjectId ?? '') && (t.dateKey ?? formatLocalDateKey(t.started)) === today,
  );
  return matching.reduce((max, t) => Math.max(max, (t.subjectTrialNumber ?? t.number) + 1), 1);
}
