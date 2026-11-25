"""Read and align the public Figshare v1 BA trials for offline model training."""

from collections import Counter
from dataclasses import dataclass
from pathlib import Path
import re
import struct
import warnings

import numpy as np
from scipy.io import loadmat
from scipy.ndimage import uniform_filter1d
from scipy.signal import butter, sosfiltfilt


TRAIN_HZ = 50
EMG_CHANNELS = ("BB", "TB", "AD", "MD", "FCR", "ECR")
SOURCE_EMG_CHANNELS = ("BICEP", "TRICP", "DELANT", "DELML", "FLXCRR", "EXTCRR")
TORSO_AXES = ("tested_side", "forward", "up")
COMMON_CHANNELS = (
    *(f"upper_arm_{axis}" for axis in TORSO_AXES),
    *(f"forearm_{axis}" for axis in TORSO_AXES),
    "elbow_flexion_rad",
)
OPTICAL_CHANNELS = (
    *COMMON_CHANNELS,
    *(f"wrist_position_{axis}_m" for axis in TORSO_AXES),
    *(f"wrist_velocity_{axis}_m_s" for axis in TORSO_AXES),
    *(f"hand_direction_{axis}" for axis in TORSO_AXES),
)
ARM_GROUPS = {"DataULdom": "healthy", "DataULpleg": "affected", "DataULnonpleg": "nonaffected"}
METADATA_KEYS = ("TaskCode", "MarkerVarName", "EmgVarName", "AngleVarName")


@dataclass(frozen=True)
class Trial:
    id: str
    subject: str
    group: str
    emg: np.ndarray
    optical: np.ndarray
    common: np.ndarray
    metrics: dict[str, float]


def _string_arrays(workspace):
    """Recover the serialized MATLAB strings used in these public v1 files."""
    raw = workspace.tobytes()
    arrays = []
    for offset in range(8, len(raw) - 40, 8):
        tag, size = struct.unpack_from("<II", raw, offset)
        if tag != 13 or size < 40 or size % 8 or offset + 8 + size > len(raw):
            continue
        words = struct.unpack_from(f"<{size // 8}Q", raw, offset + 8)
        if words[:2] != (1, 2):
            continue
        count = words[2] * words[3]
        if not 1 <= count <= 64 or len(words) < 4 + count:
            continue
        lengths = words[4:4 + count]
        if 2 * sum(lengths) > size - 8 * (4 + count):
            continue
        position = offset + 8 * (5 + count)
        strings = []
        for length in lengths:
            end = position + 2 * length
            strings.append(raw[position:end].decode("utf-16le", errors="replace").rstrip("\x00 "))
            position = end
        if all(re.fullmatch(r"[A-Za-z0-9_]+", item) for item in strings):
            arrays.append(tuple(strings))
    return arrays


def _runs(mask):
    edges = np.flatnonzero(np.diff(np.r_[False, mask, False]))
    return zip(edges[::2], edges[1::2])


def _fill_short_gaps(values, limit):
    cleaned = np.asarray(values, dtype=np.float64).copy()
    cleaned[~np.isfinite(cleaned)] = np.nan
    for channel in cleaned.T:
        for lo, hi in _runs(np.isnan(channel)):
            if hi - lo <= limit and lo > 0 and hi < len(channel):
                channel[lo:hi] = np.linspace(channel[lo - 1], channel[hi], hi - lo + 2)[1:-1]
    return cleaned


def _filter_observed(values, sos):
    if np.isfinite(values).all():
        return sosfiltfilt(sos, values, axis=0)
    output = np.full_like(values, np.nan)
    for index, channel in enumerate(values.T):
        for lo, hi in _runs(np.isfinite(channel)):
            if hi - lo > 3 * (2 * len(sos) + 1):
                output[lo:hi, index] = sosfiltfilt(sos, channel[lo:hi])
    return output


def _envelope(emg, hz):
    emg = _fill_short_gaps(emg, limit=round(0.020 * hz))
    filtered = _filter_observed(emg, butter(4, (20, 450), btype="bandpass", fs=hz, output="sos"))
    squared = np.square(filtered)
    valid = np.isfinite(squared)
    size = round(0.050 * hz)
    average = uniform_filter1d(np.where(valid, squared, 0), size, axis=0, mode="nearest")
    fully_observed = uniform_filter1d(valid.astype(float), size, axis=0, mode="nearest") > 1 - 1e-8
    rms = np.where(fully_observed, np.sqrt(np.maximum(average, 0)), np.nan)
    return _filter_observed(rms, butter(4, 20, fs=hz, output="sos"))


def _unit(vector):
    length = np.linalg.norm(vector, axis=1, keepdims=True)
    return vector / np.where(length > 1e-6, length, np.nan)


def _motion_features(marker, side, hz):
    right = _unit(marker("SHOULDER_RX") - marker("SHOULDER_LX"))
    anterior = marker("MANUBRIUM") - marker("C7")
    forward = _unit(anterior - np.sum(anterior * right, axis=1, keepdims=True) * right)
    up = _unit(np.cross(right, forward))
    lateral = right if side == "RX" else -right
    torso_frame = np.stack((lateral, forward, up), axis=-1)

    def in_torso_frame(vector):
        return np.einsum("ti,tij->tj", vector, torso_frame)

    shoulder = marker(f"SHOULDER_{side}")
    elbow = marker(f"ELBOW_{side}")
    wrist = (marker(f"ULNA_{side}") + marker(f"RADIUS_{side}")) / 2
    upper_arm = _unit(elbow - shoulder)
    forearm = _unit(wrist - elbow)
    flexion = np.arccos(np.clip(np.sum(upper_arm * forearm, axis=1), -1, 1))
    common = np.column_stack((in_torso_frame(upper_arm), in_torso_frame(forearm), flexion))

    relative_wrist = in_torso_frame(wrist - shoulder)
    wrist_velocity = np.gradient(relative_wrist, 1 / hz, axis=0)
    hand = in_torso_frame(_unit(marker(f"Meta2_{side}") - wrist))
    optical = np.column_stack((common, relative_wrist, wrist_velocity, hand))
    return optical, wrist


def _on_grid(values, times, hz):
    source_times = np.arange(len(values)) / hz
    sampled = np.column_stack([
        np.interp(times, source_times, channel, left=np.nan, right=np.nan)
        for channel in values.T
    ])
    return sampled.astype(np.float32)


def _extract_block(name, subject, arm, task, marker_names, emg_names):
    kin_hz = int(subject["KinFreq"])
    emg_hz = int(subject["EmgFreq"])
    if (kin_hz, emg_hz) != (125, 1000):
        raise ValueError(f"Unexpected sampling rates for {name}/{arm}: {kin_hz}, {emg_hz}")
    group = ARM_GROUPS[arm]
    side = subject["DomSide"] if group == "healthy" else subject["HemiSide"]
    if group == "nonaffected":
        side = {"RX": "LX", "LX": "RX"}[side]

    raw_marker = task["Marker"].T
    raw_emg = task["EMG"]
    if raw_marker.shape[1] != 3 * len(marker_names) or raw_emg.shape[0] != len(emg_names):
        raise ValueError(f"MAT signal shape does not match channel names for {name}/{arm}")
    duration_difference = abs(len(raw_marker) / kin_hz - raw_emg.shape[1] / emg_hz)
    if duration_difference > 0.15:
        raise ValueError(f"Record lengths differ by {duration_difference:.3f}s for {name}/{arm}")

    marker_positions = _fill_short_gaps(raw_marker / 1000, limit=round(0.080 * kin_hz))
    marker_positions = _filter_observed(marker_positions, butter(4, 6, fs=kin_hz, output="sos"))
    marker_positions = marker_positions.reshape(len(raw_marker), len(marker_names), 3)

    def marker(channel):
        return marker_positions[:, marker_names.index(channel), :]

    optical, wrist = _motion_features(marker, side, kin_hz)
    envelope = _envelope(raw_emg[[emg_names.index(label) for label in SOURCE_EMG_CHANNELS]].T, emg_hz)
    starts = np.atleast_1d(task["Events"]["Start"]).astype(int) - 1
    ends = np.atleast_1d(task["Events"]["End"]).astype(int) - 1
    previous_end = -1
    for repetition, (start, end) in enumerate(zip(starts, ends, strict=True), 1):
        if not previous_end < start < end < len(optical):
            raise ValueError(f"Invalid published event for {name}/{arm}/{repetition}")
        previous_end = end
        trial_id = f"{name}_{group}_{side}_{repetition:02d}"
        duration = (end - start) / kin_hz
        grid = start / kin_hz + np.arange(1 + (end - start) * TRAIN_HZ // kin_hz) / TRAIN_HZ
        # Use a nominal common t=0, with no duration matching or clock stretching.
        emg_trial = _on_grid(envelope, grid, emg_hz)
        optical_trial = _on_grid(optical, grid, kin_hz)
        if not np.isfinite(emg_trial).all() or not np.isfinite(optical_trial).all():
            yield trial_id, None
            continue
        wrist_trial = _on_grid(wrist, grid, kin_hz)
        path = np.linalg.norm(np.diff(wrist_trial, axis=0), axis=1).sum()
        excursion = np.linalg.norm(wrist_trial - wrist_trial[0], axis=1).max()
        lateral_deg = np.degrees(np.arcsin(np.clip(optical_trial[:, 0], -1, 1)))
        metrics = {
            "duration_s": float(duration),
            "wrist_path_length_m": float(path),
            "wrist_peak_excursion_m": float(excursion),
            "upper_arm_lateral_change_deg": float(np.percentile(lateral_deg, 95) - lateral_deg[0]),
        }
        yield trial_id, Trial(
            trial_id, name, group, emg_trial, optical_trial,
            optical_trial[:, :len(COMMON_CHANNELS)].copy(), metrics,
        )


def load_trials(data_dir: Path) -> list[Trial]:
    """Extract all finite BA trials, using published full-trial bounds and named channels."""
    sources = [p for p in sorted(Path(data_dir).glob("*.mat")) if re.fullmatch(r"(HS|ST)(0[1-9]|10)", p.stem)]
    if not sources:
        raise FileNotFoundError(f"No Figshare v1 subject MAT files found in {data_dir}")
    trials = []
    excluded = []
    for source in sources:
        mat = loadmat(source, simplify_cells=True)
        subject = mat["s"]
        # The original MATLAB workspace follows the original struct's field order.
        blocks = [(arm, task) for arm in subject if arm in ARM_GROUPS for task in subject[arm]]
        arrays = _string_arrays(mat["__function_workspace__"])
        references = [int(task[key]["arr"][0][4]) for _, task in blocks for key in METADATA_KEYS]
        if references != list(range(1, len(arrays) + 1)):
            raise ValueError(f"Cannot verify serialized MATLAB channel names in {source.name}")
        selected_arms = Counter()
        for index, (arm, task) in enumerate(blocks):
            task_code, marker_names, emg_names, _ = arrays[4 * index:4 * index + 4]
            if task_code != ("BA",):
                continue
            selected_arms[arm] += 1
            for trial_id, trial in _extract_block(source.stem, subject, arm, task, marker_names, emg_names):
                if trial is None:
                    excluded.append(trial_id)
                else:
                    trials.append(trial)
        if selected_arms != Counter({arm: 1 for arm in ARM_GROUPS if arm in subject}):
            raise ValueError(f"Expected one published BA record per tested arm in {source.name}")
    if excluded:
        warnings.warn(f"Excluded {len(excluded)} BA trials with nonfinite aligned samples: {', '.join(excluded)}", stacklevel=2)
    if not trials:
        raise ValueError(f"No usable BA trials found in {data_dir}")
    return trials
