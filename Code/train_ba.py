"""Train and evaluate the offline BA teacher and student on subject-disjoint folds."""

import argparse
import csv
import json
from pathlib import Path

import numpy as np
import torch
from sklearn.linear_model import LogisticRegression, Ridge
from sklearn.metrics import balanced_accuracy_score
from sklearn.model_selection import StratifiedKFold
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler
from torch import nn
from torch.nn.utils.rnn import pack_padded_sequence, pad_packed_sequence

from ba_data import COMMON_CHANNELS, EMG_CHANNELS, OPTICAL_CHANNELS, TRAIN_HZ, load_trials


ROOT = Path(__file__).resolve().parent
FIELDS = ("emg", "optical", "common")


class Encoder(nn.Module):
    def __init__(self, channels, width):
        super().__init__()
        self.conv = nn.Conv1d(channels + 1, width, kernel_size=5, padding=2)
        self.activation = nn.GELU()
        self.lstm = nn.LSTM(width, width, batch_first=True, bidirectional=True)

    def forward(self, x, hidden, valid, lengths):
        # The extra channel distinguishes a masked sample from a genuine zero.
        x = torch.cat((x.masked_fill(hidden[..., None], 0), hidden[..., None]), dim=-1)
        x = self.activation(self.conv(x.transpose(1, 2))).transpose(1, 2)
        seq = pack_padded_sequence(x, lengths, batch_first=True, enforce_sorted=False)
        seq, _ = self.lstm(seq)
        x, _ = pad_packed_sequence(seq, batch_first=True, total_length=valid.shape[1])
        return x


class TwoBranch(nn.Module):
    def __init__(self, second_channels, width, latent):
        super().__init__()
        self.emg_encoder = Encoder(len(EMG_CHANNELS), width)
        self.motion_encoder = Encoder(second_channels, width)
        self.fuse = nn.Sequential(nn.Linear(4 * width, latent), nn.LayerNorm(latent))
        self.emg_head = nn.Linear(latent, len(EMG_CHANNELS))
        self.motion_head = nn.Linear(latent, second_channels)

    def encode(self, batch, second, masks=None):
        values, valid, lengths = batch
        if masks is None:
            blank = torch.zeros_like(valid)
            masks = (blank, blank)
        e = self.emg_encoder(values["emg"], masks[0], valid, lengths)
        k = self.motion_encoder(values[second], masks[1], valid, lengths)
        return self.fuse(torch.cat((e, k), dim=-1)).masked_fill(~valid[..., None], 0)

    def reconstruct(self, encoded):
        return self.emg_head(encoded), self.motion_head(encoded)


def make_teacher():
    return TwoBranch(len(OPTICAL_CHANNELS), width=16, latent=24)


def make_student():
    return TwoBranch(len(COMMON_CHANNELS), width=8, latent=12)


def fit_scales(trials):
    scales = {}
    for field in FIELDS:
        samples = np.concatenate([getattr(t, field) for t in trials], axis=0)
        scales[field] = (samples.mean(axis=0), np.maximum(samples.std(axis=0), 1e-6))
    return scales


def make_batch(trials, scales):
    lengths = [len(t.emg) for t in trials]
    steps = max(lengths)
    valid = torch.arange(steps)[None, :] < torch.tensor(lengths)[:, None]
    values = {}
    for field, (mean, std) in scales.items():
        array = np.zeros((len(trials), steps, len(mean)), dtype=np.float32)
        for i, trial in enumerate(trials):
            array[i, :lengths[i]] = (getattr(trial, field) - mean) / std
        values[field] = torch.from_numpy(array)
    return values, valid, lengths


def mask_spans(lengths, rng, fraction=0.30):
    mask = np.zeros((len(lengths), max(lengths)), dtype=bool)
    for i, length in enumerate(lengths):
        # Keep endpoints visible for a fair interpolation baseline.
        span = min(length - 2, max(1, round(fraction * length)))
        start = int(rng.integers(1, length - span))
        mask[i, start:start + span] = True
    return torch.from_numpy(mask)


def masked_error(prediction, target, mask, squared=True):
    # Average each trial first to avoid weighting slower executions by duration.
    residual = (prediction - target).square() if squared else (prediction - target).abs()
    per_frame = residual.mean(dim=-1)
    return ((per_frame * mask).sum(dim=1) / mask.sum(dim=1).clamp_min(1)).mean()


def fit_model(model, second, trials, scales, args, seed, teacher=None, projector=None):
    rng = np.random.default_rng(seed)
    params = list(model.parameters())
    use_kd = teacher is not None and args.kd_weight > 0
    if use_kd:
        params += list(projector.parameters())
    optimizer = torch.optim.AdamW(params, lr=args.lr)
    for epoch in range(args.epochs):
        losses = []
        for idx in np.array_split(rng.permutation(len(trials)), int(np.ceil(len(trials) / args.batch_size))):
            batch = make_batch([trials[i] for i in idx], scales)
            values, valid, lengths = batch
            masks = (mask_spans(lengths, rng), mask_spans(lengths, rng))
            encoded = model.encode(batch, second, masks)
            e_pred, k_pred = model.reconstruct(encoded)
            loss = (masked_error(e_pred, values["emg"], masks[0])
                    + masked_error(k_pred, values[second], masks[1])) / 2
            if use_kd:
                with torch.no_grad():
                    target = teacher.encode(batch, "optical")
                clean = model.encode(batch, second)
                loss = loss + args.kd_weight * masked_error(projector(clean), target, valid)
            optimizer.zero_grad(set_to_none=True)
            loss.backward()
            nn.utils.clip_grad_norm_(params, 1.0, error_if_nonfinite=True)
            optimizer.step()
            losses.append(loss.item())
        if epoch == 0 or (epoch + 1) % 10 == 0 or epoch + 1 == args.epochs:
            stage = "student_kd" if use_kd else "teacher" if second == "optical" else "student_direct"
            print(f"  {stage:14s} epoch {epoch + 1:02d}/{args.epochs:02d}  loss {np.mean(losses):.4f}", flush=True)
    model.eval()


def interpolate(x, hidden):
    x = x.numpy()
    hidden = hidden.numpy()
    time = np.arange(len(x))
    estimate = x.copy()
    for channel in range(x.shape[1]):
        estimate[hidden, channel] = np.interp(time[hidden], time[~hidden], x[~hidden, channel])
    return torch.from_numpy(estimate)


def pool(encoded):
    # Ordered summaries preserve coarse timing within the unwarped trial.
    return np.concatenate([part.mean(axis=0) for part in np.array_split(encoded, 3)])


@torch.no_grad()
def representations(trials, scales, teacher, direct, student, projector, seed, fold=None):
    rng = np.random.default_rng(seed)
    z = {name: [] for name in ("teacher", "student_direct", "student_kd", "feature_summary", "duration")}
    sequences = {name: [] for name in ("teacher", "student_direct", "student_kd")}
    rows = []
    for trial in trials:
        batch = make_batch([trial], scales)
        values, valid, lengths = batch
        te = teacher.encode(batch, "optical")
        sd = direct.encode(batch, "common")
        sk = student.encode(batch, "common")
        for name, latent in zip(sequences, (te, sd, sk), strict=True):
            z[name].append(pool(latent[0].numpy()))
            # Same phase indices for both modalities and all models, fixed count per trial.
            indices = np.linspace(0, lengths[0] - 1, 24).round().astype(int)
            sequences[name].append(latent[0, indices].numpy())
        raw = torch.cat((values["emg"], values["common"]), dim=-1)[0].numpy()
        z["feature_summary"].append(np.r_[pool(raw), raw.std(axis=0)])
        z["duration"].append([trial.metrics["duration_s"]])
        if fold is None:
            continue
        e_mask, o_mask, k_mask = (mask_spans(lengths, rng) for _ in range(3))
        te_e, te_o = teacher.reconstruct(teacher.encode(batch, "optical", (e_mask, o_mask)))
        sd_e, sd_k = direct.reconstruct(direct.encode(batch, "common", (e_mask, k_mask)))
        sk_e, sk_k = student.reconstruct(student.encode(batch, "common", (e_mask, k_mask)))
        baseline = {field: interpolate(values[field][0], mask[0])[None, ...]
                    for field, mask in zip(FIELDS, (e_mask, o_mask, k_mask), strict=True)}
        row = {"fold": fold, "trial": trial.id, "subject": trial.subject, "group": trial.group}
        for name, prediction, field, mask in (
            ("teacher_emg", te_e, "emg", e_mask), ("teacher_optical", te_o, "optical", o_mask),
            ("direct_emg", sd_e, "emg", e_mask), ("direct_common", sd_k, "common", k_mask),
            ("kd_emg", sk_e, "emg", e_mask), ("kd_common", sk_k, "common", k_mask),
            ("interp_emg", baseline["emg"], "emg", e_mask),
            ("interp_optical", baseline["optical"], "optical", o_mask),
            ("interp_common", baseline["common"], "common", k_mask),
        ):
            row[name + "_mae_z"] = masked_error(prediction, values[field], mask, squared=False).item()
        row["kd_projection_mse"] = masked_error(projector(sk), te, valid).item()
        rows.append(row)
    return {k: np.asarray(v) for k, v in z.items()}, {k: np.asarray(v) for k, v in sequences.items()}, rows


def alignment(train, test, test_rows):
    """Compare both students with equally trained linear readouts of teacher features."""
    teacher_train = train["teacher"].reshape(-1, train["teacher"].shape[-1])
    teacher_test = test["teacher"]
    mean = teacher_train.mean(axis=0)
    for i, row in enumerate(test_rows):
        row["constant_teacher_feature_mse"] = float(np.mean((teacher_test[i] - mean) ** 2))
    for key in ("student_direct", "student_kd"):
        student_train = train[key].reshape(-1, train[key].shape[-1])
        student_test = test[key]
        readout = Ridge(alpha=10).fit(student_train, teacher_train)
        estimates = readout.predict(student_test.reshape(-1, student_test.shape[-1])).reshape(teacher_test.shape)
        for i, row in enumerate(test_rows):
            row[key + "_linear_alignment_mse"] = float(np.mean((estimates[i] - teacher_test[i]) ** 2))


def subject_features(trials, features):
    # Healthy-dominant vs stroke-affected only, one vector per participant.
    indices = {}
    for i, trial in enumerate(trials):
        if trial.group in {"healthy", "affected"}:
            indices.setdefault((trial.subject, trial.group), []).append(i)
    keys = sorted(indices)
    x = np.stack([features[indices[key]].mean(axis=0) for key in keys])
    y = np.asarray([group == "affected" for _, group in keys], dtype=int)
    return keys, x, y


def probes(train_trials, test_trials, train_z, test_z, fold):
    rows = []
    metric_keys = sorted(set.intersection(*(set(t.metrics) for t in train_trials + test_trials)))
    for name, train_x in train_z.items():
        test_x = test_z[name]
        for metric in metric_keys:
            train_y = np.asarray([t.metrics[metric] for t in train_trials], dtype=float)
            test_y = np.asarray([t.metrics[metric] for t in test_trials], dtype=float)
            train_ok, test_ok = np.isfinite(train_y), np.isfinite(test_y)
            if train_ok.sum() < 2 or not test_ok.any():
                continue
            reg = make_pipeline(StandardScaler(), Ridge(alpha=10))
            pred = reg.fit(train_x[train_ok], train_y[train_ok]).predict(test_x[test_ok])
            for i, value in zip(np.flatnonzero(test_ok), pred, strict=True):
                t = test_trials[i]
                rows.append(dict(fold=fold, model=name, metric=metric, subject=t.subject,
                                 trial=t.id, group=t.group, truth=test_y[i], prediction=value))
                if name == "teacher":
                    rows.append(dict(fold=fold, model="training_median", metric=metric, subject=t.subject,
                                     trial=t.id, group=t.group, truth=test_y[i], prediction=np.median(train_y[train_ok])))
        keys, x_test, y_test = subject_features(test_trials, test_x)
        _, x_train, y_train = subject_features(train_trials, train_x)
        classifier = make_pipeline(StandardScaler(), LogisticRegression(C=0.1))
        pred = classifier.fit(x_train, y_train).predict_proba(x_test)[:, 1]
        for (subject, group), truth, value in zip(keys, y_test, pred, strict=True):
            rows.append(dict(fold=fold, model=name, metric="cohort_exploratory", subject=subject,
                             trial="", group=group, truth=truth, prediction=value))
    return rows


def write_csv(path, rows):
    with path.open("w", newline="", encoding="utf-8") as file:
        writer = csv.DictWriter(file, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)


def validate_evaluation(trials, probes, embeddings):
    for row in trials:
        scores = [value for key, value in row.items() if key.endswith(("_mse", "_mae_z"))]
        if not np.isfinite(scores).all():
            raise ValueError(f"Nonfinite evaluation metric for {row['trial']}")
    if not np.isfinite([(r["truth"], r["prediction"]) for r in probes]).all():
        raise ValueError("Nonfinite representation probe prediction")
    if not np.isfinite([[value for key, value in r.items() if key.startswith("kd_")]
                        for r in embeddings]).all():
        raise ValueError("Nonfinite student embedding")


def macro_mean(values, subjects):
    unique = sorted(set(subjects))
    return float(np.mean([np.mean([v for v, s in zip(values, subjects, strict=True) if s == key])
                          for key in unique]))


def summarize(trials, probe_rows):
    metrics = [key for key in trials[0] if key.endswith(("_mae_z", "_mse"))]
    scores = []
    for group in ("all", "healthy", "affected", "nonaffected"):
        subset = [row for row in trials if group == "all" or row["group"] == group]
        if not subset:
            continue
        for key in metrics:
            scores.append(dict(metric=key, model="", group=group,
                               score=macro_mean([row[key] for row in subset], [row["subject"] for row in subset])))
    for model, metric in sorted({(r["model"], r["metric"]) for r in probe_rows}):
        subset = [row for row in probe_rows if row["model"] == model and row["metric"] == metric]
        truths = np.asarray([row["truth"] for row in subset])
        preds = np.asarray([row["prediction"] for row in subset])
        if metric == "cohort_exploratory":
            score = float(balanced_accuracy_score(truths, preds >= 0.5))
            group = "healthy_vs_affected"
        else:
            score = macro_mean(abs(truths - preds), [row["subject"] for row in subset])
            group = "all"
        scores.append(dict(metric=metric, model=model, group=group, score=score))
    return scores


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", type=Path, default=ROOT.parent / "emg_dataset")
    parser.add_argument("--output", type=Path, default=ROOT / "runs" / "ba_v1")
    parser.add_argument("--epochs", type=int, default=24, help="epochs per model")
    parser.add_argument("--folds", type=int, default=5)
    parser.add_argument("--batch-size", type=int, default=8)
    parser.add_argument("--seed", type=int, default=3201)
    parser.add_argument("--threads", type=int, default=2)
    parser.add_argument("--lr", type=float, default=1e-3)
    parser.add_argument("--kd-weight", type=float, default=0.5)
    args = parser.parse_args()
    if min(args.epochs, args.batch_size, args.threads) < 1 or args.folds < 2:
        parser.error("epochs, batch size and threads must be positive, with at least two folds")
    if not np.isfinite([args.lr, args.kd_weight]).all() or args.lr <= 0 or args.kd_weight <= 0:
        parser.error("learning rate and distillation weight must be finite and positive")
    if args.output.exists():
        parser.error(f"output directory already exists: {args.output}")
    torch.set_num_threads(args.threads)
    trials = load_trials(args.data)
    if not trials or min(len(t.emg) for t in trials) < 3:
        raise ValueError("Expected nonempty BA data with at least three frames per trial")
    subjects = np.asarray(sorted({t.subject for t in trials}))
    families = np.asarray([t.startswith("ST") for t in subjects], dtype=int)
    if min(np.bincount(families, minlength=2)) < args.folds:
        parser.error("each cohort needs at least one participant per fold")
    folds = StratifiedKFold(n_splits=args.folds, shuffle=True, random_state=args.seed)
    args.output.mkdir(parents=True)
    print(f"Loaded {len(trials)} BA trials from {len(subjects)} subjects.", flush=True)
    counts = {group: sum(t.group == group for t in trials) for group in sorted({t.group for t in trials})}
    config = {**vars(args), "n_trials": len(trials), "n_subjects": len(subjects), "counts": counts,
              "model_sample_rate_hz": TRAIN_HZ,
              "channels": dict(emg=list(EMG_CHANNELS), optical=list(OPTICAL_CHANNELS), common=list(COMMON_CHANNELS)),
              "torch_version": str(torch.__version__), "numpy_version": np.__version__}
    (args.output / "config.json").write_text(json.dumps(config, default=str, indent=2), encoding="utf-8")
    all_trials, all_probes, embedding_rows, splits = [], [], [], []
    for fold, (train_idx, test_idx) in enumerate(folds.split(subjects, families), start=1):
        train_ids = set(subjects[train_idx].tolist())
        test_ids = set(subjects[test_idx].tolist())
        train_trials = [t for t in trials if t.subject in train_ids]
        test_trials = [t for t in trials if t.subject in test_ids]
        splits.append(dict(fold=fold, train=sorted(train_ids), test=sorted(test_ids)))
        print(f"Fold {fold}/{args.folds}: {len(train_trials)} train / {len(test_trials)} test trials", flush=True)
        scales = fit_scales(train_trials)
        seed = args.seed + 101 * fold
        torch.manual_seed(seed)
        teacher = make_teacher()
        fit_model(teacher, "optical", train_trials, scales, args, seed)
        teacher.requires_grad_(False)
        torch.manual_seed(seed + 1)
        direct = make_student()
        student = make_student()
        student.load_state_dict(direct.state_dict())
        projector = nn.Linear(12, 24)
        fit_model(direct, "common", train_trials, scales, args, seed + 2)
        fit_model(student, "common", train_trials, scales, args, seed + 2, teacher, projector)
        train_z, train_seq, _ = representations(train_trials, scales, teacher, direct, student, projector, seed)
        test_z, test_seq, rows = representations(test_trials, scales, teacher, direct, student, projector, seed + 3, fold)
        alignment(train_seq, test_seq, rows)
        all_trials.extend(rows)
        all_probes.extend(probes(train_trials, test_trials, train_z, test_z, fold))
        for i, trial in enumerate(test_trials):
            embedding_rows.append({"fold": fold, "trial": trial.id, "subject": trial.subject, "group": trial.group,
                                   **{f"kd_{j:02d}": v for j, v in enumerate(test_z["student_kd"][i])}})
        torch.save({"teacher": teacher.state_dict(), "student_direct": direct.state_dict(),
                    "student_kd": student.state_dict(), "projection": projector.state_dict(),
                    "scale": {k: tuple(torch.from_numpy(a) for a in v) for k, v in scales.items()},
                    "split": splits[-1], "channels": config["channels"]},
                   args.output / f"fold_{fold:02d}.pt")
    validate_evaluation(all_trials, all_probes, embedding_rows)
    (args.output / "splits.json").write_text(json.dumps(splits, indent=2), encoding="utf-8")
    write_csv(args.output / "trial_metrics.csv", all_trials)
    write_csv(args.output / "probe_predictions.csv", all_probes)
    write_csv(args.output / "student_embeddings.csv", embedding_rows)
    write_csv(args.output / "summary.csv", summarize(all_trials, all_probes))
    print(f"Results: {args.output}", flush=True)


if __name__ == "__main__":
    main()
