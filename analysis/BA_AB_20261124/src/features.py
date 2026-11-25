"""阶段估计及连续探索特征。所有事件是运动学候选，不是异常标签。"""
import numpy as np
from scipy.signal import find_peaks
from signal_ops import runs,cci

def phase(wrist,obj,speed,start,end,fs,object_mm=10):
    # MATLAB inclusive 1-based events are converted by the caller.
    base=np.nanmedian(obj[max(0,start-round(.2*fs)):start+1],axis=0)
    displacement=np.linalg.norm(obj[start:end+1]-base,axis=1)
    candidates=[a for a,b in runs(displacement>object_mm/1000) if b-a>=round(.08*fs)]
    if not candidates:return None,'no_sustained_object_displacement'
    move=start+candidates[0]
    if move-start<round(.25*fs):return None,'object_moves_too_early'
    dist=np.linalg.norm(wrist[start:move+1]-base,axis=1)
    if not np.all(np.isfinite(dist)):return None,'missing_wrist_before_object_move'
    closest=int(np.argmin(dist)); minimum=dist[closest]
    arrival_candidates=np.flatnonzero(dist[:closest+1]<=minimum+.02)
    arrival=start+int(arrival_candidates[0])
    if arrival-start<round(.25*fs):return None,'reach_too_short_or_already_at_object'
    local=speed[start:arrival+1]
    if not np.all(np.isfinite(local)):return None,'missing_wrist_speed'
    peak=np.max(local)
    active=[a for a,b in runs(local>.05*peak) if b-a>=round(.08*fs)]
    if not active or peak<.02:return None,'no_clear_reach'
    onset=start+active[0]
    if arrival-onset<round(.25*fs):return None,'short_reach'
    if np.linalg.norm(wrist[arrival]-wrist[onset])<.03:return None,'small_reach_displacement'
    return (onset,arrival,move),'estimated'

def motion_features(wrist,speed,lateral,elbow,onset,arrival,fs,pause_frac=.1,pause_min=.25):
    s=speed[onset:arrival+1];p=wrist[onset:arrival+1]
    n=len(s);peak=float(np.max(s)); edge=max(1,round(.1*n))
    mask=s<max(.005,pause_frac*peak);mask[:edge]=False;mask[-edge:]=False
    events=[(a,b) for a,b in runs(mask) if (b-a)/fs>=pause_min]
    peaks,_=find_peaks(s,prominence=.15*peak,distance=max(1,round(.15*fs)))
    length=np.linalg.norm(np.diff(p,axis=0),axis=1).sum();straight=np.linalg.norm(p[-1]-p[0])
    lat=lateral[onset:arrival+1];el=elbow[onset:arrival+1]
    out=dict(reach_duration_s=(arrival-onset)/fs,peak_speed_m_s=peak,
             pause_count=len(events),pause_total_s=sum((b-a)/fs for a,b in events),
             speed_peak_count=len(peaks),path_ratio=length/straight,
             lateral_mean_deg=float(np.mean(lat)),lateral_p95_deg=float(np.percentile(lat,95)),
             lateral_change_deg=float(np.percentile(lat,95)-lat[0]),
             elbow_rom_deg=float(np.ptp(el)),elbow_extension_deg=float(el[0]-el[-1]))
    out['pause_fraction']=out['pause_total_s']/out['reach_duration_s']
    return out,[(onset+a,onset+b) for a,b in events]

def pair_features(env,names,pairs,a,b,fs,scale,rest):
    vals={}
    x=env[:,a:b]/np.maximum(scale[:,None],1e-12)
    for label,(n1,n2) in pairs.items():
        i,j=names.index(n1),names.index(n2)
        vals[label+'_cci']=cci(x[i],x[j])
        # Above resting activity fraction is descriptive, not a clinical gate.
        vals[label+'_both_active_fraction']=float(np.mean((env[i,a:b]>3*rest[i])&(env[j,a:b]>3*rest[j])))
    return vals
