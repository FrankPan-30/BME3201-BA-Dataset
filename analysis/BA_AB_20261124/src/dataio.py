"""原生名称导出后的 MAT 读取、数据清单及文件校验。"""
from pathlib import Path
import json, hashlib
import numpy as np
from scipy.io import loadmat

ROOT = Path(__file__).resolve().parents[1]
CONFIG = json.loads((ROOT/'config/analysis.json').read_text(encoding='utf-8'))
PAIRS = {'BB_TB': ('BICEP','TRICP'), 'FCR_ECR': ('FLXCRR','EXTCRR'),
         'FDS_EDC': ('FLXDIGS','EXTDIGC'), 'AD_PD': ('DELANT','DELPOS')}

def read_record(path):
    d = loadmat(path, simplify_cells=True); t,m=d['t'],d['meta']
    subject=path.name.split('_')[0]
    group='HS' if subject.startswith('HS') else ('ST_nonparetic' if 'nonpleg' in path.name else 'ST_paretic')
    side=m.get('DomSide',m.get('HemiSide'))
    if group=='ST_nonparetic': side='LX' if side=='RX' else 'RX'
    return dict(t=t,meta=m,subject=subject,group=group,side=side,record=path.stem,
                fs=float(m['KinFreq']),efs=float(m['EmgFreq']))

def sha256(path):
    h=hashlib.sha256()
    with open(path,'rb') as f:
        for block in iter(lambda:f.read(1024*1024),b''): h.update(block)
    return h.hexdigest()

def manifest():
    return [dict(file=p.name,bytes=p.stat().st_size,sha256=sha256(p))
            for p in sorted(Path(CONFIG['data_root']).glob('*.mat'))]

def marker(r,name):
    names=list(r['t']['MarkerVarName']);i=names.index(name)
    return np.asarray(r['t']['Marker'][3*i:3*i+3],float).T/1000

def angle(r,name):
    return np.asarray(r['t']['Angles'][list(r['t']['AngleVarName']).index(name)],float)
