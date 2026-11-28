import { Box, ScanLine } from 'lucide-react';
import { lazy, memo, Suspense, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { emptyAngles, jointAngles } from '../pose/jointAngles';
import { applyCalibration, type Calibration } from '../pose/poseMath';
import { imuTimeOffsetMs, readoutsPerSecond } from '../pose/poseConfig';
import { segmentIds, type PoseSource } from '../pose/PoseSource';
import type { PoseClock, PoseTick } from '../pose/poseClock';
import type { BaChannel } from '../baSignal';
import type { ActivationReader } from '../pose/activation';
import type { PoseLabels } from '../pose/poseText';
import type { AngleKey } from './ArmSkeleton';

const ArmSkeleton = lazy(() => import('./ArmSkeleton'));

export type PoseView = 'front' | 'side' | 'top';
export type PoseData = { source: PoseSource; calibration: Calibration | null; calibrationWarning: boolean };
const views = ['front', 'side', 'top'] as const;
const angleKeys: readonly AngleKey[] = ['abduction', 'flexion', 'elbow', 'trunkTilt'];
const angleColors: Record<AngleKey, string> = {
  abduction: '#2B8CBE',
  flexion:   '#009E73',
  elbow:     '#7E57C2',
  trunkTilt: '#D95F02',
};
const formatAngle = (value: number | null) => value === null ? '—' : (Math.abs(value) < .05 ? 0 : value).toFixed(1) + '°';

export const PosePanel = memo(function PosePanel({ t, data, clock, live, muscle, activation, emptyText, uncalibratedText }: {
  t: PoseLabels; data: PoseData; clock: PoseClock; live?: boolean; muscle: BaChannel | null; activation: ActivationReader;
  emptyText?: string; uncalibratedText?: string;
}) {
  const [view, setView] = useState<PoseView>('front');
  const [orbit, setOrbit] = useState(false);
  const [focusAngle, setFocusAngle] = useState<AngleKey | null>(null);
  const readouts = useRef<HTMLDivElement>(null);
  const statuses = useRef<HTMLDivElement>(null);
  const { source, calibration } = data;
  const showScene = source.hasData && calibration !== null;

  const shortLabels = useMemo<Record<AngleKey, string>>(() => (
    t.front === '正面'
      ? { abduction: '外展', flexion: '屈曲', elbow: '肘屈', trunkTilt: '躯干' }
      : { abduction: 'Abd', flexion: 'Flex', elbow: 'Elb', trunkTilt: 'Trunk' }
  ), [t.front]);

  useLayoutEffect(() => {
    let last = -Infinity;
    function update(tick: PoseTick) {
      const now = performance.now();
      if (tick.running && now - last < 1000 / readoutsPerSecond) return;
      last = now;
      const sample = source.getFrameAt((tick.timeMs - imuTimeOffsetMs) / 1000);
      const angles = source.hasData && calibration
        ? jointAngles(applyCalibration(sample.q, calibration.offsets), source.side, calibration.heading)
        : emptyAngles;
      for (const key of angleKeys) {
        const target = readouts.current?.querySelector<HTMLElement>('[data-angle="' + key + '"]');
        if (!target) continue;
        target.textContent = formatAngle(angles[key]);
        if (key === 'trunkTilt') target.title = t.trunkForward + ' ' + formatAngle(angles.trunkForward) + ' · ' + t.trunkLateral + ' ' + formatAngle(angles.trunkLateral);
      }
      for (const id of segmentIds) {
        const node = statuses.current?.querySelector<HTMLElement>('[data-segment="' + id + '"]');
        if (!node) continue;
        const accessibleName = t[id] + ' · ' + t[sample.status[id]];
        if (node.title === accessibleName) continue;
        node.dataset.status = sample.status[id];
        node.title = accessibleName;
        node.setAttribute('aria-label', accessibleName);
        const caption = node.querySelector('[data-status-label]');
        if (caption) caption.textContent = sample.status[id] === 'lost' ? ' · ' + t.lost : '';
      }
    }
    update(clock.current());
    return clock.subscribe(update);
  }, [clock, calibration, source, t]);

  return <section className="pose-panel well" aria-label={t.pose}>
    <div className="pose-controls">
      <div className="pose-view-switch" role="group" aria-label={t.cameraViews}>
        {views.map((angle) => <button type="button" key={angle} aria-pressed={view === angle} disabled={!showScene}
          onClick={() => setView(angle)}>{t[angle]}</button>)}
      </div>
      <button className="pose-orbit" type="button" aria-pressed={orbit} onClick={() => setOrbit(!orbit)}
        disabled={!showScene}><ScanLine size={13} />{t.rotate}</button>
    </div>
    <div className={'pose-viewport' + (showScene ? '' : ' well--empty')} data-testid="pose-viewport">
      {showScene ? <Suspense fallback={<div className="pose-empty" role="status">{t.estimate}</div>}>
        <ArmSkeleton source={source} calibration={calibration} clock={clock} view={view} orbit={orbit}
          message={t.renderError} muscle={muscle} focusAngle={focusAngle} activation={activation}
          angleShortLabels={shortLabels} />
      </Suspense> : <div className="pose-empty"><Box size={26} strokeWidth={1.4} />
        <p>{emptyText ?? (source.hasData ? t.calNeeded : live ? t.waiting : t.noData)}</p>
      </div>}
    </div>
    <div className="pose-readouts" ref={readouts} role="group" aria-label={t.pose}>
      {angleKeys.map((angle) => <button
        key={angle}
        type="button"
        className="pose-angle-card"
        aria-pressed={focusAngle === angle}
        style={{ '--angle-dot': angleColors[angle] } as React.CSSProperties}
        onPointerEnter={() => showScene && setFocusAngle(angle)}
        onPointerLeave={() => setFocusAngle((cur) => cur === angle ? null : cur)}
        onClick={() => showScene && setFocusAngle((cur) => cur === angle ? null : angle)}
      >
        <span className="pose-angle-name"><i aria-hidden="true" />{t[angle]}</span>
        <strong data-angle={angle}>—</strong>
      </button>)}
    </div>
    <div className="pose-footer">
      <div className="pose-status" ref={statuses} aria-label={t.pose}>
        {segmentIds.map((id) => <span key={id} data-segment={id} data-status="missing" title={t[id] + ' · ' + t.missing}
          aria-label={t[id] + ' · ' + t.missing}><i />{t[id]}<small data-status-label /></span>)}
        {data.calibrationWarning && <span className="pose-warning" data-status="lost"><i />{t.abnormal}</span>}
        {uncalibratedText && <span className="pose-uncal-tag">{uncalibratedText}</span>}
      </div>
    </div>
  </section>;
});
