# BME3201 · 抓球任务 BA 数据整理与运动学初标

在云端处理了 `main` 的原始数据提交 `447bc5d91888214cd00c02bd0eb8154b7aeb8fe9`。核对了 `emg_dataset/` 下 20 份 MAT，共 761,922,208 字节，原始文件完整保留。结果包含 20 个不同个体、30 个手臂记录、149 次作者标注的试次和 596 行阶段记录。卒中非患侧的 ST07 原文件只有 4 对起止标记，因此该组为 49 次。

数据和采集方法见 [Figshare 数据集](https://doi.org/10.6084/m9.figshare.c.7720187.v1)、[原始论文](https://pmc.ncbi.nlm.nih.gov/articles/PMC12675522/) 和 [作者的 MATLAB 绘图脚本](https://doi.org/10.6084/m9.figshare.28596131.v1)。原文件见 [仓库指定提交](https://github.com/FrankPan-30/BME3201-BA-Dataset/tree/447bc5d91888214cd00c02bd0eb8154b7aeb8fe9/emg_dataset)。

## 运行与回放

在仓库根目录运行。全量处理验证使用 Python 3.12、NumPy 2.3.5 和 SciPy 1.17.0。

```bash
python -m pip install numpy==2.3.5 scipy==1.17.0
PYTHONDONTWRITEBYTECODE=1 python ba_analysis/run_ba.py
```

`--repo` 可指定包含 `emg_dataset/` 的仓库根目录，`--out` 可指定输出目录，`--replay-trial` 可选择另一个试次。默认用 ST09 患侧第 1 次生成 [单文件回放](ba_output/replay.html)。文件内嵌手与球的三维坐标、原始采样率的四路 EMG 及阶段边界。下载 HTML 后在浏览器打开，即可播放、拖动滑块或在肌电图上拖动游标。两幅空间图共用一个时间点，肌电以 mV 独立定标。

## 文件与字段

| 文件 | 内容 |
| --- | --- |
| [trials.csv](ba_output/trials.csv) | 每次 BA 一行。`trial_id` 由 `record_id` 加作者事件顺序 `repeat_no` 组成。`record_id` 为个体、BA、手臂角色。`subject`、`group`、`task_code`、`arm_side`、`arm_role` 描述试次，`raw_relpath` 和 `mat_arm_field` 追溯到原始记录。`events_start_frame`、`events_end_frame` 为作者的 MATLAB 1 基帧号，`duration_s` 为二者之差除以 125。 |
| [phase_intervals.csv](ba_output/phase_intervals.csv) | 每试次每阶段一行。`start_kin_frame`、`end_kin_frame` 为 MATLAB 1 基运动学帧号，`start_s`、`end_s` 为相对时间，`duration_s` 为窗长。两个 `*_boundary_source` 单独追溯各自边界。`boundary_status` 为 `auto`（规则有完整证据）、`review`（有候选且需复核）、`unresolved`（缺少边界）。已知的另一端在 `unresolved` 时保留。`emg_qc`、`kin_qc` 各自报告可用性，`artifact_flags` 记录信号检查结果，`method_version` 记录规则版本，`notes` 记录边界复核或缺失原因。多项用竖线分隔。 |
| [record_inventory.csv](ba_output/record_inventory.csv) | 逐手臂保存 BA 在 MAT 中的索引、侧别依据、作者事件对数、标记点/肌电/角度的原始标签和矩阵列数，以及时钟端点差。卒中两个手臂来自同一文件，`raw_bytes` 因此在两行重复。 |
| [reach_alignment.csv](ba_output/reach_alignment.csv) | 每个可定位的 REACH 一行，给出同一窗的 1 基运动学边界、两种数据的 0 基 Python 切片索引，以及实际 EMG 和肘角样本数。所有 stop 索引均排除在窗外。 |

`ba_analysis/read_ba.py` 解码 MAT v5 工作区中的 MCOS `string` 引用，逐文件根据 `TaskCode` 选 BA，并用矩阵尺寸核对全部标签。健康组从 `DataULdom` 读取 `DomSide`，卒中组从 `DataULpleg` 和 `DataULnonpleg` 读取，后者侧别为 `HemiSide` 的对侧。逐记录用 `ULNA`、`RADIUS`、`MIDFORE`、`ELBOW`、`Meta2` 的实际后缀验证侧别，两侧肩标记可同时存在。BB、TB、AD、MD 分别按文件内标签定位到 `BICEP`、`TRICP`、`DELANT`、`DELML`，肘屈曲取 `ElbowFlx`。

## 对齐与共用 REACH

论文记载同步采集，文件提供 `KinFreq=125` 和 `EmgFreq=1000`。BA 结构提供样本矩阵及运动学事件，未提供可恢复两路相位差的逐样本时间戳或同步脉冲。这次处理使用独立的标称时间轴并取首样本为共同起点。记录的 EMG 末样本相对运动学末样本相差 −0.101 到 +0.031 s。端点差只用于审计，处理按原采样率，样本不拉伸、不重采样，硬件偏移与时钟漂移未独立验证。

对 MATLAB 运动学帧 `f`，记录时间为 `(f−1)/125`；对 1 基 EMG 样本 `j`，记录时间为 `(j−1)/1000`。两轴都减去 `(Events.Start−1)/125`，把作者起点设为 0 s。所有阶段采用 `[start, end)`。窗 `[a,b)` 在 Python 中的运动学切片为 `[a−1:b−1]`，EMG 切片为 `[8*(a−1):8*(b−1)]`。全量验证了 149 个作者区间和 595 个完整阶段的两轴切片均界内，且每个运动学样本与对应的第八个 EMG 网格点重合。全动作时长独立计算，用原始 `Events.End − Events.Start` 除以 125；阶段间停顿可留空。

3 号与 4 号成员均可按 `trial_id` 调用同一读取入口。这里仅提取 BB/TB/AD/MD 和肘屈曲数据窗供后续处理。

```python
import csv
from pathlib import Path
import sys

sys.path.insert(0, "ba_analysis")
from read_ba import EMG_CHANNELS, read_ba, reach_window

trial_id = "ST09-BA-paretic-01"
with open("ba_output/trials.csv", newline="") as file:
    trial = next(row for row in csv.DictReader(file) if row["trial_id"] == trial_id)
with open("ba_output/phase_intervals.csv", newline="") as file:
    phases = list(csv.DictReader(file))
record = next(r for r in read_ba(Path(trial["raw_relpath"]))
              if r.record_id == trial["record_id"])
frames, kin, emg = reach_window(record, trial_id, phases)
member3_emg = record.emg[[record.emg_names.index(n) for n in EMG_CHANNELS.values()], emg]
member4_elbow = record.angles[record.angle_names.index("ElbowFlx"), kin]
```

149 个 REACH 均通过样本索引和时间窗一致性检查。例如 ST09 患侧第 1 次同取 1 基运动学 `[1419,1902)`，相对 `[0.000,3.864)` 秒，对应每个肌电通道 3864 点和肘角 483 点。

## 分段规则与质控

`ba-kinematic-v1.0` 是运动学初标。腕用同侧尺骨茎突和桡骨茎突的中点，手用同侧 `Meta2`，球用 `OBJECT`。论文表 2 将 Marker 单位写为 m，作者绘图脚本标为 mm。依据脚本和原值尺度（球由低位移到高位时，Y 坐标增加数百个单位），本处理按 mm 使用 MAT 原值。Y 为高度，30 条记录中用球放到高处时的坐标变化核对了这一方向。范围阈值使用各轴极差向量的欧氏长度。缺失点不插补。

| 阶段 | 运动学规则 |
| --- | --- |
| REST | 在起点前最多 63 帧（0.504 s）内且不跨入上一次试次，找最近的至少 25 帧静止窗。腕和球的三轴范围分别不超过 10 mm 和 5 mm。在满足条件时向前扩展窗口。静止证据不足时两端留空。 |
| REACH | 起点用 `Events.Start`。球初始坐标取起点前最近的 13 帧稳定段中位数，若该段缺失，仅在试次开头的稳定球段提供证据时使用并标记复核。终点是球距初始位置至少 15 mm、Y 上升至少 8 mm 且同时持续 13 帧（0.104 s）的第一帧。该终点估计前伸结束，接触时刻未直接测量。 |
| LIFT_TRANSFER | 从球持续移动到首次进入最终高位的稳定段。高位参考来自动作后段最后一个满足 25 帧稳定、比初始至少高 150 mm 的球段。放稳候选要求连续 25 帧距参考球位不超过 12 mm、三轴范围不超过 10 mm，并在参考段结束前至少 95% 的可见帧保持在参考球位 12 mm 内。候选之后的掉点或再次位移触发复核。 |
| RETURN | 从放稳后首个持续远离球且腕向起始位移动的时刻，到 `Events.End`。在 25 帧跨度内，手球距离至少增加 20 mm、腕到起始位距离至少减少 15 mm，逐帧移动方向至少 80% 一致（容许 0.5 mm 抖动），前 5 帧两项各有至少 1 mm 进展，且球保持稳定。放稳与回撤之间允许停顿。 |

EMG 和运动学分别对窗内样本做可用性检查。EMG 检查 BB/TB/AD/MD 的越界、非有限值及恒定通道或连续至少 100 个相同样本。运动学检查腕、球、肘屈曲的界限及非有限值，LIFT_TRANSFER 和 RETURN 另检查手标记。标记单帧位移超过 35 mm 或肘角单帧变化超过 15° 时提示复核。`pass` 表示该窗通过上述自动检查，`fail` 表示缺样本或信号不可用，`review` 表示可切片且有信号异常提示，`not_evaluated` 表示窗不完整。质控覆盖用于交接的四路肌电与上述运动学信号。

### 全量可用数量

单元格为 **有完整边界 / EMG 通过 / 运动学通过 / 边界为 auto 且两路通过**。`review` 候选可切片，做严格筛选时使用最后一个数字。

| 分组（试次） | REST | REACH | LIFT_TRANSFER | RETURN |
| --- | --- | --- | --- | --- |
| 健康优势侧（50） | 50 / 50 / 50 / 50 | 50 / 50 / 50 / 50 | 50 / 50 / 50 / 47 | 50 / 50 / 50 / 50 |
| 卒中患侧（50） | 50 / 50 / 50 / 50 | 50 / 50 / 50 / 50 | 50 / 50 / 50 / 49 | 49 / 49 / 49 / 49 |
| 卒中非患侧（49） | 49 / 49 / 49 / 49 | 49 / 49 / 49 / 49 | 49 / 49 / 49 / 48 | 49 / 49 / 49 / 49 |
| 合计（149） | 149 / 149 / 149 / 149 | 149 / 149 / 149 / 149 | 149 / 149 / 149 / 144 | 148 / 148 / 148 / 148 |

### 异常与抽查范围

- `HS02-BA-dominant-02`、`-03`、`-04` 和 `ST09-BA-nonparetic-01` 的球先出现高位平台，之后在作者终点前再次移动。保留初次放稳候选，LIFT_TRANSFER 标为 `review`。四次均有球保持稳定期间的回撤起始证据。
- `ST02-BA-paretic-05` 的球从 7.216 s 到窗结束缺测，共 301 帧。6.224 s 的放稳候选标为 `review`。腕回到起始位置附近，但缺少球标记来证实手持续远离球，故 RETURN 起点、起始秒数和时长留空，保留作者终点 9.624 s。该试次 REACH `[0,3.016)` 两路均通过。
- 逐图抽查 8 次，查看球的 Y 高度、手球距离、腕到起始位置距离及阶段叠加。抽查覆盖上述 5 个异常试次，以及 `HS01-BA-dominant-01`、`ST04-BA-nonparetic-01`、`ST09-BA-paretic-01`。其余试次采用同一套自动规则和质控。
- ST09 患侧第 1 次的球起动、放稳、回撤、作者总时长分别为 **3.864、6.504、6.640、9.792 s**。与给定初标相比，持续稳定检验把放稳推迟 1 帧，手球距离和腕归位的双条件把回撤推迟 5 帧。回放保留两者之间 0.136 s 的停顿。

回放验证在 Chromium 的断网模式进行。云端浏览器策略拦截了直接访问 `file://`，因此将成品 HTML 原样载入测试页，确认播放、暂停、拖拽、阶段切换、空间游标和窄屏布局均正常，网络请求数为 0。
