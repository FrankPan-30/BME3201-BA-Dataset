"""阶段位置控制：在每个前/中/后三分段内去除池化中位数，不使用组别标签。"""
import os
os.environ.setdefault('OMP_NUM_THREADS','1')
import json
import numpy as np,pandas as pd
from sklearn.metrics import silhouette_score,adjusted_rand_score,normalized_mutual_info_score
from threadpoolctl import threadpool_limits
from discover import OUT,SEED,fit_pipeline,predict

def fit(x,pos,k,seed):
    centers=np.stack([np.median(x[pos==i],axis=0) for i in [1,2,3]])
    model,u,y=fit_pipeline(x-centers[pos-1],k,seed)
    return (centers,model),u,y

def apply(model,x,pos):return predict(model[1],x-model[0][pos-1])

def main():
    df=pd.read_csv(OUT/'results/segments.csv');features=[k for k in df if k.startswith('emg_') or k.startswith('kin_')]
    members=[];summaries=[];scores=[];stabilities=[];profiles=[];models=[];ablations=[]
    for phase in ['approach','transfer']:
        d=df[(df.phase==phase)&(df.group!='ST_nonparetic')].copy().reset_index(drop=True)
        assert d.groupby('subject').size().nunique()==1
        x=d[features].to_numpy();pos=d.position.to_numpy().astype(int);solutions={};local=[]
        for k in range(2,6):
            model,u,y=fit(x,pos,k,SEED);sil=float(silhouette_score(u,y));solutions[k]=(model,u,y)
            local.append(dict(phase=phase,k=k,silhouette=sil,pca_variance=float(model[1][2].explained_variance_ratio_.sum())))
        best=max(local,key=lambda r:r['silhouette'])['k'];model,u,y=solutions[best]
        for q in local:q['selected']=q['k']==best
        scores+=local;rng=np.random.default_rng(SEED);subjects=np.array(sorted(d.subject.unique()))
        for b in range(30):
            keep=rng.choice(subjects,16,replace=False);mask=d.subject.isin(keep).to_numpy()
            boot,_,_=fit(x[mask],pos[mask],best,SEED+b);py,_=apply(boot,x,pos)
            stabilities.append(dict(phase=phase,repeat=b,ARI=float(adjusted_rand_score(y,py)),omitted_subjects=';'.join(sorted(set(subjects)-set(keep)))))
        med=float(np.median([q['ARI'] for q in stabilities if q['phase']==phase]))
        for name,cols in [('EMG_only',features[:24]),('kinematics_only',features[24:])]:
            _,uu,yy=fit(d[cols].to_numpy(),pos,best,SEED)
            ablations.append(dict(phase=phase,feature_set=name,ARI_vs_joint=float(adjusted_rand_score(y,yy)),silhouette=float(silhouette_score(uu,yy))))
        d['cluster_id']=y;d['PC1']=u[:,0];d['PC2']=u[:,1];d['fit_role']='discovery';members+=d.to_dict('records')
        ext=df[(df.phase==phase)&(df.group=='ST_nonparetic')].copy();yy,uu=apply(model,ext[features].to_numpy(),ext.position.to_numpy().astype(int))
        ext['cluster_id']=yy;ext['PC1']=uu[:,0];ext['PC2']=uu[:,1];ext['fit_role']='projection_only';members+=ext.to_dict('records')
        scaled=np.clip(model[1][0].transform(x-model[0][pos-1]),-4,4)
        for cluster,g in d.groupby('cluster_id'):
            counts=g.groupby('subject').size()
            summaries.append(dict(phase=phase,cluster_id=int(cluster),segments=len(g),subjects=g.subject.nunique(),
                patients=g[g.group=='ST_paretic'].subject.nunique(),healthy_subjects=g[g.group=='HS'].subject.nunique(),
                patient_segment_fraction=float(np.mean(g.group=='ST_paretic')),maximum_subject_share=float(counts.max()/len(g)),
                median_stability_ARI=med,position1_fraction=float(np.mean(g.position==1)),position2_fraction=float(np.mean(g.position==2)),position3_fraction=float(np.mean(g.position==3))))
            for j,n in enumerate(features):profiles.append(dict(phase=phase,cluster_id=int(cluster),feature=n,median_raw=float(g[n].median()),median_robust_scaled=float(np.median(scaled[y==cluster,j]))))
        models.append(dict(phase=phase,k=best,median_stability_ARI=med,NMI_subject=float(normalized_mutual_info_score(d.subject,y)),
            NMI_position=float(normalized_mutual_info_score(d.position,y)),NMI_group=float(normalized_mutual_info_score(d.group,y)),
            position_centers=model[0].tolist(),feature_names=features,
            scale_center=model[1][0].center_.tolist(),scale_iqr=model[1][0].scale_.tolist(),weights=model[1][1].tolist(),
            pca_components=model[1][2].components_.tolist(),pca_mean=model[1][2].mean_.tolist(),centers=model[1][3].cluster_centers_.tolist()))
        print(phase,'k',best,'stability',med,flush=True)
    for name,rows in [('selection',scores),('membership',members),('summary',summaries),('stability',stabilities),('profiles',profiles),('modality',ablations)]:
        pd.DataFrame(rows).to_csv(OUT/'results'/('phase_control_'+name+'.csv'),index=False,encoding='utf-8-sig')
    (OUT/'results/phase_control_models.json').write_text(json.dumps(dict(seed=SEED,method='pooled median subtraction within each relative phase position, no group labels in fitting',phases=models),indent=2),encoding='utf-8')

if __name__=='__main__':
    with threadpool_limits(limits=1):main()
