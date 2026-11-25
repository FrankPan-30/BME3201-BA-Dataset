"""中文 B 补充报告，沿用 A 报告的排版样式。"""
from pathlib import Path
from docx import Document
from docx.shared import Inches,Pt
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
import pandas as pd
ROOT=Path(__file__).resolve().parents[2];OUT=ROOT/'route_b'
D=Document(ROOT/'docs/BA全通道模式探索报告.docx')
for node in list(D._element.body):
    if node.tag!=qn('w:sectPr'):D._element.body.remove(node)
def p(s):D.add_paragraph(s)
def h(s):D.add_heading(s,1)
def sub(s):D.add_heading(s,2)
def page(s):D.add_page_break();h(s)
def pic(name):D.add_picture(str(OUT/'figures'/name),width=Inches(6.6))
def table(head,rows):
    t=D.add_table(rows=1,cols=len(head))
    for c,s in zip(t.rows[0].cells,head):c.text=s
    for row in rows:
        for c,s in zip(t.add_row().cells,row):c.text=str(s)
    for ri,row in enumerate(t.rows):
        for cell in row.cells:
            pr=cell._tc.get_or_add_tcPr();b=OxmlElement('w:tcBorders')
            for edge in ['top','bottom','left','right']:
                e=OxmlElement('w:'+edge);e.set(qn('w:val'),'single');e.set(qn('w:sz'),'4');e.set(qn('w:color'),'D9D9D9');b.append(e)
            pr.append(b);s=OxmlElement('w:shd');s.set(qn('w:fill'),'DCE6EF' if ri==0 else 'FFFFFF');pr.append(s)
            for para in cell.paragraphs:
                para.paragraph_format.space_after=Pt(4);para.paragraph_format.space_before=Pt(4)
                for run in para.runs:run.font.size=Pt(9);run.bold=ri==0
        row._tr.get_or_add_trPr().append(OxmlElement('w:cantSplit'))
    t.rows[0]._tr.get_or_add_trPr().append(OxmlElement('w:tblHeader'))
    p('')
D.add_heading('路线 B 探索与 A B 对比报告',0)
p('BME3201 全通道 BA 项目  |  2026年11月24日')
h('主要发现')
p('路线 B 已完成无监督片段探索。原始聚类主要识别了动作内部的自然时序；控制阶段位置后，搬运中段出现一个较慢、速度波动较大、外侧姿态偏大的组合群组。它覆盖多名患者，但也出现在健康参与者中，尚不能解释为卒中特异异常或肌肉代偿。')
table(['版本','接近球','搬运中段'],[['原始片段 B1','k=2，轮廓系数0.210\n稳定性ARI中位数1.000','k=2，轮廓系数0.246\n稳定性ARI中位数0.987'],['控制阶段位置 B2','k=5，轮廓系数0.171\n稳定性ARI中位数0.511','k=2，轮廓系数0.231\n稳定性ARI中位数0.819'],['解释','B1主要是早晚差异\nB2细分群组不够稳定','B2慢搬运组合值得复核\n仍非临床异常类别']])
sub('研究范围')
p('使用与 A 相同的20人数据、预处理和全部12路肌电。每个接近和搬运阶段划分前中后三个片段。主发现每阶段300段，20人每人15段；非患侧每阶段147段仅作投影。合计894段，但独立参与者仍为20人。')
p('每段30个特征，包括12通道各自的RMS均值和波动共24项，以及6项运动学。稳健标准化后截断至±4，按模态维度平方根平衡权重，8维PCA后进行KMeans。k从2至5按轮廓系数选择，未使用健康／卒中身份拟合。')
p('B2在每个相对位置扣除主发现参与者的池化特征中位数，不使用健康身份作为参考。每次重拟合重新估计位置中位数、尺度、PCA和群组。群组编号是探索工具，不是正常／异常标签；本轮没有分类训练。')

page('自然时序与群组稳定性')
pic('PCA_comparison.png')
p('图1 PCA前两维仅用于展示，实际聚类使用8维。颜色为拟合完成后的健康／患侧身份，用于检查混杂，未作为聚类目标。两组有大量重叠；二维分离或聚类稳定均不能替代临床验证。')
p('B1接近群组0有95.2%来自前段，搬运群组0有84.2%来自后段。群组与相位位置的NMI分别为0.643、0.512，与人群身份仅0.001、0.003。稳定聚类在这里主要代表稳定的动作时序。')
p('B2明显降低了阶段位置关联。接近球分组的ARI中位数0.511，四分位范围0.417–0.700；其中一群41.7%片段来自同一人，不适合直接建立共性模式库。搬运ARI中位数0.819，四分位范围0.613–0.881，但最低仅0.380，说明样本组成仍影响结果。')

page('搬运组合模式及反例')
pic('subject_coverage.png')
p('图2 控制阶段位置后的搬运群组。每人贡献15段，群组1覆盖8名患者和5名健康参与者。8名患者均在至少3次动作中出现群组1片段；HS09也有14/15段属于该群组，是必须保留的反例。')
table(['片段特征中位数','群组0','群组1'],[['腕速 m/s','0.838','0.470'],['腕速波动系数','0.126','0.162'],['上臂外侧分量 度','39.46','42.75'],['腕伸肌归一化RMS','0.515','0.672'],['BB归一化RMS','0.448','0.534']])
p('群组1有94个主发现片段，其中74个来自患者，占78.7%；单一参与者最大贡献14.9%。这些是样本内组成和片段描述，不是阳性预测值、敏感度或临床患病率。群组0也不是正常类别。')
p('只用运动学的聚类与联合结果ARI为0.881，只用EMG为0.241。这说明当前组合主要由运动学驱动。较高腕伸肌和BB活动是相伴特征，不能据此断定肌肉代偿，也没有证明肌电带来独立增量。')

page('A B 路线比较与后续方案')
table(['比较项','路线A','路线B'],[['主要产物','带单位的连续指标与时间区间','相似片段群组及特征组合'],['本轮发现','部分患者阶段耗时、外侧姿态、BB/TB差异','控制阶段后出现较慢搬运组合'],['主要风险','定义过窄漏掉末端修正等行为','将阶段、速度或个人差异误称异常'],['建议角色','主分析与可解释报告','补充提出待复核组合假设']])
sub('稳定性检查的边界')
p('每阶段30次随机保留16/20名主发现参与者，重新拟合后对全体片段投影，与全量参考分组比较ARI。该值反映样本组成敏感性，不是独立测试准确率。参与者、片段及全量参考均有重叠，不能据此宣称泛化。')
p('阶段位置控制是在观察到B1时序主导后增加的探索步骤，两版均保留。年龄、动作速度、个体姿势、肌电背景及阶段边界仍可能影响群组。等相位片段长度不同，RMS波动也可能受时长影响。全部公共数据已用于开发，需要新数据确认。')
sub('下一阶段')
p('建议以A为主线，B为补充。优先复核慢搬运群组的患者与健康反例，加入速度和年龄匹配检查；同时区分静态起始外偏与动态绕行，检查有效肌电活动。只有独立复核支持清晰的模式定义时，才进入弱标签或分类训练。当前继续保留全部12通道。')
p('若后续训练，模式选择、参考拟合和调参全部放在训练折内，同一参与者的双侧与任务不跨折。比较运动学、EMG和联合输入的增量，再决定是否保留教师学生框架或缩减硬件通道。')
sub('交付与来源')
p('双路线方案见根目录PROPOSAL.md；B代码、结果和图独立保存在route_b。保存的归一化、PCA、群组中心已通过重建检查，可精确复现全部分组；20人每阶段等量贡献以及非患侧仅投影也已检查。')
p('数据来源：Lucchetti et al., Scientific Data, 2025，DOI 10.1038/s41597-025-06174-3；Figshare集合 https://figshare.com/collections/7720187/1 。源数据审计与方法限制详见A报告。B结果由本地真实数据计算。')
D.core_properties.title='路线 B 探索与 A B 对比报告'
out=OUT/'docs/B路线探索与AB对比报告.docx';D.save(out);print(out)
