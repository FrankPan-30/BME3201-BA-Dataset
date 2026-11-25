"""扩展物体搬运阶段与全通道探索；受试者是统计单位。"""
import json
import numpy as np,pandas as pd
from scipy.stats import spearmanr
from dataio import ROOT,PAIRS,CONFIG
from features import motion_features,pair_features
from signal_ops import runs

def main():
    phases=pd.read_csv(ROOT/'results/phase_audit.csv'); transfers=[];channels=[];events=[];sensitivity=[]
    for record,group in phases.groupby('record'):
        with np.load(ROOT/'data_derived/processed'/(record+'.npz')) as zfile:
            z={k:zfile[k] for k in zfile.files}
        fs=float(z['fs']);names=list(z['names'])
        for _,r in group.iterrows():
            if r.status!='estimated':continue
            start,end=int(round(r.original_start_s*fs)),int(round(r.original_end_s*fs))
            origin=np.median(z['obj'][max(0,start-25):start+1],axis=0)
            segment=z['obj'][start:end+1]
            objspeed=np.linalg.norm(np.gradient(segment,axis=0)*fs,axis=1)
            disp=np.linalg.norm(segment-origin,axis=1)
            # First sustained settling after substantial movement. Using the final
            # trial position can include later marker shifts or return movements.
            settles=[(aa,bb) for aa,bb in runs((objspeed<.03)&(disp>.15)) if bb-aa>=round(.3*fs)]
            if not settles:continue
            settle_start,settle_end=settles[0]
            finish=np.median(segment[settle_start:settle_end],axis=0);vec=finish-origin
            if not np.all(np.isfinite(vec)) or np.linalg.norm(vec)<.1:continue
            progress=((segment[:settle_end]-origin)@vec)/np.dot(vec,vec)
            bounds=[]
            for f in [.1,.9]:
                rr=[a for a,b in runs(progress>=f) if b-a>=10]
                bounds.append(start+rr[0] if rr else None)
            a,b=bounds
            if a is None or b is None or b-a<30:continue
            ident={k:r[k] for k in ['record','subject','group','side','rep']}
            if not np.all(np.isfinite(z['wrist'][a:b+1])):continue
            ft,ev=motion_features(z['wrist'],z['speed'],z['lateral'],z['elbow'],a,b,fs)
            co=pair_features(z['env'],names,PAIRS,a,b+1,fs,z['scale95'],z['rest'])
            transfers.append(dict(**ident,transfer_start_s=a/fs,transfer_end_s=b/fs,
                approach_to_transfer_gap_s=a/fs-r.reach_arrival_s,post_transfer_duration_s=r.original_end_s-b/fs,
                **ft,**co))
            for aa,bb in ev:events.append(dict(**ident,start_s=aa/fs,end_s=bb/fs,duration_s=(bb-aa)/fs,event='transfer_low_speed_candidate'))
            for frac in CONFIG['pause_fraction_peak']:
                for duration in CONFIG['pause_min_duration_s']:
                    f,_=motion_features(z['wrist'],z['speed'],z['lateral'],z['elbow'],a,b,fs,frac,duration)
                    sensitivity.append(dict(**ident,pause_frac=frac,pause_min_s=duration,pause_count=f['pause_count']))
            for phase,aa,bb in [('approach',round(r.reach_onset_s*fs),round(r.reach_arrival_s*fs)),('handling',round(r.reach_arrival_s*fs),a),('transfer',a,b),('post_transfer',b,end)]:
                if bb<=aa:continue
                for j,name in enumerate(names):
                    x=z['env'][j,aa:bb+1]
                    channels.append(dict(**ident,phase=phase,muscle=name,duration_s=(bb-aa)/fs,
                        normalized_mean=float(np.nanmean(x)/max(z['scale95'][j],1e-12)),
                        active_to_rest=float(np.nanmean(x)/max(z['rest'][j],1e-12))))
    for filename,rows in [('transfer_features.csv',transfers),('phase_muscle_features.csv',channels),('transfer_intervals.csv',events),('transfer_sensitivity.csv',sensitivity)]:
        pd.DataFrame(rows).to_csv(ROOT/'results'/filename,index=False,encoding='utf-8-sig')
    f=pd.read_csv(ROOT/'results/trial_features.csv');sub=f.groupby(['group','subject']).median(numeric_only=True).reset_index()
    sub.to_csv(ROOT/'results/subject_features.csv',index=False,encoding='utf-8-sig')
    metrics=['reach_duration_s','pause_count','speed_peak_count','path_ratio','lateral_p95_deg','lateral_change_deg','BB_TB_cci','FCR_ECR_cci','FDS_EDC_cci','AD_PD_cci']
    rows=[];rng=np.random.default_rng(20261124)
    for k in metrics:
        h=sub[sub.group=='HS'][k].to_numpy();p=sub[sub.group=='ST_paretic'][k].to_numpy()
        diff=np.median(p)-np.median(h)
        boot=np.median(rng.choice(p,(3000,len(p))),axis=1)-np.median(rng.choice(h,(3000,len(h))),axis=1)
        rows.append(dict(metric=k,HS_median=np.median(h),HS_q25=np.percentile(h,25),HS_q75=np.percentile(h,75),
            paretic_median=np.median(p),paretic_q25=np.percentile(p,25),paretic_q75=np.percentile(p,75),
            median_difference=diff,bootstrap_low=np.percentile(boot,2.5),bootstrap_high=np.percentile(boot,97.5),
            patients_above_HS_max=int(np.sum(p>np.max(h))),patients_below_HS_min=int(np.sum(p<np.min(h)))))
    pd.DataFrame(rows).to_csv(ROOT/'results/group_summary.csv',index=False,encoding='utf-8-sig')
    # Descriptive associations only: no p-value selection, no diagnostic cutoffs.
    c=pd.DataFrame(channels);cs=c.groupby(['group','subject','phase','muscle']).normalized_mean.median().reset_index()
    cs.to_csv(ROOT/'results/subject_phase_muscle.csv',index=False,encoding='utf-8-sig')
    cor=[]
    for phase in ['approach','transfer']:
        target=f if phase=='approach' else pd.DataFrame(transfers)
        target=target[target.group=='ST_paretic'].groupby('subject').median(numeric_only=True)
        for muscle in sorted(c.muscle.unique()):
            x=cs[(cs.group=='ST_paretic')&(cs.phase==phase)&(cs.muscle==muscle)].set_index('subject').normalized_mean
            for metric in ['reach_duration_s','lateral_p95_deg','speed_peak_count']:
                q=pd.concat([x,target[metric]],axis=1).dropna()
                rho=float(spearmanr(q.iloc[:,0],q.iloc[:,1]).statistic) if q.iloc[:,1].nunique()>1 else np.nan
                cor.append(dict(phase=phase,muscle=muscle,metric=metric,n=len(q),spearman_rho=rho))
    pd.DataFrame(cor).to_csv(ROOT/'results/exploratory_associations.csv',index=False,encoding='utf-8-sig')
    print('Transfer trials',len(transfers),'candidate low speed intervals',len(events))

if __name__=='__main__':main()
