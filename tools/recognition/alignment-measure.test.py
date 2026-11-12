import importlib.util,unittest
from pathlib import Path
import numpy as np
spec=importlib.util.spec_from_file_location('measure',Path(__file__).with_name('alignment-measure.py'))
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class MeasureTests(unittest.TestCase):
 def test_shift_is_detected(self):
  ink=np.zeros((100,100),dtype=bool);ink[:,20]=True
  self.assertEqual(m.distances(ink,[[20,50],[25,50]]),[0,5])
 def test_empty_and_diagonal_are_capped(self):
  ink=np.zeros((120,120),dtype=bool)
  self.assertEqual(m.distances(ink,[[10,10]]),[50])
  ink[60,60]=True
  self.assertEqual(m.distances(ink,[[10,10]]),[50])
 def test_holes_are_measured(self):
  g=dict(type='polygon',points=[[0,0],[40,0],[40,40],[0,40]],holes=[[[10,10],[20,10],[20,20],[10,20]]])
  self.assertIn([10,10],m.samples(g))
if __name__=='__main__':unittest.main()
