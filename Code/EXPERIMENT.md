# BA 抓球模型实验记录

## 当前进度

训练入口是 `train_ba.py`。完整训练包括教师、无蒸馏学生和蒸馏学生，已用 20 人、149 次抓球完成五折试跑，每折每个模型 4 轮。当前新增了两种教师对照模式，已准备好交给组员运行。新增模式的正式训练和结果记录尚待完成。

`runs/ba_v1_pilot/` 保存已完成的试跑。详见 [模型说明](README.md) 和 [试跑汇总](runs/ba_v1_pilot/summary.csv)。

## 模型与数据

- `ba_data.py` 从 `../emg_dataset/` 读取原始 MAT，按 BA Start/End 取整次抓球，将 6 路肌电包络和光学特征对齐到 50 Hz。肌电通道为 BB、TB、AD、MD、FCR、ECR。
- **教师**有肌电和光学两个分支，每个分支是一层 1D CNN 加一层 BiLSTM。输入为 6 路 sEMG 和 16 个光学特征，两路逐帧融合为 24 维。原配方分别在两个模态遮挡约 30% 的连续时间段，重建所遮挡的信号。
- **学生**输入 6 路 sEMG 和 7 个公共运动学特征 `K_opt`。`K_opt` 由光学数据算出，包括胸廓坐标系中的上臂方向、前臂方向和肘屈角。学生输出逐帧 12 维特征，蒸馏时投影到 24 维以拟合冻结教师。整次动作按前、中、后三个时间区间平均池化，生成 36 维表示。
- **评估**按受试者做五折。同一人的双侧和重复试验归入同一折。标准化和线性读出在当折训练受试者上拟合。当前是整次动作离线评估，实际 IMU 特征的对应关系需要同步采集验证。

## 修改记录

| 版本 | 修改 | 状态 |
|---|---|---|
| `ba_v1_pilot` | 实现双模态教师、无蒸馏学生和蒸馏学生。 | 五折各 4 轮已完成。教师光学重建 MAE 为 0.772，线性插值为 0.560。蒸馏学生腕路径 MAE 为 7.81 cm，无蒸馏为 8.39 cm，动作时长基线为 6.59 cm。 |
| `ba_v1_teacher_controls` | 新增 `--teacher-epochs`、`teacher-only` 和 `teacher-comparison`。`teacher-comparison` 同时训练光学教师和肌电＋光学教师，统一使用光学掩码重建损失。 | 代码与交接说明已完成，待组员训练。 |

## 运行方法

在仓库的 `Code` 目录用 Python 3.12 执行。建议在同一个环境中运行整组比较。默认数据路径为 `../emg_dataset`，可用 `--data` 指定其他位置。每条命令使用新的输出目录。

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
```

**1. 比较教师训练轮数。** 下面两次均使用原配方和相同划分，只改变教师轮数。

```bash
python train_ba.py --mode teacher-only --teacher-epochs 4 --folds 5 --seed 3201 --output runs/ba_v1_teacher_4ep
python train_ba.py --mode teacher-only --teacher-epochs 24 --folds 5 --seed 3201 --output runs/ba_v1_teacher_24ep
```

对照两个 `summary.csv` 中的 `teacher_optical_mae_z`、`teacher_emg_mae_z` 及动作指标。核对两次 `splits.json` 一致，并以各自表中的插值误差作参考。

**2. 检验肌电对教师的贡献。** 两个教师使用相同的网络形状、初始权重、训练顺序、光学掩码和光学重建目标。光学教师将肌电分支输出置零，双模态教师接收同次试验部分可见的肌电。预先确定轮数。下面以 24 轮为例。

```bash
python train_ba.py --mode teacher-comparison --teacher-epochs 24 --folds 5 --seed 3201 --output runs/ba_v1_teacher_modalities
```

在 `summary.csv` 比较 `teacher_optical_only_mae_z`、`teacher_emg_optical_mae_z` 和 `interp_optical_mae_z`，三项使用同一批留出试验和完全相同的光学掩码。再比较两个教师冻结表示的 `wrist_path_length_m` 与 `upper_arm_lateral_change_deg`，并参考 `duration` 和 `feature_summary` 基线。连续指标的 `score` 是受试者宏平均 MAE，单位见指标名。`cohort_exploratory` 是探索性的组别平衡准确率，分开解读。

**3. 复跑完整蒸馏。** 等教师对照有结果后，再用 `full` 跑原配方教师和两个学生。以下示范让教师训练 24 轮，两个学生均训练 4 轮。

```bash
python train_ba.py --mode full --teacher-epochs 24 --epochs 4 --folds 5 --seed 3201 --output runs/ba_v1_kd_teacher24_student4
```

`full` 独立训练同时重建肌电与光学的教师。比较 `student_direct` 和 `student_kd` 的腕路径及上臂外移 MAE，以及相同划分下的简单基线。

## 结果文件与交接

| 文件 | 用途 |
|---|---|
| `config.json`、`splits.json` | 保存运行模式、轮数、教师输入与目标、随机种子和每折参与者名单。 |
| `summary.csv` | 优先查看，含重建和下游读出汇总。 |
| `trial_metrics.csv`、`probe_predictions.csv` | 核对逐试验重建与下游预测，支持按受试者成对比较。 |
| `fold_*.pt` | 每折模型参数及标准化参数。教师模态对照的两个模型键为 `teacher_optical_only` 和 `teacher_emg_optical`，`teacher_use_emg` 记录载入后编码时各自的开关。 |
| `student_embeddings.csv` | `full` 运行的留出学生表示，绘制嵌入时按折处理。 |

每次提交新修改时，在「修改记录」追加版本和变更。每次运行结束后，记录输出目录、模式、轮数、种子、有效受试者数、关键指标和结论。比较实验时先核对 `splits.json`、`config.json` 和相同单位的基线。
