"""中文科学图及逐记录核查图。"""
import json
import numpy as np,pandas as pd
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from dataio import ROOT
plt.rcParams.update({'font.sans-serif':['Microsoft YaHei','SimHei','DejaVu Sans'],'axes.unicode_minus':False,'font.size':10})
GROUPS=['HS','ST_paretic','ST_nonparetic'];LABELS=['健康优势侧','卒中患侧','卒中非患侧'];COLORS=['#4377A3','#C2603E','#589180']

def output(fig,name):
    fig.tight_layout();fig.savefig(ROOT/'figures'/name,dpi=160,bbox_inches='tight');plt.close(fig)

def main():
    s=pd.read_csv(ROOT/'results/subject_features.csv');t=pd.read_csv(ROOT/'results/transfer_features.csv')
    ts=t.groupby(['group','subject']).median(numeric_only=True).reset_index()
    fig,axs=plt.subplots(2,3,figsize=(12,7))
    for ax,(data,key,title) in zip(axs.flat,[(s,'reach_duration_s','接近球时长（秒）'),(ts,'reach_duration_s','物体搬运中段时长（秒）'),(ts,'approach_to_transfer_gap_s','接近结束至搬运中段间隔（秒）'),(s,'lateral_p95_deg','前伸上臂外侧分量 P95（度）'),(s,'BB_TB_cci','前伸 BB/TB 活动重叠'),(s,'AD_PD_cci','前伸三角肌前后束活动重叠')]):
        for i,(g,l,c) in enumerate(zip(GROUPS,LABELS,COLORS)):
            vals=data[data.group==g][key].to_numpy();ax.scatter(i+np.linspace(-.12,.12,len(vals)),vals,c=c,s=30)
            ax.plot([i-.2,i+.2],[np.median(vals)]*2,color='black',lw=2)
        ax.set_xticks(range(3),LABELS,fontsize=9);ax.set_title(title);ax.grid(axis='y',alpha=.2)
    fig.suptitle('每个点代表一名参与者的重复动作中位数',fontsize=14,y=1.01)
    output(fig,'group_comparison.png')
    c=pd.read_csv(ROOT/'results/subject_phase_muscle.csv');muscles=list(np.load(next((ROOT/'data_derived/processed').glob('*.npz')))['names'])
    fig,axs=plt.subplots(1,3,figsize=(12,6),sharey=True)
    for ax,g,label in zip(axs,GROUPS,LABELS):
        pivot=c[c.group==g].groupby(['muscle','phase']).normalized_mean.median().unstack().reindex(index=muscles,columns=['approach','handling','transfer','post_transfer'])
        im=ax.imshow(pivot,vmin=0,vmax=1,cmap='YlGnBu',aspect='auto');ax.set_title(label)
        ax.set_xticks(range(4),['接近','操作间隔','搬运中段','搬运后'],rotation=30);ax.set_yticks(range(12),muscles)
    fig.subplots_adjust(wspace=.13,right=.84)
    cax=fig.add_axes([.88,.2,.018,.6]);fig.colorbar(im,cax=cax,label='相对本通道整段 BA 活动 P95 的平均 RMS')
    fig.savefig(ROOT/'figures/all_channels.png',dpi=160,bbox_inches='tight');plt.close(fig)
    phases=pd.read_csv(ROOT/'results/phase_audit.csv');out=ROOT/'figures/records';out.mkdir(exist_ok=True)
    for record,rows in phases.groupby('record'):
        with np.load(ROOT/'data_derived/processed'/(record+'.npz')) as f:z={k:f[k] for k in f.files}
        fig,axs=plt.subplots(len(rows),2,figsize=(11,2.1*len(rows)),squeeze=False)
        for pair,(_,r) in zip(axs,rows.iterrows()):
            a=int(round(r.original_start_s*125));b=int(round(r.original_end_s*125));tt=np.arange(a,b+1)/125-r.original_start_s
            pair[0].plot(tt,z['speed'][a:b+1],color='#4377A3');pair[0].set_ylabel(f'重复{int(r.rep)}\n腕速 m/s')
            pair[1].plot(tt,z['obj'][a:b+1]-z['obj'][a]);pair[1].set_ylabel('物体位移 m')
            for ax in pair:
                ax.axvspan(r.reach_onset_s-r.original_start_s,r.reach_arrival_s-r.original_start_s,color='#7AB89E',alpha=.25)
                tr=t[(t.record==record)&(t.rep==r.rep)]
                if len(tr):
                    tr=tr.iloc[0];ax.axvspan(tr.transfer_start_s-r.original_start_s,tr.transfer_end_s-r.original_start_s,color='#E1AE60',alpha=.25)
                ax.set_xlabel('从原始 Start 起的时间（秒）');ax.grid(alpha=.2)
        fig.suptitle(record+'  绿色=估计接近段  黄色=物体搬运10–90%段',fontsize=12)
        fig.tight_layout(rect=[0,0,1,.97]);fig.savefig(out/(record+'.png'),dpi=100);plt.close(fig)
    # Selected reproducible illustrative examples, not a representative random sample.
    fig,axs=plt.subplots(3,1,figsize=(10,8))
    for ax,record in zip(axs,['HS01_DataULdom_BA','ST01_DataULpleg_BA','ST09_DataULnonpleg_BA']):
        with np.load(ROOT/'data_derived/processed'/(record+'.npz')) as f:z={k:f[k] for k in f.files}
        r=phases[(phases.record==record)&(phases.rep==1)].iloc[0];a=round(r.original_start_s*125);b=round(r.original_end_s*125)
        tt=np.arange(a,b+1)/125-r.original_start_s;ax.plot(tt,z['speed'][a:b+1],label='腕部速度')
        ax.axvspan(r.reach_onset_s-r.original_start_s,r.reach_arrival_s-r.original_start_s,alpha=.25,color='#7AB89E',label='估计接近段')
        tr=t[(t.record==record)&(t.rep==1)].iloc[0]
        ax.axvspan(tr.transfer_start_s-r.original_start_s,tr.transfer_end_s-r.original_start_s,alpha=.25,color='#E1AE60',label='搬运中段')
        ax.set_title(record+'  第1次');ax.set_ylabel('速度 m/s');ax.set_xlabel('相对时间（秒）');ax.grid(alpha=.2)
    axs[0].legend(ncol=3,fontsize=9);output(fig,'case_timelines.png')
    # Build a local, read-only evidence index.
    imgs=''.join(f'<h2>{p.stem}</h2><img src="../figures/records/{p.name}" style="max-width:100%">' for p in sorted(out.glob('*.png')))
    (ROOT/'docs/逐记录核查.html').write_text('<!doctype html><meta charset="utf-8"><title>BA逐记录核查</title><h1>149次动作的分期核查图</h1><p>绿色为估计接近段，黄色为物体搬运中段。算法分期尚未经独立人工标注验证。图中不存在正常或异常训练标签。</p>'+imgs,encoding='utf-8')
    print('Figures and record gallery saved')

if __name__=='__main__':main()
