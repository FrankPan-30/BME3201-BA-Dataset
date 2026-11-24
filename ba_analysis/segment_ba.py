"""Generate candidate BA phase intervals without altering the original signals."""
from dataclasses import dataclass, field

import numpy as np
from numpy.lib.stride_tricks import sliding_window_view

from read_ba import EMG_CHANNELS, KIN_HZ, sample_slice

VERSION = "ba-kinematic-v1.0"
REST_SEARCH = 63
REST_MIN = 25
ONSET_HOLD = 13
PLACE_HOLD = 25
RETURN_HORIZON = 25
HEIGHT = 1  # stored laboratory Y is up
PHASES = ("REST", "REACH", "LIFT_TRANSFER", "RETURN")


def norm(values):
    return np.linalg.norm(values, axis=-1)


def compact(trace, diameter):
    return np.isfinite(trace).all() and norm(np.ptp(trace, axis=0)) <= diameter


def first_run(mask, count):
    if len(mask) >= count:
        matches = np.flatnonzero(sliding_window_view(mask, count).all(axis=1))
        if matches.size:
            return int(matches[0])
    return None


def features(record):
    side = record.side
    ulna = record.xyz(f"ULNA_{side}")
    radius = record.xyz(f"RADIUS_{side}")
    return {
        "wrist": (ulna + radius) / 2,
        "hand": record.xyz(f"Meta2_{side}"),
        "ball": record.xyz("OBJECT"),
        "elbow_flex": record.angles[record.angle_names.index("ElbowFlx")],
    }


@dataclass
class Boundary:
    i: int | None
    source: str
    warnings: list[str] = field(default_factory=list)


def rest_bounds(ball, wrist, lower, start):
    for right in range(start, lower + REST_MIN - 1, -1):
        left = right - REST_MIN
        if compact(ball[left:right], 5) and compact(wrist[left:right], 10):
            while (left > lower and compact(ball[left - 1:right], 5)
                   and compact(wrist[left - 1:right], 10)):
                left -= 1
            return left, right
    return None, None


def ball_onset(ball, lower, start, end):
    source = "ball_rise_15mm_8mm_104ms"
    warnings = []
    for stop in range(start, lower + ONSET_HOLD - 1, -1):
        segment = ball[stop - ONSET_HOLD:stop]
        if compact(segment, 5):
            break
    else:
        # A stable ball within the first 0.2 s can supply a reference,
        # but cannot show what happened during the pre-event period.
        stop = min(start + 2 * ONSET_HOLD, end)
        segment = ball[start:stop]
        if len(segment) < ONSET_HOLD or not compact(segment, 5):
            return Boundary(None, "no_stable_initial_ball"), None
        warnings.append("baseline_from_after_events_start")
    if stop < start - ONSET_HOLD:
        warnings.append("initial_ball_reference_ends_early")
    baseline = np.median(segment, axis=0)
    displacement = ball[start:end] - baseline
    candidate = first_run((norm(displacement) >= 15) & (displacement[:, HEIGHT] >= 8), ONSET_HOLD)
    if candidate is None or candidate == 0:
        reason = "ball_already_moving_at_events_start" if candidate == 0 else "no_sustained_ball_rise"
        return Boundary(None, reason), baseline
    i = start + candidate
    if candidate < ONSET_HOLD:
        warnings.append("reach_shorter_than_104ms")
    if not np.isfinite(ball[start:i + ONSET_HOLD]).all():
        warnings.append("missing_ball_before_detected_lift")
    return Boundary(i, source, warnings), baseline


def placement(ball, motion, end, baseline):
    if motion.i is None:
        return Boundary(None, "no_ball_lift_boundary")
    # Anchor to the latest stationary elevated segment in the latter half.
    lower = (motion.i + end) // 2
    for stop in range(end, lower + PLACE_HOLD - 1, -1):
        segment = ball[stop - PLACE_HOLD:stop]
        if compact(segment, 12) and np.min(segment[:, HEIGHT]) >= baseline[HEIGHT] + 150:
            break
    else:
        return Boundary(None, "no_stable_elevated_ball")
    target = np.median(segment, axis=0)
    near = norm(ball[motion.i:stop] - target) <= 12
    first = first_run(near, PLACE_HOLD)
    while first is not None:
        i = motion.i + first
        steady = compact(ball[i:i + PLACE_HOLD], 10)
        # Require the ball to remain near the destination after the initial dwell.
        valid = np.isfinite(ball[i:stop]).all(axis=1)
        staying = near[first:]
        if steady and np.mean(staying[valid]) >= 0.95:
            warnings = []
            later = ball[i:end]
            if not np.isfinite(later).all():
                warnings.append("ball_tracking_gap_after_placement")
            if first_run(norm(later - target) > 20, ONSET_HOLD) is not None:
                warnings.append("ball_moves_again_after_placement")
            if stop < end - PLACE_HOLD and not warnings:
                warnings.append("elevated_ball_evidence_ends_early")
            return Boundary(i, "final_elevated_ball_200ms", warnings)
        after = first_run(near[first + 1:], PLACE_HOLD)
        first = None if after is None else first + 1 + after
    return Boundary(None, "no_sustained_placement")


def withdrawal(ball, hand, wrist, placed, rest, start, end):
    if placed.i is None:
        return Boundary(None, "no_placement_boundary")
    left, right = rest
    warnings = []
    if left is None:
        left, right = start - 1, start + 2
        if left < 0 or not compact(wrist[left:right], 10):
            return Boundary(None, "no_wrist_home_reference")
        warnings.append("home_from_events_start_neighborhood")
    home = np.median(wrist[left:right], axis=0)
    hand_ball = norm(hand - ball)
    wrist_home = norm(wrist - home)
    for i in range(placed.i, end - RETURN_HORIZON):
        j = i + RETURN_HORIZON
        hb = hand_ball[i:j + 1]
        wh = wrist_home[i:j + 1]
        if not (np.isfinite(hb).all() and np.isfinite(wh).all() and compact(ball[i:j + 1], 15)):
            continue
        if (hb[-1] - hb[0] >= 20 and wh[0] - wh[-1] >= 15
                and np.mean(np.diff(hb) >= -0.5) >= 0.8
                and np.mean(np.diff(wh) <= 0.5) >= 0.8
                and hb[5] - hb[0] >= 1 and wh[0] - wh[5] >= 1):
            if not (np.isfinite(wrist[placed.i:i + 1]).all()
                    and np.isfinite(hand[placed.i:i + 1]).all()
                    and np.isfinite(ball[placed.i:i + 1]).all()):
                warnings.append("tracking_gap_before_detected_return")
            return Boundary(i, "hand_away_wrist_home_200ms", warnings)
    tracking = (np.isfinite(ball[placed.i:end]).all()
                and np.isfinite(hand[placed.i:end]).all()
                and np.isfinite(wrist[placed.i:end]).all())
    warnings = [] if tracking else ["tracking_gap_during_return_search"]
    return Boundary(None, "no_sustained_hand_away_and_wrist_home", warnings)


def emg_quality(record, left, right):
    try:
        window = sample_slice(record, left, right, "emg")
    except ValueError:
        return "fail", ["emg_out_of_bounds"]
    flags = []
    for label, name in EMG_CHANNELS.items():
        values = record.emg[record.emg_names.index(name), window]
        if not np.isfinite(values).all():
            flags.append(f"emg_nonfinite_{label}")
        if (len(values) > 1 and (np.ptp(values) == 0
                                or first_run(np.diff(values) == 0, 99) is not None)):
            flags.append(f"emg_flatline_{label}")
    return ("fail" if flags else "pass"), flags


def kin_quality(record, signals, left, right, phase):
    try:
        window = sample_slice(record, left, right, "kin")
    except ValueError:
        return "fail", ["kin_out_of_bounds"]
    core = ["wrist", "ball", "elbow_flex"]
    if phase in ("LIFT_TRANSFER", "RETURN"):
        core.append("hand")
    flags = []
    missing = False
    for name in core:
        values = signals[name][window]
        if len(values) != window.stop - window.start or not np.isfinite(values).all():
            flags.append(f"kin_nonfinite_{name}")
            missing = True
        step = np.diff(values, axis=0)
        if name == "elbow_flex":
            discontinuous = np.any(np.abs(step) > 15)
        else:
            discontinuous = np.any(norm(step) > 35)
        if discontinuous:
            flags.append(f"kin_jump_{name}")
    return ("fail" if missing else "review" if flags else "pass"), flags


def annotate(record, signals, repeat_index):
    start = int(record.starts[repeat_index]) - 1
    end = int(record.ends[repeat_index]) - 1
    previous_end = int(record.ends[repeat_index - 1]) - 1 if repeat_index else 0
    lower = max(previous_end, start - REST_SEARCH)
    ball, wrist, hand = (signals[key] for key in ("ball", "wrist", "hand"))
    rest = rest_bounds(ball, wrist, lower, start)
    motion, baseline = ball_onset(ball, lower, start, end)
    placed = placement(ball, motion, end, baseline)
    returned = withdrawal(ball, hand, wrist, placed, rest, start, end)
    rest_source = "pre_event_quiet_wrist_and_ball" if rest[0] is not None else "no_quiet_window"
    bounds = {
        "REST": (Boundary(rest[0], rest_source), Boundary(rest[1], rest_source)),
        "REACH": (Boundary(start, "Events.Start"), motion),
        "LIFT_TRANSFER": (motion, placed),
        "RETURN": (returned, Boundary(end, "Events.End")),
    }
    for phase, (a, b) in bounds.items():
        known = a.i is not None and b.i is not None
        warnings = list(dict.fromkeys(a.warnings + b.warnings))
        if known and b.i <= a.i:
            b = Boundary(None, "boundary_order_conflict")
            known = False
        if known:
            emg, emg_flags = emg_quality(record, a.i + 1, b.i + 1)
            kin, kin_flags = kin_quality(record, signals, a.i + 1, b.i + 1, phase)
        else:
            emg = kin = "not_evaluated"
            emg_flags, kin_flags = [], []
        reasons = [x.source for x in (a, b) if x.i is None]
        yield {
            "trial_id": record.trial_ids[repeat_index], "phase": phase,
            "start_kin_frame": None if a.i is None else a.i + 1,
            "end_kin_frame": None if b.i is None else b.i + 1,
            "start_s": None if a.i is None else f"{(a.i - start) / KIN_HZ:.3f}",
            "end_s": None if b.i is None else f"{(b.i - start) / KIN_HZ:.3f}",
            "duration_s": f"{(b.i - a.i) / KIN_HZ:.3f}" if known else None,
            "start_boundary_source": a.source, "end_boundary_source": b.source,
            "boundary_status": ("unresolved" if not known else "review" if warnings else "auto"),
            "emg_qc": emg, "kin_qc": kin,
            "artifact_flags": "|".join(emg_flags + kin_flags),
            "method_version": VERSION,
            "notes": "|".join(dict.fromkeys(reasons + warnings)),
        }
