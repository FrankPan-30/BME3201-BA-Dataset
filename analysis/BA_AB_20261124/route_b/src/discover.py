"""路线 B：全通道多模态无监督片段聚类。群组编号不是正常/异常标签。"""
import sys,json,os
os.environ.setdefault('OMP_NUM_THREADS','1')
from pathlib import Path
import numpy as np,pandas as pd
from sklearn.preprocessing import RobustScaler
from sklearn.decomposition import PCA
from sklearn.cluster import KMeans
from sklearn.metrics import silhouette_score,adjusted_rand_score,normalized_mutual_info_score
from threadpoolctl import threadpool_limits
ROOT=Path(__file__).resolve().parents[2];OUT=ROOT/'route_b';sys.path.insert(0,str(ROOT/'src'))
from signal_ops import cci
from dataio import PAIRS
SEED=20261124

def extract():
    ph=pd.read_csv(ROOT/'results/phase_audit.csv');tr=pd.read_csv(ROOT/'results/transfer_features.csv');rows=[]
    for record,g in ph.groupby('record'):
        with np.load(ROOT/'data_derived/processed'/(record+'.npz')) as f:z={k:f[k] for k in f.files}
        names=list(z['names']);e=z['env']/z['scale95'][:,None]
        for _,r in g.iterrows():
            t=tr[(tr.record==record)&(tr.rep==r.rep)]
            if t.empty:continue
            t=t.iloc[0]
            for phase,a,b in [('approach',r.reach_onset_s,r.reach_arrival_s),('transfer',t.transfer_start_s,t.transfer_end_s)]:
                edges=np.linspace(round(a*125),round(b*125)+1,4).astype(int)
                for pos,(start,end) in enumerate(zip(edges[:-1],edges[1:]),1):
                    if end-start<8:continue
                    row=dict(record=record,subject=r.subject,group=r.group,rep=int(r.rep),phase=phase,position=pos,
                             start_s=start/125,end_s=end/125,segment_duration_s=(end-start)/125)
                    x=e[:,start:end]
                    for j,n in enumerate(names):
                        row['emg_mean_'+n]=float(np.nanmean(x[j]))
                        row['emg_cv_'+n]=float(np.nanstd(x[j])/(np.nanmean(x[j])+.05))
                    row.update(kin_speed_mean=float(np.mean(z['speed'][start:end])),
                        kin_speed_cv=float(np.std(z['speed'][start:end])/(np.mean(z['speed'][start:end])+.01)),
                        kin_lateral_mean=float(np.mean(z['lateral'][start:end])),
                        kin_elbow_mean=float(np.mean(z['elbow'][start:end])),
                        kin_elbow_velocity=float((z['elbow'][end-1]-z['elbow'][start])/((end-start)/125)),
                        kin_lateral_velocity=float((z['lateral'][end-1]-z['lateral'][start])/((end-start)/125)))
                    rows.append(row)
    d=pd.DataFrame(rows);d.to_csv(OUT/'results/segments.csv',index=False,encoding='utf-8-sig');return d

def fit_pipeline(x,k,seed=SEED):
    scale=RobustScaler().fit(x);a=np.clip(scale.transform(x),-4,4)
    # Equal total input weight for the EMG and kinematic feature blocks.
    weights=np.ones(x.shape[1])
    if x.shape[1]==30:weights[:24]/=np.sqrt(24);weights[24:]/=np.sqrt(6)
    pca=PCA(n_components=min(8,x.shape[1]),svd_solver='full').fit(a*weights)
    u=pca.transform(a*weights);km=KMeans(n_clusters=k,n_init=30,random_state=seed).fit(u)
    return (scale,weights,pca,km),u,km.labels_

def predict(model,x):
    scale,w,pca,km=model;u=pca.transform(np.clip(scale.transform(x),-4,4)*w)
    return km.predict(u),u

def main():
    data=extract();features=[k for k in data if k.startswith('emg_') or k.startswith('kin_')]
    assert len(features)==30
    selections=[];members=[];clusters=[];stability=[];ablations=[];profiles=[];details=[]
    for phase in ['approach','transfer']:
        d=data[(data.phase==phase)&(data.group!='ST_nonparetic')].copy().reset_index(drop=True)
        # All 20 primary subjects must contribute the same number of segments.
        counts=d.groupby('subject').size();n=int(counts.min())
        d=d.groupby('subject',group_keys=False).apply(lambda g:g.sample(n,random_state=SEED),include_groups=False).reset_index() if counts.nunique()>1 else d
        x=d[features].to_numpy();assert np.isfinite(x).all()
        scores=[];models={}
        for k in range(2,6):
            model,u,y=fit_pipeline(x,k);score=float(silhouette_score(u,y))
            scores.append(dict(phase=phase,k=k,silhouette=score,pca_variance=float(model[2].explained_variance_ratio_.sum())))
            models[k]=(model,u,y)
        chosen=max(scores,key=lambda r:r['silhouette'])['k'];model,u,y=models[chosen]
        for row in scores:row['selected']=row['k']==chosen
        selections.extend(scores)
        rng=np.random.default_rng(SEED);subjects=np.array(sorted(d.subject.unique()))
        for b in range(30):
            keep=rng.choice(subjects,size=16,replace=False);mask=d.subject.isin(keep).to_numpy()
            boot,_,_=fit_pipeline(x[mask],chosen,SEED+b)
            py,_=predict(boot,x)
            stability.append(dict(phase=phase,repeat=b,ARI=float(adjusted_rand_score(y,py)),
                                  omitted_subjects=';'.join(sorted(set(subjects)-set(keep)))))
        medari=np.median([q['ARI'] for q in stability if q['phase']==phase])
        for name,cols in [('EMG_only',features[:24]),('kinematics_only',features[24:])]:
            _,uu,yy=fit_pipeline(d[cols].to_numpy(),chosen)
            ablations.append(dict(phase=phase,feature_set=name,k=chosen,ARI_vs_joint=float(adjusted_rand_score(y,yy)),silhouette=float(silhouette_score(uu,yy))))
        d['cluster_id']=y;d['PC1']=u[:,0];d['PC2']=u[:,1];d['fit_role']='discovery'
        members.extend(d.to_dict('records'))
        extra=data[(data.phase==phase)&(data.group=='ST_nonparetic')].copy()
        yy,uu=predict(model,extra[features].to_numpy());extra['cluster_id']=yy;extra['PC1']=uu[:,0];extra['PC2']=uu[:,1];extra['fit_role']='projection_only';members.extend(extra.to_dict('records'))
        scaled=np.clip(model[0].transform(x),-4,4)
        for cluster,g in d.groupby('cluster_id'):
            count=g.groupby('subject').size();npats=g[g.group=='ST_paretic'].subject.nunique()
            clusters.append(dict(phase=phase,cluster_id=int(cluster),segments=len(g),subjects=g.subject.nunique(),
                patients=npats,healthy_subjects=g[g.group=='HS'].subject.nunique(),
                patient_segment_fraction=float(np.mean(g.group=='ST_paretic')),
                maximum_subject_share=float(count.max()/len(g)),median_stability_ARI=float(medari),
                position1_fraction=float(np.mean(g.position==1)),position2_fraction=float(np.mean(g.position==2)),position3_fraction=float(np.mean(g.position==3))))
            for j,name in enumerate(features):
                profiles.append(dict(phase=phase,cluster_id=int(cluster),feature=name,
                    median_raw=float(g[name].median()),median_robust_scaled=float(np.median(scaled[y==cluster,j]))))
        details.append(dict(phase=phase,n_segments=len(d),n_subjects=len(subjects),segments_per_subject=n,
            k=chosen,median_stability_ARI=float(medari),
            NMI_subject=float(normalized_mutual_info_score(d.subject,y)),NMI_position=float(normalized_mutual_info_score(d.position,y)),
            NMI_group=float(normalized_mutual_info_score(d.group,y)),
            feature_names=features,scale_center=model[0].center_.tolist(),scale_iqr=model[0].scale_.tolist(),
            weights=model[1].tolist(),pca_components=model[2].components_.tolist(),pca_mean=model[2].mean_.tolist(),
            centers=model[3].cluster_centers_.tolist()))
        print(phase,'k',chosen,'silhouette',max(s['silhouette'] for s in scores),'stability',medari,flush=True)
    for filename,rows in [('cluster_selection.csv',selections),('segment_membership.csv',members),('cluster_summary.csv',clusters),
                         ('subject_subsample_stability.csv',stability),('modality_comparison.csv',ablations),('cluster_profiles.csv',profiles)]:
        pd.DataFrame(rows).to_csv(OUT/'results'/filename,index=False,encoding='utf-8-sig')
    (OUT/'results/method_and_models.json').write_text(json.dumps(dict(seed=SEED,stability_repeats=30,
        note='Unsupervised exploratory cluster IDs only; no normal/abnormal labels, no classifier, no held-out accuracy',phases=details),indent=2),encoding='utf-8')

if __name__=='__main__':
    with threadpool_limits(limits=1):main()
