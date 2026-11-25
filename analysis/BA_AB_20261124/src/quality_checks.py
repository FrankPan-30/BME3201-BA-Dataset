"""背景活动敏感性及交付数据一致性检查。"""
import json
import numpy as np,pandas as pd
from dataio import ROOT,PAIRS
from signal_ops import cci

def main():
    ph=pd.read_csv(ROOT/'results/phase_audit.csv');rows=[]
    for record,g in ph.groupby('record'):
        with np.load(ROOT/'data_derived/processed'/(record+'.npz')) as f:z={k:f[k] for k in f.files}
        names=list(z['names']);corrected=np.maximum(z['env']-z['rest'][:,None],0)
        dynamic_scale=np.maximum(z['scale95']-z['rest'],1e-12)
        for _,r in g.iterrows():
            a,b=round(r.reach_onset_s*125),round(r.reach_arrival_s*125)+1
            for pair,(n1,n2) in PAIRS.items():
                i,j=names.index(n1),names.index(n2);x=corrected[[i,j],a:b]/dynamic_scale[[i,j],None]
                rows.append(dict(record=record,subject=r.subject,group=r.group,rep=r.rep,pair=pair,
                    background_subtracted_cci=cci(x[0],x[1]),
                    muscle1_to_rest=np.mean(z['env'][i,a:b])/max(z['rest'][i],1e-12),
                    muscle2_to_rest=np.mean(z['env'][j,a:b])/max(z['rest'][j],1e-12)))
    pd.DataFrame(rows).to_csv(ROOT/'results/background_sensitivity.csv',index=False,encoding='utf-8-sig')
    f=pd.read_csv(ROOT/'results/trial_features.csv');mus=pd.read_csv(ROOT/'results/muscle_features.csv')
    assert len(f)==149 and len(mus)==149*12
    assert (mus.raw_finite_fraction==1).all()
    assert np.isfinite(mus.select_dtypes('number')).all().all()
    assert not f.duplicated(['record','rep']).any()
    assert (ph.reach_arrival_s>ph.reach_onset_s).all()
    assert (ph.object_move_s>=ph.reach_arrival_s).all()
    assert (ph.original_end_s>=ph.object_move_s).all()
    assert np.isfinite(f.select_dtypes('number')).all().all()
    assert ((f[[k for k in f if k.endswith('_cci')]]>=0)&(f[[k for k in f if k.endswith('_cci')]]<=1)).all().all()
    assert set(mus.muscle)=={'DELPOS','DELML','DELANT','TRICP','BICEP','FLXCRR','FLXDIGS','EXTCRR','EXTDIGC','ABDPOL','FDORS','ADDMIG'}
    (ROOT/'results/validation.json').write_text(json.dumps(dict(trials=149,channel_records=len(mus),all_12_channels=True,
        unique_trials=True,phase_order_valid=True,features_finite=True,cci_within_bounds=True,
        trained_model=False,normal_abnormal_labels=False),indent=2),encoding='utf-8')
    print('Data integrity checks passed')

if __name__=='__main__':main()
