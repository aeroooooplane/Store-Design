import importlib.util,sys,unittest
from pathlib import Path
import numpy as np
p=Path(__file__).with_name('raw-infer.py');spec=importlib.util.spec_from_file_location('raw_infer',p);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class Geometry(unittest.TestCase):
 def test_transparent_background_is_white(self):
  im=m.Image.new('RGBA',(2,1),(0,0,0,0));im.putpixel((1,0),(0,0,0,255))
  self.assertEqual([m.opaque_image(im).getpixel((x,0)) for x in range(2)],[(255,255,255),(0,0,0)])
 def test_rectangle(self):
  a=np.zeros((30,30),bool);a[5:20,3:25]=True;r=m.rings(a);self.assertEqual(len(r),1);self.assertEqual(m.area(r[0]),330);self.assertEqual(len(m.simplify(r[0])),4)
 def test_separate_regions_not_largest_only(self):
  a=np.zeros((30,30),bool);a[2:7,2:7]=True;a[15:20,15:20]=True;self.assertEqual(len(m.rings(a)),2)
 def test_hole_preserved(self):
  a=np.ones((20,20),bool);a[5:15,5:15]=False;r=m.rings(a);self.assertEqual(sorted(m.area(p) for p in r),[-100,400])
 def test_diagonal_not_joined(self):
  a=np.eye(4,dtype=bool);r=m.rings(a);self.assertEqual(len(r),4)
 def test_concave_not_convex_hull(self):
  a=np.zeros((20,20),bool);a[2:18,2:7]=True;a[13:18,2:18]=True;r=m.rings(a);self.assertEqual(m.area(r[0]),135);self.assertGreater(len(m.simplify(r[0])),4)
if __name__=='__main__':unittest.main()
