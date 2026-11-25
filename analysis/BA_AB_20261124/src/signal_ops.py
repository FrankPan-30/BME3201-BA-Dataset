"""离线信号处理。零相位滤波不代表可实时部署。"""
import numpy as np
from scipy.signal import butter, sosfiltfilt
from scipy.ndimage import uniform_filter1d

def runs(mask):
    d=np.diff(np.r_[False,np.asarray(mask,bool),False].astype(int))
    return list(zip(np.flatnonzero(d==1),np.flatnonzero(d==-1)))

def fill_short(x,fs,max_s=0.08):
    x=np.array(x,float,copy=True);one=x.ndim==1
    if one:x=x[:,None]
    filled=0
    for j in range(x.shape[1]):
        for a,b in runs(~np.isfinite(x[:,j])):
            if a>0 and b<len(x) and b-a<=round(max_s*fs):
                x[a:b,j]=np.linspace(x[a-1,j],x[b,j],b-a+2)[1:-1];filled+=b-a
    return (x[:,0] if one else x),filled

def lowpass_segments(x,fs,cutoff=6):
    x=np.array(x,copy=True); one=x.ndim==1
    if one:x=x[:,None]
    sos=butter(4,cutoff,fs=fs,output='sos')
    for j in range(x.shape[1]):
        for a,b in runs(np.isfinite(x[:,j])):
            if b-a>30:x[a:b,j]=sosfiltfilt(sos,x[a:b,j])
    return x[:,0] if one else x

def emg_envelope(raw,fs):
    raw=np.asarray(raw,float); out=np.full_like(raw,np.nan)
    sos=butter(4,[20,450],btype='bandpass',fs=fs,output='sos')
    for j in range(raw.shape[0]):
        for a,b in runs(np.isfinite(raw[j])):
            if b-a>100:
                y=sosfiltfilt(sos,raw[j,a:b])
                out[j,a:b]=np.sqrt(np.maximum(uniform_filter1d(y*y,size=round(.05*fs),mode='nearest'),0))
    return out

def cci(x,y):
    valid=np.isfinite(x)&np.isfinite(y)
    if valid.mean()<.95:return np.nan
    x,y=x[valid],y[valid]; den=np.sum(x+y)
    return float(2*np.sum(np.minimum(x,y))/den) if den>1e-12 else np.nan
