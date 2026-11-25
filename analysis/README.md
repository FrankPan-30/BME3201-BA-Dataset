# A/B 分析交付索引

本目录保存 2026-11-24 的离线探索结果，2026-11-25 整理上传。原有根目录 ba_analysis、ba_output 和 emg_dataset 保持独立；两套实现的阶段规则和统计口径不同，不应混用结果。

| 分类 | 入口 |
|---|---|
| A 方案、方法与运行说明 | [README](BA_AB_20261124/README.md) |
| A/B 对比 proposal | [PROPOSAL](BA_AB_20261124/PROPOSAL.md) |
| A Word 实测报告 | [下载报告](BA_AB_20261124/docs/BA全通道模式探索报告.docx) |
| B 方案与结果 | [B README](BA_AB_20261124/route_b/README.md) |
| B Word 报告与对比 | [下载报告](BA_AB_20261124/route_b/docs/B路线探索与AB对比报告.docx) |
| A 代码、配置、测试 | BA_AB_20261124/src、config、tests |
| A 数值结果、图表 | BA_AB_20261124/results、figures |
| B 代码、数值结果、图表 | BA_AB_20261124/route_b/src、results、figures |
| 逐记录核查 | [HTML](BA_AB_20261124/docs/逐记录核查.html)，请连同 figures 下载后本地打开 |

## 当前结论与边界

A：20 人、149 次 BA；阶段耗时、部分患者外侧姿态和 BB/TB 活动重叠值得复核；没有支持患侧普遍中途停顿的证据。

B：K-means 联合 24 个肌电与 6 个运动学特征。B1 主要反映阶段位置；B2 控制位置后，搬运出现较慢、波动较大、外侧姿态偏大的候选组合，覆盖 8 名患者及 5 名健康人。当前分组主要由运动学驱动。

所有结果为开发集探索，没有正常／异常训练标签，没有监督分类训练或独立诊断准确率。

## 方法澄清（2026-11-25）

当前代码的重叠指标为 2Σmin(x,y)/Σ(x+y)。Bandini 2023 使用 Frost CCI，两者公式与归一化不同；该论文支持共同收缩研究方向，不代表本实现复现其方法或可引用其阈值。B 的 30 个特征未直接包含 A 的 CCI、路径比、低速区间数和完整阶段时长。原报告作为实测快照保留，本说明补充解释边界。

## 复现

本次不重复上传原始 MAT、data_derived 缓存、Office 临时文件及渲染 QA。结果表和报告可直接查看；重新计算需要从原始 MAT 导出缓存。

在 BA_AB_20261124 目录安装 requirements.txt，设置 BA_DATA_ROOT 指向包含 HS01.mat 等文件的目录（可使用仓库 emg_dataset，或本机 F:/dataset/dataset），运行：

```powershell
$env:BA_DATA_ROOT = 'F:/dataset/dataset'
.\run_all.ps1 -ExportRaw -Matlab '你的MATLAB安装路径/bin/matlab.exe'
.\run_b.ps1
```

首次导出需要 MATLAB；随后 Python 完成分析。Word 生成方式见 docs/运行与复核说明.md，其中本机工具路径需要按使用者环境调整。源数据引用见各 README；本目录不新增或改变源数据授权条款。
