"""使用 bundled Python 生成中文 Word。数字从本次结果读取。"""
from pathlib import Path
import json
import pandas as pd
from docx import Document
from docx.shared import Inches,Pt,RGBColor,Cm
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.enum.table import WD_TABLE_ALIGNMENT,WD_CELL_VERTICAL_ALIGNMENT

ROOT=Path(__file__).resolve().parents[1]
R=ROOT/'results';D=Document();sec=D.sections[0]
for style in D.styles:
    for border in list(style._element.iter(qn('w:pBdr'))):
        border.getparent().remove(border)
sec.page_width=Cm(21);sec.page_height=Cm(29.7)
sec.top_margin=Cm(1.8);sec.bottom_margin=Cm(1.8);sec.left_margin=Cm(2);sec.right_margin=Cm(2)
for name in ['Normal','Title','Subtitle','Heading 1','Heading 2','Caption']:
    s=D.styles[name];s.font.name='Calibri';s.font.color.rgb=RGBColor(0,0,0)
    s._element.get_or_add_rPr().rFonts.set(qn('w:eastAsia'),'微软雅黑')
D.styles['Normal'].font.size=Pt(10.5);D.styles['Normal'].paragraph_format.line_spacing=1.15
D.styles['Normal'].paragraph_format.space_after=Pt(6)
D.styles['Title'].font.size=Pt(24);D.styles['Heading 1'].font.size=Pt(16);D.styles['Heading 2'].font.size=Pt(12)
foot=sec.footer.paragraphs[0];foot.alignment=2
field=OxmlElement('w:fldSimple');field.set(qn('w:instr'),'PAGE');foot._p.append(field)

def p(text):D.add_paragraph(text)
def h(text):D.add_heading(text,level=1)
def sub(text):D.add_heading(text,level=2)
def page(title):D.add_page_break();h(title)
def picture(name,width=6.6):D.add_picture(str(ROOT/'figures'/name),width=Inches(width))
def table(headers,rows,widths=None):
    t=D.add_table(rows=1,cols=len(headers));t.alignment=WD_TABLE_ALIGNMENT.CENTER;t.autofit=False
    if widths:
        for c,w in zip(t.columns,widths):c.width=Cm(w)
    for i,x in enumerate(headers):t.rows[0].cells[i].text=str(x)
    for row in rows:
        cells=t.add_row().cells
        for i,x in enumerate(row):cells[i].text=str(x)
    for ri,row in enumerate(t.rows):
        for ci,cell in enumerate(row.cells):
            if widths:cell.width=Cm(widths[ci])
            cell.vertical_alignment=WD_CELL_VERTICAL_ALIGNMENT.CENTER
            tcPr=cell._tc.get_or_add_tcPr();b=OxmlElement('w:tcBorders')
            for edge in ['top','left','bottom','right']:
                el=OxmlElement('w:'+edge);el.set(qn('w:val'),'single');el.set(qn('w:sz'),'4');el.set(qn('w:color'),'D9D9D9');b.append(el)
            tcPr.append(b);sh=OxmlElement('w:shd');sh.set(qn('w:fill'),'DCE6EF' if ri==0 else ('F5F7F9' if ri%2==0 else 'FFFFFF'));tcPr.append(sh)
            mar=OxmlElement('w:tcMar')
            for edge in ['top','bottom','left','right']:
                e=OxmlElement('w:'+edge);e.set(qn('w:w'),'80');e.set(qn('w:type'),'dxa');mar.append(e)
            tcPr.append(mar)
            for para in cell.paragraphs:
                para.paragraph_format.space_after=Pt(2);para.paragraph_format.line_spacing=1.05
                for run in para.runs:run.font.size=Pt(9);run.bold=ri==0
        trPr=row._tr.get_or_add_trPr();trPr.append(OxmlElement('w:cantSplit'))
    t.rows[0]._tr.get_or_add_trPr().append(OxmlElement('w:tblHeader'))
    D.add_paragraph().paragraph_format.space_after=Pt(0)

summary=pd.read_csv(R/'group_summary.csv').set_index('metric')
subjects=pd.read_csv(R/'subject_features.csv');transfer=pd.read_csv(R/'transfer_features.csv')
bg=pd.read_csv(R/'background_sensitivity.csv');phase=pd.read_csv(R/'phase_audit.csv')
audit=pd.read_csv(R/'record_audit.csv')

D.add_heading('BA 全通道动作模式探索报告',0)
p('BME3201 项目阶段交付  |  2026年11月24日')
h('主要结论')
p('本研究完成了路线 A 的数据审计、预处理与分期、可解释候选模式探索。分析覆盖 10 名健康参与者和 10 名卒中参与者的 149 次 BA 动作，使用全部 12 路肌电。结果支持继续调查阶段耗时、部分患者的上臂外侧姿态和肌肉活动重叠，但尚不能建立可靠的正常／异常判定标准。')
table(['研究对象','本轮证据','当前判断'],[
 ['中途停顿与分段','接近球阶段 149 次均无默认规则下的持续低速区间；搬运中段仅非患侧 1 次出现候选区间','不支持患侧普遍卡顿'],
 ['上臂外侧姿态','4/10 患者的个人 P95 中位数高于健康样本最大个人中位数','部分病例值得复核，不能直接称代偿'],
 ['BB/TB 活动重叠','健康 0.546、患侧 0.644；9/10 患者患侧高于本人非患侧','存在探索信号，绝对值依赖背景与归一化'],
 ['阶段耗时','健康／患侧接近时长 0.516／0.736 秒，搬运中段 0.448／0.680 秒','优先复核阶段边界及慢动作来源']],[3.1,9.1,4.8])
p('表内数值均先对每位参与者的重复动作取中位数，再汇总。健康和患侧组各只有 10 个独立参与者。主要组差的 bootstrap 区间跨零，不能宣称已证实的总体差异。')
sub('本轮交付边界')
p('交付包含连续指标、候选低速区间、完整审计、全通道分阶段特征、中文图、可运行代码及 README 研究方案。未进行自动正常／异常打标、分类训练、通道筛选或临床诊断。算法分期和候选区间均未经独立人工标注验证。')
sub('建议的下一步')
p('优先复核较长操作间隔、静态外偏与动态绕行的区别，以及患侧／非患侧 BB/TB 差异。确认这些表现的可测性与意义之后，再决定标签定义和分类任务。')

page('数据审计与全通道覆盖')
p('原始文件位于 F:/dataset/dataset。20 个 MAT 文件包含 180 条侧别任务记录、897 个原始重复事件；本轮只分析 BA。原文件只读，逐文件 SHA256 和导出字段名另存以支持追溯。[1–3]')
table(['侧别组','参与者','BA 次数','年龄区间中点中位数'],[['健康优势侧','10','50','55.0 岁'],['卒中患侧','10','50','79.5 岁'],['卒中非患侧','同一批 10 人','49','79.5 岁']],[4.5,3,3,6.5])
p('全部记录运动学为 125 Hz、EMG 为 1000 Hz。患侧 L_CA 分布为 3 级 4 人、4 级 2 人、5 级 4 人，未覆盖 1–2 级；非患侧不是额外的独立受试者，也不等于健康。')
table(['范围','原始肌电名称'],[['肩部','DELPOS、DELML、DELANT'],['肘部','TRICP、BICEP'],['腕部','FLXCRR、EXTCRR'],['手指及手内在肌','FLXDIGS、EXTDIGC、ABDPOL、FDORS、ADDMIG']],[4.5,12.5])
p('ADDMIG 保留源字段名称，论文对应列表列为小指展肌。全部 12 通道均进入处理与阶段活动汇总；仅四个具有生理解释的配对计算重叠，不把所有通道任意配成拮抗肌。')
sub('与论文描述不同的文件事实')
p('原坐标按毫米解释，转成米后肩宽约 0.252–0.396 m；论文表格标为 m，而作者绘图脚本标作 mm。文件实际有 19 行角度，表格写 20 行。本地缺少一次 BA 的是 ST07 非患侧，ST08 两侧均有 5 次。均以本地 Events 和字段为准，发表前应向作者核实。')
p('运动学与肌电记录总时长差为 -0.024 至 +0.108 秒。本轮按共同起点与采样率对齐，不拉伸信号；该长度差不能证明同等大小的同步偏移。所有处理保留原始事件位置，并另做 ±100 ms 敏感性检查。')
p('部分完整记录存在缺失，EMG 缺失比例最高约 8.25%；但纳入的 149 个接近段、12 路原始肌电样本均为有限值。完整记录质量与选定阶段可用性分开审计，不声称原数据完全无缺失。')

page('预处理与阶段定义')
sub('离线信号处理')
p('运动学仅线性填补两端有效且不超过 80 ms 的缺失，较长缺失不填；随后进行 4 阶 6 Hz 双向低通。腕点为尺骨和桡骨茎突中点，腕速由其位置导数求得。上臂外侧方向由双肩连线确定，左右侧统一为朝肢体外侧。')
p('肌电采用 4 阶 20–450 Hz 双向带通及 50 ms 居中 RMS。各通道以本条侧别 BA 全部动作样本 RMS 的 P95 归一化，P99 为敏感性对照。该参考不是 MVC，归一化值不能解释为肌力百分比。静息参考取各 Start 前 0.50–0.05 秒，不能保证患者完全放松。')
table(['阶段','可执行定义','解释边界'],[
 ['接近球','物体持续位移超过 10 mm 前，腕点首次进入最近距离＋20 mm；起点用局部峰速 5% 持续 80 ms','可能截掉末端修正'],
 ['操作间隔','接近结束至物体搬运中段起点','混合抓取、准备及搬运早期'],
 ['搬运中段','首次到位平台方向上的物体进度 10%–90%','不是完整的抬放阶段'],
 ['搬运后','搬运中段结束至原始 End','混合减速、放置、释放和返回']],[3,9,5])
p('暂定到位平台定义为物体位移超过 150 mm 后，物体速度小于 30 mm/s 且持续至少 300 ms。使用首次平台，避免试次末尾物体或标记点移动将返回动作混入搬运。初步核查发现的这类失败已用于修正算法，因此所有结果仍属于开发集探索。')
sub('指标定义')
p('低速候选区间只在阶段中间 80% 内检索：速度低于 max(0.005 m/s，阶段峰速×10%)，持续至少 0.25 秒。速度峰要求突出度达到峰速 15%、间隔至少 150 ms。路径比为实际路径长度除以首末点距离。')
p('上臂外侧分量是上臂单位向量与外侧肩轴的点积取 arcsin，使用阶段 P95 与相对起点增量。它不等于完整解剖肩外展角。活动重叠采用 2×Σmin(x,y)/Σ(x+y)，x、y 为归一化 RMS；公式和归一化均需固定，不套用文献阈值。[4]')

page('个体分布与组间描述')
picture('group_comparison.png')
p('图1 每个点是一名参与者的同侧重复动作中位数，黑线是组中位数。非患侧用于配对补充。可见患者异质性明显，健康与患侧大量重叠，不能按组身份赋予动作正常／异常标签。')
rows=[]
for key,label in [('reach_duration_s','接近时长 秒'),('lateral_p95_deg','外侧分量 P95 度'),('BB_TB_cci','BB/TB 重叠'),('AD_PD_cci','AD/PD 重叠')]:
    q=summary.loc[key];rows.append([label,f'{q.HS_median:.3f}',f'{q.paretic_median:.3f}',f'{q.median_difference:.3f}',f'[{q.bootstrap_low:.3f}, {q.bootstrap_high:.3f}]'])
table(['指标','健康','患侧','差值','探索性 95% 区间'],rows,[4.1,2.2,2.2,2.2,6.3])
p('区间来自 3000 次按参与者重抽样的中位数差 bootstrap，种子 20261124。没有多重性校正，也不作为显著指标筛选依据。样本年龄分布不匹配，组差不能归因于卒中本身。')

page('三个候选问题的实测判断')
sub('停顿与运动分段')
p('接近球阶段：默认规则在健康 50 次、患侧 50 次、非患侧 49 次均未检出持续低速区间。改变物体位移阈值 5/10/20 mm、速度阈值 5%/10%/15%、持续时间 0.15/0.25/0.40 秒，接近阶段仍未检出。')
p('搬运中段：默认规则仅在 ST03 非患侧第 1 次检出 0.504 秒候选区间，源记录时间 7.976–8.480 秒。患侧 50 次中未检出。该个例需结合物体轨迹复核，不作为卒中共性。阶段之间的低速与末端微调未纳入这个窄定义，因此不能推断整次 BA 完全无停顿或无分段。')
sub('上臂外侧姿态与绕行')
table(['患者','外侧分量 P95 度','相对起点变化 度'],[[r.subject,f'{r.lateral_p95_deg:.2f}',f'{r.lateral_change_deg:.2f}'] for _,r in subjects[(subjects.group=='ST_paretic')&subjects.subject.isin(['ST02','ST03','ST06','ST07'])].iterrows()],[4,6.5,6.5])
p('这四人的个人 P95 中位数高于本样本健康个人中位数的最大值 36.13°。但 ST07 增量约 -0.06°，说明主要可能是起始姿态外偏，不能直接叫动态绕行。患侧与本人非患侧比较，仅 6/10 外侧分量更高，提示姿态和个体因素不可忽略。')
sub('BB/TB 与其他肌对的活动重叠')
p('BB/TB 患侧组中位数较高，9/10 患者患侧高于本人非患侧，但所有患侧个人中位数均落在健康个人中位数范围内。FCR/ECR 未呈现同样的统一升高方向。AD/PD 有偏高趋势，但非患侧也偏高。应保留多肌对证据，暂不将重叠升高称为肌肉代偿。')
sub('新增候选观察')
p('阶段耗时比二元停顿更值得优先研究。患侧接近结束至搬运中段间隔中位数 0.824 秒，健康 0.492 秒；ST09 患侧个人中位数约 3.34 秒。这个间隔仍混合多个动作，需要独立分期后才能区分抓取困难、准备和早期搬运。')

page('全部十二通道的阶段活动')
picture('all_channels.png')
p('图2 每格先取个人同侧重复的阶段归一化 RMS 中位数，再取组中位数。颜色表示相对本通道整段 BA P95 的活动，不是绝对肌力；跨通道颜色不能直接比较肌肉贡献。搬运后区间混合多种行为。')
p('全部 12 路均保留。手指和手内在肌在操作间隔中提供了原六通道设计之外的信息；这些阶段差异可用于后续观察，但不能从组热图确定通道必要性。当前不根据十名患者的相关性删减通道。')
table(['活动重叠对','健康原值','患侧原值','健康扣背景','患侧扣背景'],[
 [pair.replace('_','/'),f'{summary.loc[pair+"_cci"].HS_median:.3f}',f'{summary.loc[pair+"_cci"].paretic_median:.3f}',
  f'{bg[(bg.group=="HS")&(bg.pair==pair)].groupby("subject").background_subtracted_cci.median().median():.3f}',
  f'{bg[(bg.group=="ST_paretic")&(bg.pair==pair)].groupby("subject").background_subtracted_cci.median().median():.3f}'] for pair in ['BB_TB','FCR_ECR','FDS_EDC','AD_PD']],[4.2,3.2,3.2,3.2,3.2])
p('扣背景用 max(RMS−静息中位数,0) 重算，并相应调整参考尺度。BB/TB 绝对值变化很大，说明背景处理是关键。三头肌在部分接近段接近静息活动，不能把所有计算得到的重叠都解释为有效共同收缩。扣背景也只是敏感性方法，不是已验证的真实神经驱动估计。')

page('动作时间线与分期复核')
picture('case_timelines.png')
p('图3 选择 HS01 优势侧、ST01 患侧和 ST09 非患侧各第 1 次作为说明性案例，不是随机代表样本。绿色为估计接近段，黄色为搬运中段。完整 BA 自然具有多个速度峰，不能把完整动作的峰数直接解释为异常分段。')
p('ST01 显示更长的操作和搬运后时段。ST09 非患侧说明首次到位平台的重要性：若直接使用试次末尾物体位置定义目标，可能把后续物体变化混入搬运并产生假性停顿。最终方法已改为首次平台，但仍需独立边界标注。')
p('docs/逐记录核查.html 链接全部 30 条记录、149 次动作的腕速与物体位移图，便于逐次复查。当前仅完成算法开发中的曲线核查，没有康复师标注，也没有计算分期准确率。')

page('敏感性与证据限制')
table(['检查','本轮做法','解释'],[
 ['运动参数','物体 5/10/20 mm；低速比例 5/10/15%；持续 0.15/0.25/0.40 秒','接近段无持续低速结论在该网格内一致'],
 ['肌电归一化','P95 与 P99','可改变重叠绝对值，需冻结参考方法'],
 ['时间对齐','肌电窗口前后移动 100 ms','不是估计真实同步误差'],
 ['背景活动','静息 RMS 扣除与不扣除','重叠绝对值明显依赖背景'],
 ['参与者统计','每人中位数及 3000 次 bootstrap','避免把重复动作当独立样本']],[3.2,7.1,6.7])
p('1. 本轮查看了全部公共数据，并在曲线核查后修正分期，因此所有结果都是发现阶段证据。没有独立测试集，不能报告模型泛化能力。')
p('2. 接近段结束基于物体距离代理，可能排除患者的末端修正；搬运只取 10%–90%，不覆盖全部停顿情境。零检出是当前定义下的结果，不是病理现象不存在。')
p('3. 全部通道的相对活动使用同一 BA 记录作参考。较长操作或保持阶段可能影响 P95，也可能导致归一化活动与时长的数学耦合。探索相关系数只供提出假设，不能作为生理因果证据。')
p('4. 低肌电活动、串扰、贴位和归一化均可能影响 CCI。四对重叠只描述记录信号的相似活动，不能独立诊断痉挛、肌力不足、疼痛或肌肉代偿。')
p('5. 年龄、能力等级和个体姿态与组别混杂。非患侧可能也受卒中影响；没有健康非优势侧或年龄匹配对照。当前小样本极值不能用作正常上限。')
p('6. 没有明确提示时间，不能估计指令反应延迟。零相位滤波和居中 RMS 为离线处理，后续实时系统需要重新验证因果处理、延迟和 IMU 迁移。')

page('交付文件与后续研究方案')
sub('后续优先级')
p('第一，复核阶段边界与较长操作间隔，判断是否需要增加抓取、抬起、放置和释放的独立标注。第二，分清较大的起始外偏与动作中的外偏增量，决定是否存在可重复的动态绕行。第三，结合有效肌电活动复核 BB/TB 配对差异，再考虑其他肌对。')
p('本轮不进行打标和分类。下一阶段须先约定每种模式的操作定义、独立评价者、分歧处理和不可评估条件。若继续训练，按受试者划分数据，同一人的双侧和所有任务不得跨组；参考估计、模式发现和调参均放在训练折内。公共数据已经全量探索，最终确认优先采用新患者。')
table(['交付','用途'],[['README.md','研究方案、指标定义、复现入口和当前结论'],['src/ 与 tests/','分模块代码及 6 个计算边界测试'],['results/','连续特征、阶段审计、全通道指标和敏感性结果'],['figures/ 与核查 HTML','组图及全部重复动作核查'],['data_derived/','原生名称导出的 BA 与预处理缓存']],[5,12])
p('已通过：149 个唯一试次、1788 条接近段肌肉记录、12 通道完整覆盖、阶段时间顺序、连续指标有限性及 CCI 范围检查。测试验证实现边界，不证明临床有效性。原数据文件未修改。')
sub('参考文献与数据来源')
p('[1] Lucchetti F, et al. A Kinematic and EMG Dataset for Upper Limb and Hand Movement Analysis in Post-Stroke and Healthy Subjects. Scientific Data. 2025. DOI: 10.1038/s41597-025-06174-3.')
p('[2] Figshare 数据集合，版本 1。https://figshare.com/collections/7720187/1 。本地 MAT 文件 SHA256 见 results/source_manifest.json。')
p('[3] 作者绘图脚本 upperlimb_fig.m。DOI: 10.6084/m9.figshare.28596131.v1。用于核对源字段和单位说明。')
p('[4] Bandini V, et al. Surface-Electromyography-Based Co-Contraction Index for Monitoring Upper Limb Improvements in Post-Stroke Rehabilitation. Sensors. 2023;23:7320. DOI: 10.3390/s23177320。仅提供指标研究背景，本报告不复用其异常阈值。')
D.core_properties.title='BA 全通道动作模式探索报告';D.core_properties.subject='路线 A 步骤 1–3';D.core_properties.author='BME3201 项目'
out=ROOT/'docs/BA全通道模式探索报告.docx';D.save(out);print(out)
