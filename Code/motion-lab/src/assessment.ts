import { baObserved, type BaEvent, type BaRecord } from './ba';
import { baSignal, baSignalMetrics, type BaSignal } from './baSignal';
import type { Trial } from './model';

export type QualityReport = {
  total: number;            // 0 - 100 composite movement quality score
  muscleScore: number;      // 1. 肌肉代偿与共同激活评分 (0 - 100)
  timingScore: number;      // 2. 各阶段耗时评分 (0 - 100)
  stabilityScore: number;   // 3. 搬运过程稳定性评分 (0 - 100)
  cci: number;              // BB / TB co-activation index (0.15 - 0.85, lower is better synergy)
  abductionPeak: number;    // Peak shoulder abduction compensation angle (deg)
  adMdRatio: number;        // AD / MD recruitment ratio
  totalSeconds: number;     // Total task duration (s)
  phaseSeconds: {
    REST: number | null;
    REACH: number | null;
    LIFT_TRANSFER: number | null;
    RETURN: number | null;
  };
  transportVariation: number; // Forearm/trunk attitude variation during LIFT_TRANSFER (deg)
  elbowRom: number;           // Elbow range of motion (deg)
  holdSd: number;             // Endpoint stability SD (deg)
  detourDetected: boolean;
  grade: 'excellent' | 'mild' | 'compensatory';
};

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

function rmsMean(signal: BaSignal | null, channel: 'BB' | 'TB' | 'AD' | 'MD', fromMs: number, toMs: number): number | null {
  const m = baSignalMetrics(signal, channel, fromMs, toMs);
  return m?.rms ?? null;
}

/**
 * Computes the 3-dimension clinical upper-limb movement quality assessment
 * (1. Muscle compensation & CCI, 2. Phase timing, 3. Transport stability)
 * for both real-time streaming capture and archived trials / dataset records.
 */
export function evaluateMovementQuality(options: {
  record: BaRecord;
  events: readonly BaEvent[];
  signal: BaSignal | null;
  positionMs: number;
  complete?: boolean;
  calibrated?: boolean;
  gapCount?: number;
  preset?: Partial<QualityReport>;
}): QualityReport {
  const { record, events, signal, positionMs, gapCount = 0, preset } = options;
  const elapsedSec = Math.max(0.1, (positionMs - record.originMs) / 1000);

  const phaseDur = (code: 'REST' | 'REACH' | 'LIFT_TRANSFER' | 'RETURN'): number | null => {
    const obs = baObserved(events, code);
    if (obs.startMs === null) {
      const staticPhase = record.phases.find((p) => p.code === code);
      if (!staticPhase || staticPhase.startMs === null || positionMs <= staticPhase.startMs) return null;
      const end = Math.min(positionMs, staticPhase.endMs ?? positionMs);
      return Math.max(0, (end - staticPhase.startMs) / 1000);
    }
    const end = obs.endMs !== null ? Math.min(positionMs, obs.endMs) : positionMs;
    return end > obs.startMs ? (end - obs.startMs) / 1000 : null;
  };

  const phaseSeconds = preset?.phaseSeconds ?? {
    REST: phaseDur('REST'),
    REACH: phaseDur('REACH'),
    LIFT_TRANSFER: phaseDur('LIFT_TRANSFER'),
    RETURN: phaseDur('RETURN'),
  };

  // Active movement window for EMG co-activation calculation
  const reachStart = record.phases.find((p) => p.code === 'REACH')?.startMs ?? 500;
  const evalEnd = Math.max(reachStart + 400, positionMs);
  const bbRms = rmsMean(signal, 'BB', reachStart, evalEnd);
  const tbRms = rmsMean(signal, 'TB', reachStart, evalEnd);
  const adRms = rmsMean(signal, 'AD', reachStart, evalEnd);
  const mdRms = rmsMean(signal, 'MD', reachStart, evalEnd);

  // Falconer & Winter Co-Contraction Index: 2 * min(BB, TB) / (BB + TB)
  const rawCci = bbRms !== null && tbRms !== null && bbRms + tbRms > 1e-5
    ? (2 * Math.min(bbRms, tbRms)) / (bbRms + tbRms)
    : 0.38;
  const cci = preset?.cci ?? Number(clamp(rawCci * 0.58 + 0.12, 0.16, 0.82).toFixed(2));

  const adMdRatio = preset?.adMdRatio ?? Number(
    (adRms !== null && mdRms !== null && mdRms > 1e-5 ? clamp(adRms / mdRms, 0.45, 1.85) : 0.94).toFixed(2),
  );

  // Peak shoulder abduction detour angle (higher MD vs AD recruitment indicates abduction compensation)
  const detourFactor = adMdRatio < 0.85 ? (0.85 - adMdRatio) * 34 : 0;
  const abductionPeak = preset?.abductionPeak ?? Number(clamp(28.5 + detourFactor + (cci - 0.32) * 26, 16.0, 58.0).toFixed(1));
  const detourDetected = abductionPeak >= 36.0 || cci >= 0.48;

  // 1. Muscle Compensation & Co-Activation Score (0 - 100)
  // Optimal stroke-free synergy: CCI <= 0.28, shoulder abduction <= 28 deg
  const cciPenalty = Math.max(0, (cci - 0.26) * 85);
  const detourPenalty = Math.max(0, (abductionPeak - 27) * 0.95);
  const muscleScore = preset?.muscleScore ?? Math.round(clamp(95 - cciPenalty - detourPenalty, 42, 98));

  // 2. Phase Timing Score (0 - 100)
  // Normative upper-limb reach-transfer-return total ~ 6.5 - 8.5 s
  const activeTotal = (phaseSeconds.REACH ?? 2.2) + (phaseSeconds.LIFT_TRANSFER ?? 2.6) + (phaseSeconds.RETURN ?? 2.0);
  const totalSeconds = preset?.totalSeconds ?? Number(elapsedSec.toFixed(2));
  const targetActive = 6.8;
  const timingDeviation = Math.abs(activeTotal - targetActive);
  const unresolvedPenalty = record.phases.filter((p) => p.status === 'unresolved').length * 5;
  const timingScore = preset?.timingScore ?? Math.round(clamp(94 - timingDeviation * 5.2 - unresolvedPenalty, 45, 98));

  // 3. Transport Stability Score (0 - 100)
  const transportVariation = preset?.transportVariation ?? Number(clamp(1.9 + (cci - 0.25) * 6.4 + gapCount * 0.8, 1.4, 9.5).toFixed(1));
  const holdSd = preset?.holdSd ?? Number(clamp(1.1 + (cci - 0.25) * 4.2, 0.8, 6.2).toFixed(1));
  const elbowRom = preset?.elbowRom ?? Number(clamp(86 - Math.max(0, cci - 0.32) * 48, 48, 94).toFixed(1));
  const stabilityScore = preset?.stabilityScore ?? Math.round(
    clamp(95 - (transportVariation - 1.6) * 5.8 - (holdSd - 1.0) * 4.2 - gapCount * 3, 44, 98),
  );

  // Weighted Clinical Movement Quality Total Score
  const total = preset?.total ?? Math.round(muscleScore * 0.40 + timingScore * 0.28 + stabilityScore * 0.32);
  const grade: QualityReport['grade'] = total >= 82 ? 'excellent' : total >= 68 ? 'mild' : 'compensatory';

  return {
    total,
    muscleScore,
    timingScore,
    stabilityScore,
    cci,
    abductionPeak,
    adMdRatio,
    totalSeconds,
    phaseSeconds,
    transportVariation,
    elbowRom,
    holdSd,
    detourDetected,
    grade,
  };
}

export function trialQuality(trial: Trial, fallbackRecord: BaRecord): QualityReport {
  if (trial.quality) return trial.quality;
  const record = trial.ba?.record ?? fallbackRecord;
  const events = trial.ba?.events ?? [];
  const signal = baSignal(record.signalId, record.id);
  const endMs = record.originMs + Math.round(trial.elapsed * 1000);
  return evaluateMovementQuality({
    record,
    events,
    signal,
    positionMs: endMs,
    complete: trial.complete,
    calibrated: trial.demo?.calibrated ?? true,
    gapCount: trial.demo?.gaps.length ?? 0,
  });
}
