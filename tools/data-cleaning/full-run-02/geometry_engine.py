"""Original-vector geometry reconstruction; no image-to-metric estimation."""
import math
from collections import defaultdict
from shapely.geometry import Polygon,LineString,box
from shapely.ops import polygonize,unary_union

def segments(path):
 out=[]
 for it in path['items']:
  kind=it[0]
  if kind=='l':points=[tuple(it[1]),tuple(it[2])]
  elif kind=='re':
   r=it[1];points=[(r.x0,r.y0),(r.x1,r.y0),(r.x1,r.y1),(r.x0,r.y1),(r.x0,r.y0)]
  elif kind=='qu':points=[tuple(it[1].ul),tuple(it[1].ur),tuple(it[1].lr),tuple(it[1].ll),tuple(it[1].ul)]
  elif kind=='c':
   a,b,c,d=it[1:];points=[]
   for i in range(25):
    t=i/24;points.append(tuple((1-t)**3*a[k]+3*(1-t)**2*t*b[k]+3*(1-t)*t*t*c[k]+t**3*d[k] for k in range(2)))
  else:continue
  out.extend((u,v) for u,v in zip(points,points[1:]) if math.dist(u,v)>1e-6)
 return out

def node_faces(segs):
 if not segs:return []
 try:return list(polygonize(unary_union([LineString(s) for s in segs])))
 except Exception:return []

def reconstruct(paths,w,h,base=()):
 result=[];seen=set()
 def add(poly,method,ids):
  if poly.is_empty or poly.geom_type!='Polygon' or not poly.is_valid or not(3<poly.area<w*h*.75):return
  poly=Polygon(poly.exterior);key=poly.normalize().wkb
  if key in seen:return
  seen.add(key);result.append(dict(points=[list(p) for p in poly.exterior.coords],area=poly.area,
     bounds=list(poly.bounds),method=method,path_ids=ids))
 for b in base:add(Polygon(b['points']),'previous_style_polygonize',None)
 for i,path in enumerate(paths):
  if path['rect'].x0>w*.94:continue
  if path['rect'].width<1 or path['rect'].height<1:continue
  seg=segments(path)
  if path.get('closePath') and seg and math.dist(seg[-1][1],seg[0][0])>.0001:seg.append((seg[-1][1],seg[0][0]))
  faces=node_faces(seg)
  for poly in faces:add(poly,'single_path_noded_face',[i])
  if len(faces)>1:
   merged=unary_union(faces)
   for poly in ([merged] if merged.geom_type=='Polygon' else list(merged.geoms)):
    add(poly,'single_path_face_union',[i])
 return result

def iou(a,b):
 if a is None or b is None:return 0.
 ix=max(0,min(a[2],b[2])-max(a[0],b[0]));iy=max(0,min(a[3],b[3])-max(a[1],b[1]))
 inter=ix*iy;union=(a[2]-a[0])*(a[3]-a[1])+(b[2]-b[0])*(b[3]-b[1])-inter
 return inter/union if union else 0.

def select(roi,candidates,threshold=.65):
 if roi is None:return None,0.
 ranked=sorted(((iou(roi,c['bounds']),j) for j,c in enumerate(candidates)),reverse=True)
 if not ranked:return None,0.
 score,j=ranked[0]
 return (dict(candidates[j],candidate_index=j,selection_iou=score) if score>=threshold else None),score

def dimension_lines(paths,anchors,canvas,w,h):
 """Pair visually read dimensions with actual straight source-line endpoints."""
 result=[]
 for anchor in anchors:
  axis=anchor['axis'];expected=[[p[0]*w/canvas[0],p[1]*h/canvas[1]] for p in anchor['endpoints_canvas']]
  options=[]
  for i,path in enumerate(paths):
   for j,it in enumerate(path['items']):
    if it[0]!='l':continue
    a,b=tuple(it[1]),tuple(it[2]);dx,dy=abs(b[0]-a[0]),abs(b[1]-a[1])
    if (axis=='x' and dy>.2) or (axis=='z' and dx>.2):continue
    length=dx if axis=='x' else dy
    if length<10:continue
    delta=min(max(math.dist(a,expected[0]),math.dist(b,expected[1])),max(math.dist(a,expected[1]),math.dist(b,expected[0])))
    options.append((delta,i,j,a,b,length))
  options.sort()
  if options and options[0][0]<max(w,h)*.004:
   dist,i,j,a,b,length=options[0]
   result.append(dict(**anchor,path_id=i,item_id=j,endpoints_pdf=[list(a),list(b)],length_pdf=length,
      m_per_point=anchor['value_mm']/1000/length,selection_delta_pdf=dist,method='vision_number_and_vector_dimension_line'))
  else:result.append(dict(**anchor,method='vision',endpoints_pdf=None,m_per_point=None,reason='未匹配到两端均相符的完整尺寸线'))
 x=next((a for a in result if a['axis']=='x' and a['m_per_point']),None)
 z=next((a for a in result if a['axis']=='z' and a['m_per_point']),None)
 error=abs(x['m_per_point']-z['m_per_point'])/((x['m_per_point']+z['m_per_point'])/2) if x and z else None
 good=error is not None and error<=.02
 return dict(status='verified_two_axes' if good else 'unverified',method='vision_number_and_vector_dimension_line',
    checks=result,error=error,m_per_point=(x['m_per_point']+z['m_per_point'])/2 if good else None)
