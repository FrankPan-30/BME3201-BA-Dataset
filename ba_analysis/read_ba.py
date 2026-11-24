"""Read the BA task and provide its canonical half-open window on both clocks."""
import io
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from scipy.io import loadmat
from scipy.io.matlab import MatlabOpaque
from scipy.io.matlab._mio5 import MatFile5Reader

KIN_HZ = 125
EMG_HZ = 1000
RATIO = EMG_HZ // KIN_HZ
ROOT = Path(__file__).resolve().parents[1]
ARMS = {
    "DataULdom": ("healthy", "dominant"),
    "DataULpleg": ("stroke", "paretic"),
    "DataULnonpleg": ("stroke", "nonparetic"),
}


class MatlabStrings:
    """Resolve MATLAB v5 MCOS string references in this release's FileWrapper."""

    def __init__(self, mat):
        self.properties = None
        self.objects = None
        self.saved = None
        self.mat = mat

    def _load_wrapper(self):
        workspace = self.mat["__function_workspace__"].tobytes()
        if workspace[:8] != b"\x00\x01IM\x00\x00\x00\x00":
            raise ValueError("Unsupported MAT function-workspace header")
        header = self.mat["__header__"].ljust(116, b" ") + bytes(8) + workspace[:4]
        stream = io.BytesIO(header + workspace[8:])
        reader = MatFile5Reader(stream, squeeze_me=True, struct_as_record=False)
        reader.initialize_read()
        reader.read_file_header()
        tag, _ = reader.read_var_header()
        wrapper = reader.read_var_array(tag, True).MCOS[0]
        if (wrapper["s1"], wrapper["s2"]) != (b"MCOS", b"FileWrapper__"):
            raise ValueError("Unexpected MCOS workspace object")
        self.properties = wrapper["arr"]
        metadata = np.frombuffer(self.properties[0].tobytes(), dtype="<u4")
        if metadata[0] != 4 or metadata[2] < 40:
            raise ValueError("Unsupported MCOS metadata")
        # The object table contains four words per object, including class and
        # a zero-based saved-property record. The latter has a leading sentinel.
        self.objects = metadata[metadata[3] // 4 + 2:metadata[4] // 4].reshape(-1, 4)
        self.saved = metadata[metadata[4] // 4:metadata[5] // 4].reshape(-1, 6)

    def decode(self, value):
        if not isinstance(value, MatlabOpaque):
            return [str(x) for x in np.asarray(value).ravel(order="F")]
        if self.properties is None:
            self._load_wrapper()
        ref = value[0]
        if (ref["s1"], ref["s2"]) != (b"MCOS", b"string"):
            raise ValueError("Expected a MATLAB string")
        magic, ndim, rows, columns, object_id, class_id = map(int, ref["arr"])
        if (magic, ndim, rows, columns) != (3707764736, 2, 1, 1):
            raise ValueError("Unsupported MCOS reference shape")
        obj = self.objects[object_id - 1]
        if obj[0] != class_id or obj[2] != 1:
            raise ValueError("Unexpected MCOS object record")
        prop = self.saved[int(obj[3]) + 1]
        if tuple(prop[:3]) != (1, 0, 0):
            raise ValueError("Unsupported MCOS saved-property record")
        words = np.asarray(self.properties[int(prop[3]) + 1], dtype="<u8")
        if tuple(words[:2]) != (1, 2):
            raise ValueError("Unsupported MATLAB string serialization")
        count = int(words[2]) * int(words[3])
        payload = words[4 + count:].tobytes()
        decoded = []
        cursor = 0
        for length in words[4:4 + count]:
            end = cursor + 2 * int(length)
            decoded.append(payload[cursor:end].decode("utf-16-le").rstrip("\x00 "))
            cursor = end
        if cursor > len(payload) or any(payload[cursor:]):
            raise ValueError("Invalid string payload")
        return decoded


@dataclass
class Record:
    subject: str
    group: str
    role: str
    side: str
    field: str
    task_index: int
    raw_relpath: str
    marker_names: list
    emg_names: list
    angle_names: list
    marker: np.ndarray
    emg: np.ndarray
    angles: np.ndarray
    starts: np.ndarray
    ends: np.ndarray

    @property
    def record_id(self):
        return f"{self.subject}-BA-{self.role}"

    @property
    def trial_ids(self):
        return [f"{self.record_id}-{i:02d}" for i in range(1, len(self.starts) + 1)]

    def xyz(self, name):
        channel = self.marker_names.index(name)
        return self.marker[channel * 3:channel * 3 + 3].T

    @property
    def kin_time(self):
        return np.arange(self.marker.shape[1], dtype=np.int64) / KIN_HZ

    @property
    def emg_time(self):
        return np.arange(self.emg.shape[1], dtype=np.int64) / EMG_HZ


def read_ba(path):
    path = Path(path)
    mat = loadmat(path, squeeze_me=True, struct_as_record=False,
                  variable_names=["s", "__function_workspace__"])
    s = mat["s"]
    strings = MatlabStrings(mat)
    if (s.KinFreq, s.EmgFreq) != (KIN_HZ, EMG_HZ):
        raise ValueError(f"{path}: unexpected sample rates")
    healthy = path.stem.startswith("HS")
    fields = ["DataULdom"] if healthy else ["DataULpleg", "DataULnonpleg"]
    side = strings.decode(s.DomSide if healthy else s.HemiSide)[0]
    if side not in ("LX", "RX"):
        raise ValueError(f"{path}: unknown side {side}")
    for field in fields:
        records = list(np.atleast_1d(getattr(s, field)))
        codes = [strings.decode(r.TaskCode) for r in records]
        if any(len(code) != 1 for code in codes) or codes.count(["BA"]) != 1:
            raise ValueError(f"{path}/{field}: unexpected task codes {codes}")
        index = codes.index(["BA"])
        data = records[index]
        markers, emg, angles = [
            strings.decode(getattr(data, name))
            for name in ("MarkerVarName", "EmgVarName", "AngleVarName")
        ]
        for values, labels, block in [(data.Marker, markers, 3),
                                      (data.EMG, emg, 1), (data.Angles, angles, 1)]:
            if values.shape[0] != block * len(labels) or len(labels) != len(set(labels)):
                raise ValueError(f"{path}/{field}: labels do not match matrix rows")
        starts = np.atleast_1d(data.Events.Start).astype(int)
        ends = np.atleast_1d(data.Events.End).astype(int)
        if (starts.shape != ends.shape or not np.all((1 <= starts) & (starts < ends)
                                                    & (ends <= data.Marker.shape[1]))
                or np.any(ends[:-1] > starts[1:])):
            raise ValueError(f"{path}/{field}: invalid author events")
        group, role = ARMS[field]
        arm_side = {"RX": "LX", "LX": "RX"}[side] if role == "nonparetic" else side
        yield Record(path.stem, group, role, arm_side, field, index + 1,
                     f"emg_dataset/{path.name}", markers, emg, angles,
                     data.Marker, data.EMG, data.Angles, starts, ends)


def sample_slice(record, start_frame, end_frame, modality):
    """Map MATLAB 1-based frames to a Python slice with strict bounds."""
    if modality == "kin":
        scale, size = 1, record.marker.shape[1]
    elif modality == "emg":
        scale, size = RATIO, record.emg.shape[1]
    else:
        raise ValueError(f"Unknown modality: {modality}")
    start = (int(start_frame) - 1) * scale
    stop = (int(end_frame) - 1) * scale
    if not 0 <= start < stop <= size:
        raise ValueError(f"{record.record_id}: {modality} slice [{start}, {stop}) outside {size}")
    return slice(start, stop)


EMG_CHANNELS = {"BB": "BICEP", "TB": "TRICP", "AD": "DELANT", "MD": "DELML"}


def reach_window(record, trial_id, phase_rows):
    """Return the same REACH timestamps and slices for both downstream users."""
    matches = [row for row in phase_rows
               if row["trial_id"] == trial_id and row["phase"] == "REACH"]
    if len(matches) != 1 or trial_id not in record.trial_ids:
        raise ValueError(f"Expected exactly one REACH for {trial_id} in {record.record_id}")
    row = matches[0]
    if not row["start_kin_frame"] or not row["end_kin_frame"]:
        return None
    start, end = int(row["start_kin_frame"]), int(row["end_kin_frame"])
    return (start, end), sample_slice(record, start, end, "kin"), sample_slice(record, start, end, "emg")
