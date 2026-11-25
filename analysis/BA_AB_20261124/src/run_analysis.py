"""步骤 1–3：审计、分期、全通道可解释探索。不产生分类标签。"""
import json,sys,platform
import numpy as np
import pandas as pd
from dataio import ROOT,CONFIG,PAIRS,read_record,marker,angle,manifest
from signal_ops import fill_short,lowpass_segments,emg_envelope
from features import phase,motion_features,pair_features

def save(name,rows):
    df=pd.DataFrame(rows)
    if not rows and name=='candidate_intervals.csv':
        df=pd.DataFrame(columns=['subject','group','side','record','rep','event','start_s','end_s','duration_s','phase_position','annotation'])
    df.to_csv(ROOT/'results'/name,index=False,encoding='utf-8-sig')

def main():
    trial_rows=[];audit=[];channel_rows=[];intervals=[];sens=[];sync=[];stages=[];schema=[]
    (ROOT/'results/source_manifest.json').write_text(json.dumps(manifest(),indent=2),encoding='utf-8')
    cache=ROOT/'data_derived/processed';cache.mkdir(exist_ok=True)
    for path in sorted((ROOT/'data_derived').glob('*_BA.mat')):
        r=read_record(path);t=r['t'];fs=r['fs'];efs=r['efs'];side=r['side'];rid=r['record']
        starts=np.atleast_1d(t['Events']['Start']).astype(int)-1
        ends=np.atleast_1d(t['Events']['End']).astype(int)-1
        names=list(t['EmgVarName']);raw=np.asarray(t['EMG'],float)
        env=emg_envelope(raw,efs)
        action=np.zeros(raw.shape[1],bool)
        for a,b in zip(starts,ends):action[round(a/fs*efs):min(len(action),round((b+1)/fs*efs))]=True
        scales={p:np.nanpercentile(env[:,action],p,axis=1) for p in [95,99]}
        rest_mask=np.zeros(raw.shape[1],bool)
        for a in starts:rest_mask[max(0,round((a/fs-.5)*efs)):max(0,round((a/fs-.05)*efs))]=True
        rest=np.nanmedian(env[:,rest_mask],axis=1)
        baseline=dict(subject=r['subject'],group=r['group'],side=side,record=rid)
        shoulder_width=np.nanmedian(np.linalg.norm(marker(r,'SHOULDER_RX')-marker(r,'SHOULDER_LX'),axis=1))
        audit.append(dict(**baseline,repetitions=len(starts),kin_hz=fs,emg_hz=efs,marker_rows=t['Marker'].shape[0],
            angle_rows=t['Angles'].shape[0],emg_channels=len(names),shoulder_width_m=shoulder_width,
            marker_missing_fraction=np.mean(~np.isfinite(t['Marker'])),emg_missing_fraction=np.mean(~np.isfinite(raw)),
            duration_difference_s=t['Marker'].shape[1]/fs-raw.shape[1]/efs,
            age_midpoint=float(np.mean(r['meta']['Age'])),capacity=r['meta'].get('L_CA',np.nan)))
        schema.append(dict(record=rid,markers=list(t['MarkerVarName']),muscles=names,angles=list(t['AngleVarName'])))
        signals={};filled=0
        for name in ['OBJECT','SHOULDER_RX','SHOULDER_LX','ELBOW_'+side,'ULNA_'+side,'RADIUS_'+side]:
            x,n=fill_short(marker(r,name),fs,CONFIG['gap_fill_max_s']);filled+=n
            signals[name]=lowpass_segments(x,fs)
        wrist=(signals['ULNA_'+side]+signals['RADIUS_'+side])/2
        obj=signals['OBJECT'];speed=np.linalg.norm(np.gradient(wrist,axis=0)*fs,axis=1)
        lateral_axis=signals['SHOULDER_RX']-signals['SHOULDER_LX']
        lateral_axis/=np.linalg.norm(lateral_axis,axis=1)[:,None]
        if side=='LX':lateral_axis=-lateral_axis
        upper=signals['ELBOW_'+side]-signals['SHOULDER_'+side]
        upper/=np.linalg.norm(upper,axis=1)[:,None]
        lateral=np.degrees(np.arcsin(np.clip(np.sum(upper*lateral_axis,axis=1),-1,1)))
        el,_=fill_short(angle(r,'ElbowFlx'),fs);el=lowpass_segments(el,fs)
        np.savez_compressed(cache/(rid+'.npz'),wrist=wrist,obj=obj,speed=speed,lateral=lateral,elbow=el,
                            env=env[:,::8],names=np.array(names),fs=fs,scale95=scales[95],rest=rest)
        for rep,(start,end) in enumerate(zip(starts,ends),1):
            ident=dict(**baseline,rep=rep);uid=f'{rid}_r{rep}'
            if not (0<=start<end<len(wrist)):
                stages.append(dict(**ident,status='invalid_original_events'));continue
            base_phase,status=phase(wrist,obj,speed,start,end,fs,10)
            stage=dict(**ident,original_start_s=start/fs,original_end_s=end/fs,status=status,
                       whole_duration_s=(end-start)/fs,filled_coordinate_samples=filled)
            if base_phase is not None:
                on,ar,mv=base_phase
                stage.update(reach_onset_s=on/fs,reach_arrival_s=ar/fs,object_move_s=mv/fs,
                             pre_object_gap_s=(mv-ar)/fs)
                if not np.all(np.isfinite(lateral[on:ar+1])) or not np.all(np.isfinite(el[on:ar+1])):
                    stage['status']='missing_geometry_in_reach';base_phase=None
            stages.append(stage)
            if base_phase is None:continue
            on,ar,mv=base_phase
            a,b=round(on/fs*efs),min(raw.shape[1],round((ar+1)/fs*efs))
            if b<=a or b-a < .25*efs:continue
            feat,ev=motion_features(wrist,speed,lateral,el,on,ar,fs)
            row=dict(**ident,trial=uid,**feat)
            row.update(pair_features(env,names,PAIRS,a,b,efs,scales[95],rest))
            row['bb_tb_active_to_rest']=float(np.mean(env[[names.index('BICEP'),names.index('TRICP')],a:b],axis=1).min()/max(rest[names.index('BICEP')],rest[names.index('TRICP')],1e-12))
            trial_rows.append(row)
            for x,y in ev:
                intervals.append(dict(**ident,event='low_speed_interval',start_s=x/fs,end_s=y/fs,
                    duration_s=(y-x)/fs,phase_position=((x+y)/2-on)/(ar-on),annotation='descriptive_candidate_only'))
            for j,name in enumerate(names):
                channel_rows.append(dict(**ident,muscle=name,mean_rms_mV=float(np.mean(env[j,a:b])),
                    normalized_mean=float(np.mean(env[j,a:b])/max(scales[95][j],1e-12)),
                    active_to_rest=float(np.mean(env[j,a:b])/max(rest[j],1e-12)),
                    peak_phase_position=float(np.argmax(env[j,a:b])/(b-a)),
                    raw_finite_fraction=float(np.mean(np.isfinite(raw[j,a:b])))))
            for mm in CONFIG['object_displacement_mm']:
                ph,st=phase(wrist,obj,speed,start,end,fs,mm)
                if ph is None:continue
                oo,aa,_=ph
                if not np.all(np.isfinite(lateral[oo:aa+1])):continue
                for frac in CONFIG['pause_fraction_peak']:
                    for duration in CONFIG['pause_min_duration_s']:
                        ft,_=motion_features(wrist,speed,lateral,el,oo,aa,fs,frac,duration)
                        sens.append(dict(**ident,object_mm=mm,pause_frac=frac,pause_min_s=duration,
                                         **{k:ft[k] for k in ['pause_count','pause_total_s','reach_duration_s','lateral_p95_deg','path_ratio']}))
            for shift in CONFIG['sync_shift_s']:
                for norm in [95,99]:
                    aa=max(0,a+round(shift*efs));bb=min(raw.shape[1],b+round(shift*efs))
                    ft=pair_features(env,names,PAIRS,aa,bb,efs,scales[norm],rest)
                    sync.append(dict(**ident,shift_s=shift,norm_percentile=norm,**ft))
        print(rid,'processed',flush=True)
    for name,rows in [('record_audit.csv',audit),('phase_audit.csv',stages),('trial_features.csv',trial_rows),
        ('muscle_features.csv',channel_rows),('candidate_intervals.csv',intervals),('motion_sensitivity.csv',sens),('emg_sensitivity.csv',sync)]:save(name,rows)
    (ROOT/'results/schema.json').write_text(json.dumps(schema,indent=2),encoding='utf-8')
    (ROOT/'results/run_environment.json').write_text(json.dumps(dict(python=sys.version,platform=platform.platform(),
        config=CONFIG,scope='descriptive exploration; no labels or classifier',numpy=np.__version__,pandas=pd.__version__),indent=2),encoding='utf-8')
    print('DONE',len(trial_rows),'usable reaches of',len(stages),'trials')

if __name__=='__main__':main()
