import { lazy, Suspense, useState, type ReactNode } from 'react';
import { ChevronUp, RotateCcw, UserRound } from 'lucide-react';
import type { HardwareFocus } from '../components/HardwareHero';
import type { ArchiveSubject, ArchiveText } from './archive';

const HardwareHero = lazy(() => import('../components/HardwareHero'));
const poster = <div className="motion-stage-poster" aria-hidden="true" />;

const focusItems: readonly { id: HardwareFocus; zh: string; en: string }[] = [
  { id: 'overview', zh: '系统总览', en: 'Overview' },
  { id: 'esp32', zh: 'ESP32-S3', en: 'ESP32-S3' },
  { id: 'ads1298', zh: 'ADS1298', en: 'ADS1298' },
  { id: 'imu', zh: '3× IMU', en: '3× IMU' },
  { id: 'emg', zh: '6路 EMG 电极', en: '6-ch EMG Leads' },
];

export function MotionHome({ copy, subject, enter, choose, header }: {
  copy: ArchiveText; subject?: ArchiveSubject; enter: () => void; choose: () => void; header: ReactNode;
}) {
  const [focus, setFocus] = useState<HardwareFocus>('overview');
  const [replayToken, setReplayToken] = useState(0);
  const isZh = copy.home === '首页';
  const subjectText = subject
    ? [subject.name, subject.id, subject.pareticSide ? (subject.pareticSide === 'left' ? copy.leftParetic : copy.rightParetic) : null]
        .filter(Boolean).join(' · ')
    : copy.chooseFirst;

  return <section className="motion-home">
    {header}
    <div className="motion-home-intro">
      <h1>Motion Lab</h1>
      <p>{copy.task} <span aria-hidden="true">·</span> ESP32-S3 + ADS1298 + 3×IMU + 6-ch EMG</p>
    </div>
    <Suspense fallback={<div className="motion-home-stage">{poster}</div>}>
      <HardwareHero focus={focus} onFocusChange={setFocus} replayToken={replayToken}
        fallbackMessage={copy.no3d} stageLabel={copy.scene} />
    </Suspense>
    <div className="motion-home-controls">
      <div className="motion-scene-pills" role="group" aria-label={copy.scene}>
        {focusItems.map((item) => <button key={item.id} type="button" className="motion-scene-control"
          aria-pressed={focus === item.id} onClick={() => setFocus(item.id)}>
          {isZh ? item.zh : item.en}
        </button>)}
        <button type="button" className="motion-scene-control" onClick={() => { setFocus('overview'); setReplayToken((n) => n + 1); }}
          title={isZh ? '重播开场视角' : 'Replay intro'}>
          <RotateCcw size={13} />{isZh ? '重播视角' : 'Replay'}
        </button>
      </div>
      <div className="motion-home-actions">
        <button className="button motion-home-pill" type="button" onClick={choose}>
          <UserRound size={15} />{subjectText}
        </button>
        <button className="button btn-primary motion-home-pill" type="button" onClick={enter}>
          <ChevronUp size={16} />{copy.enter}
        </button>
      </div>
      <button type="button" className="home-swipe-cue" onClick={enter} aria-label={copy.swipeEnter}>
        <span>{copy.swipeEnter}</span>
        <i className="home-swipe-handle" aria-hidden="true" />
      </button>
    </div>
  </section>;
}
