"""生成 B 路线图、受试者频次和可复现性检查。"""
import json
import numpy as np,pandas as pd
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from discover import OUT
plt.rcParams.update({'font.sans-serif':['Microsoft YaHei','SimHei','DejaVu Sans'],'axes.unicode_minus':False,'font.size':10})

def main():
    raw=pd.read_csv(OUT/'results/segment_membership.csv');adj=pd.read_csv(OUT/'results/phase_control_membership.csv')
    fig,axes=plt.subplots(2,2,figsize=(11,8))
    for row,(data,title) in enumerate([(raw,'原始片段'),(adj,'控制阶段位置')]):
        for col,phase in enumerate(['approach','transfer']):
            d=data[(data.phase==phase)&(data.fit_role=='discovery')];ax=axes[row,col]
            for g,color,label in [('HS','#4377A3','健康'),('ST_paretic','#C2603E','患侧')]:
                q=d[d.group==g];ax.scatter(q.PC1,q.PC2,c=color,s=14,alpha=.55,label=label)
            ax.set_title(title+' '+('接近球' if phase=='approach' else '搬运中段'));ax.set_xlabel('PC1');ax.set_ylabel('PC2');ax.legend();ax.grid(alpha=.15)
    fig.tight_layout();fig.savefig(OUT/'figures/PCA_comparison.png',dpi=170);plt.close(fig)
    d=adj[(adj.phase=='transfer')&(adj.fit_role=='discovery')];counts=d.groupby(['subject','group','cluster_id']).size().unstack(fill_value=0)
    counts.to_csv(OUT/'results/transfer_subject_counts.csv',encoding='utf-8-sig')
    repeats=d.groupby(['subject','group','cluster_id']).rep.nunique().unstack(fill_value=0);repeats.to_csv(OUT/'results/transfer_trial_coverage.csv',encoding='utf-8-sig')
    fig,ax=plt.subplots(figsize=(11,4.2));xx=np.arange(len(counts));bottom=np.zeros(len(counts))
    for c,color in [(0,'#8BB5CF'),(1,'#D89B79')]:
        ax.bar(xx,counts[c],bottom=bottom,label=f'群组 {c}',color=color);bottom+=counts[c]
    ax.set_xticks(xx,counts.index.get_level_values('subject'),rotation=45);ax.set_ylabel('片段数（每人15段）');ax.set_title('控制阶段位置后的搬运群组覆盖');ax.legend(ncol=2);fig.tight_layout();fig.savefig(OUT/'figures/subject_coverage.png',dpi=170);plt.close(fig)
    fig,axs=plt.subplots(1,2,figsize=(11,4))
    for ax,phase in zip(axs,['approach','transfer']):
        for prefix,label,color in [('', '原始片段','#4377A3'),('phase_control_', '控制阶段位置','#C2603E')]:
            fname='cluster_selection.csv' if not prefix else 'phase_control_selection.csv'
            q=pd.read_csv(OUT/'results'/fname);q=q[q.phase==phase];ax.plot(q.k,q.silhouette,'o-',label=label,color=color)
        ax.set_title('接近球' if phase=='approach' else '搬运中段');ax.set_xlabel('群组数量 k');ax.set_ylabel('轮廓系数');ax.set_xticks(range(2,6));ax.legend();ax.grid(alpha=.2)
    fig.tight_layout();fig.savefig(OUT/'figures/cluster_selection.png',dpi=170);plt.close(fig)
    checks=[]
    for prefix,filename,data in [('', 'method_and_models.json',raw),('phase_control_', 'phase_control_models.json',adj)]:
        meta=json.loads((OUT/'results'/filename).read_text())
        for model in meta['phases']:
            q=data[data.phase==model['phase']];x=q[model['feature_names']].to_numpy()
            if prefix:x=x-np.array(model['position_centers'])[q.position.to_numpy().astype(int)-1]
            z=np.clip((x-np.array(model['scale_center']))/np.array(model['scale_iqr']),-4,4)*np.array(model['weights'])
            u=(z-np.array(model['pca_mean']))@np.array(model['pca_components']).T
            y=np.argmin(((u[:,None,:]-np.array(model['centers'])[None,:,:])**2).sum(axis=2),axis=1)
            assert np.array_equal(y,q.cluster_id.to_numpy())
            fit=q[q.fit_role=='discovery'];assert fit.subject.nunique()==20 and len(fit)==300
            assert not (fit.group=='ST_nonparetic').any()
            assert fit.groupby('subject').size().eq(15).all()
            checks.append(dict(variant=prefix or 'raw',phase=model['phase'],saved_model_reproduces_membership=True,balanced_subjects=20,segments=300))
    (OUT/'results/validation.json').write_text(json.dumps(checks,indent=2),encoding='utf-8')
    print('B model reconstruction and subject balance checks passed')
    for phase,g in pd.read_csv(OUT/'results/phase_control_stability.csv').groupby('phase'):print(phase,g.ARI.quantile([0,.25,.5,.75,1]).to_dict())

if __name__=='__main__':main()
