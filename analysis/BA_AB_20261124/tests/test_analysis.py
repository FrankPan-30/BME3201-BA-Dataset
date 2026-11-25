"""边界行为验证，避免索引、缺失插值和重叠公式产生错误解释。"""
import sys,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'src'))
import numpy as np
from signal_ops import cci,fill_short,runs
from features import motion_features,phase

class TestAnalysis(unittest.TestCase):
    def test_overlap(self):
        self.assertAlmostEqual(cci(np.ones(10),np.ones(10)),1)
        self.assertAlmostEqual(cci(np.r_[np.ones(5),np.zeros(5)],np.r_[np.zeros(5),np.ones(5)]),0)
        self.assertTrue(np.isnan(cci(np.zeros(10),np.zeros(10))))
    def test_short_gaps_only(self):
        x=np.arange(30,dtype=float);x[3:5]=np.nan;x[10:25]=np.nan
        y,n=fill_short(x,100,.08);self.assertEqual(n,2);self.assertTrue(np.isnan(y[10:25]).all())
    def test_run_exclusive_end(self):self.assertEqual(runs([0,1,1,0,1]),[(1,3),(4,5)])
    def test_pause_excludes_edges(self):
        s=np.ones(100);s[:5]=0;s[40:70]=0;s[-5:]=0
        p=np.c_[np.arange(100)/100,np.zeros((100,2))]
        f,e=motion_features(p,s,np.zeros(100),np.ones(100),0,99,100)
        self.assertEqual(e,[(40,70)]);self.assertAlmostEqual(f['pause_total_s'],.3)
    def test_stationary_object_not_valid_phase(self):
        p=np.c_[np.arange(100)/100,np.zeros((100,2))]
        q,status=phase(p,np.zeros((100,3)),np.ones(100),0,99,100)
        self.assertIsNone(q);self.assertEqual(status,'no_sustained_object_displacement')
    def test_laterality_geometry(self):
        axis=np.array([1.,0,0]);arm=np.array([.5,0,-np.sqrt(.75)])
        self.assertAlmostEqual(np.dot(axis,arm),np.dot(-axis,arm*np.array([-1,1,1])))

if __name__=='__main__':unittest.main()
