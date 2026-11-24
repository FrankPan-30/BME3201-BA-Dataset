"""Run the complete BA inventory, annotate phases, and generate offline playback."""
import argparse
import csv
import json
from collections import Counter
from itertools import pairwise
from pathlib import Path

import numpy as np

from read_ba import (EMG_CHANNELS, EMG_HZ, KIN_HZ, RATIO, ROOT,
                     read_ba, reach_window, sample_slice)
from segment_ba import PHASES, annotate, features

EXAMPLE = "ST09-BA-paretic-01"
EXPECTED = {"dominant": 50, "paretic": 50, "nonparetic": 49}


def write_csv(path, rows):
    with path.open("w", newline="", encoding="utf-8") as stream:
        writer = csv.DictWriter(stream, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)


def verify_clocks(record, trial, phases):
    # Two independent nominal clocks. Use integer ticks for the boundary
    # lookup so that decimal rounding never adds/drops a sample.
    kin = (np.arange(len(record.kin_time)) + 1 - trial["events_start_frame"]) * RATIO
    emg = np.arange(len(record.emg_time)) - (trial["events_start_frame"] - 1) * RATIO
    author_start, author_end = trial["events_start_frame"], trial["events_end_frame"]
    sample_slice(record, author_start, author_end, "kin")
    sample_slice(record, author_start, author_end, "emg")
    known = []
    for row in phases:
        left, right = row["start_kin_frame"], row["end_kin_frame"]
        if left is None or right is None:
            continue
        known.append((left, right))
        lo = (left - author_start) * RATIO
        hi = (right - author_start) * RATIO
        for time in kin, emg:
            assert time[0] <= lo and hi <= time[-1] + (time[1] - time[0])
        k, e = [sample_slice(record, left, right, source) for source in ("kin", "emg")]
        assert (k.start, k.stop) == tuple(np.searchsorted(kin, [lo, hi]))
        assert (e.start, e.stop) == tuple(np.searchsorted(emg, [lo, hi]))
        assert np.array_equal(kin[k], emg[e][::RATIO])
        assert (int(round(float(row["start_s"]) * EMG_HZ)),
                int(round(float(row["end_s"]) * EMG_HZ))) == (lo, hi)
    assert all(b[0] >= a[1] for a, b in pairwise(known))
    reach = reach_window(record, trial["trial_id"], phases)
    if reach is None:
        return None
    frames, k, e = reach
    muscle_rows = [record.emg_names.index(name) for name in EMG_CHANNELS.values()]
    muscles = record.emg[muscle_rows, e]
    elbow = record.angles[record.angle_names.index("ElbowFlx"), k]
    assert muscles.shape == (4, len(elbow) * RATIO)
    assert kin[k][0] == emg[e][0] and k.stop * RATIO == e.stop
    return {
        "trial_id": trial["trial_id"],
        "reach_start_kin_frame": frames[0], "reach_end_kin_frame": frames[1],
        "emg_start_index_0": e.start, "emg_stop_index_0": e.stop,
        "kin_start_index_0": k.start, "kin_stop_index_0": k.stop,
        "emg_samples_per_channel": muscles.shape[1], "elbow_samples": len(elbow),
        "same_half_open_time_window": True,
    }


def json_samples(array):
    data = array.astype(object)
    data[~np.isfinite(array)] = None
    return data.tolist()


def replay_payload(record, signals, trial, phases):
    left = phases[0]["start_kin_frame"] or trial["events_start_frame"]
    right = trial["events_end_frame"]
    k = sample_slice(record, left, right, "kin")
    e = sample_slice(record, left, right, "emg")
    origin = (trial["events_start_frame"] - 1) / KIN_HZ
    return {
        "id": trial["trial_id"], "side": trial["arm_side"],
        "duration": float(trial["duration_s"]),
        "kinHz": KIN_HZ, "emgHz": EMG_HZ,
        "kinT0": round(record.kin_time[k.start] - origin, 3),
        "emgT0": round(record.emg_time[e.start] - origin, 3),
        "hand": json_samples(signals["hand"][k]),
        "ball": json_samples(signals["ball"][k]),
        "emg": {name: json_samples(record.emg[record.emg_names.index(channel), e])
                for name, channel in EMG_CHANNELS.items()},
        "phases": phases,
    }


def run(repo, out, example):
    paths = sorted((repo / "emg_dataset").glob("*.mat"))
    subjects = {f"{group}{number:02d}" for group in ("HS", "ST") for number in range(1, 11)}
    if {p.stem for p in paths} != subjects or sum(p.stat().st_size for p in paths) != 761922208:
        raise ValueError("Expected the 20 input MAT files from the pinned raw release")
    trials, intervals, inventory, alignment = [], [], [], []
    payload = None
    for path in paths:
        for record in read_ba(path):
            signals = features(record)
            for prefix in ("ULNA_", "RADIUS_", "MIDFORE_", "ELBOW_", "Meta2_"):
                assert [name for name in record.marker_names if name.startswith(prefix)] == [prefix + record.side]
            assert all(record.emg_names.count(channel) == 1 for channel in EMG_CHANNELS.values())
            nk, ne = record.marker.shape[1], record.emg.shape[1]
            inventory.append({
                "record_id": record.record_id, "subject": record.subject,
                "group": record.group, "arm_side": record.side, "arm_role": record.role,
                "side_basis": {"dominant": "s.DomSide", "paretic": "s.HemiSide",
                               "nonparetic": "opposite_of_s.HemiSide"}[record.role],
                "task_code": "BA", "mat_task_index": record.task_index,
                "raw_relpath": record.raw_relpath, "mat_arm_field": record.field,
                "raw_bytes": path.stat().st_size, "events_n": len(record.starts),
                "marker_names": "|".join(record.marker_names),
                "emg_names": "|".join(record.emg_names),
                "angle_names": "|".join(record.angle_names),
                "kin_hz": KIN_HZ, "emg_hz": EMG_HZ, "kin_samples": nk, "emg_samples": ne,
                "emg_samples_minus_8x_kin_samples": ne - RATIO * nk,
                "emg_endpoint_minus_kin_endpoint_s": f"{(ne - 1 - RATIO * (nk - 1)) / EMG_HZ:.3f}",
                "alignment_basis": "nominal_rates_common_first_sample",
            })
            for index, trial_id in enumerate(record.trial_ids):
                start, end = int(record.starts[index]), int(record.ends[index])
                trial = {
                    "trial_id": trial_id, "record_id": record.record_id,
                    "subject": record.subject, "group": record.group, "task_code": "BA",
                    "arm_side": record.side, "arm_role": record.role, "repeat_no": index + 1,
                    "raw_relpath": record.raw_relpath, "mat_arm_field": record.field,
                    "events_start_frame": start, "events_end_frame": end,
                    "duration_s": f"{(end - start) / KIN_HZ:.3f}",
                }
                rows = list(annotate(record, signals, index))
                assert tuple(row["phase"] for row in rows) == PHASES
                audit = verify_clocks(record, trial, rows)
                trials.append(trial)
                intervals.extend(rows)
                if audit is not None:
                    alignment.append(audit)
                if trial_id == example:
                    payload = replay_payload(record, signals, trial, rows)
    if len(inventory) != 30 or len({t["trial_id"] for t in trials}) != 149:
        raise ValueError("BA record/trial count does not match the pinned release")
    if Counter(t["arm_role"] for t in trials) != EXPECTED:
        raise ValueError("BA counts per arm role do not match")
    if payload is None:
        raise ValueError(f"Unknown replay trial: {example}")
    out.mkdir(parents=True, exist_ok=True)
    write_csv(out / "trials.csv", trials)
    write_csv(out / "phase_intervals.csv", intervals)
    write_csv(out / "record_inventory.csv", inventory)
    write_csv(out / "reach_alignment.csv", alignment)
    template = Path(__file__).with_name("replay_template.html").read_text(encoding="utf-8")
    data = json.dumps(payload, separators=(",", ":"), allow_nan=False).replace("<", "\\u003c")
    (out / "replay.html").write_text(template.replace("__REPLAY_DATA__", data), encoding="utf-8")
    status = Counter(row["boundary_status"] for row in intervals)
    print(f"{len(paths)} MAT files, {len(inventory)} records, {len(trials)} trials, "
          f"{len(intervals)} phases, {len(alignment)} checked REACH windows")
    print(dict(status))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", type=Path, default=ROOT)
    parser.add_argument("--out", type=Path, default=ROOT / "ba_output")
    parser.add_argument("--replay-trial", default=EXAMPLE)
    args = parser.parse_args()
    run(args.repo, args.out, args.replay_trial)
