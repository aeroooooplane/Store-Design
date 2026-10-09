"""Node shared cabinet/wall edges; keep small furniture faces excluded by r9."""
from geometry_engine import *

def network_candidates(paths,w,h):
 groups=defaultdict(list)
 for i,p in enumerate(paths):
  if p['rect'].x0>w*.94:continue
  color=p.get('color')
  if color is None:continue
  if max(p['rect'].width,p['rect'].height)<6:continue
  key=(tuple(round(c,2) for c in color),p.get('dashes'))
  groups[key].append((i,p))
 out=[]
 for key,group in groups.items():
  seg=[];ids=[]
  for i,p in group:
   ids.append(i)
   for a,b in segments(p):
    a=tuple(round(v,2) for v in a);b=tuple(round(v,2) for v in b)
    if a!=b:seg.append((a,b))
  for poly in node_faces(seg):
   poly=Polygon(poly.exterior)
   if poly.is_valid and 3<poly.area<w*h*.65:
    out.append(dict(points=[list(p) for p in poly.exterior.coords],area=poly.area,bounds=list(poly.bounds),
      method='shared_edge_noded_face',path_ids=None,path_group=key,
      provenance_note='同色同虚线型的原始线段相交节点化；未创建门洞闭合线。'))
 return out

def snap_trace(points_canvas,paths,canvas,w,h):
 vertices=[]
 for i,p in enumerate(paths):
  for j,it in enumerate(p['items']):
   if it[0]=='l':vertices.extend((tuple(a),i,j) for a in it[1:])
   elif it[0]=='re':vertices.extend((tuple(a),i,j) for a in [it[1].tl,it[1].tr,it[1].br,it[1].bl])
   elif it[0]=='qu':vertices.extend((tuple(a),i,j) for a in [it[1].ul,it[1].ur,it[1].lr,it[1].ll])
   elif it[0]=='c':vertices.extend((tuple(a),i,j) for a in [it[1],it[4]])
 result=[];evidence=[]
 for px,py in points_canvas:
  q=(px*w/canvas[0],py*h/canvas[1]);ranked=sorted((math.dist(q,v),v,i,j) for v,i,j in vertices)
  dist,v,i,j=ranked[0]
  if dist>max(w,h)*.004:return None,dict(reason='视觉边界顶点附近没有可靠矢量端点',failed_vertex=[px,py],distance=dist)
  result.append(list(v));evidence.append(dict(path_id=i,item_id=j,snap_distance_pdf=dist,vision_point=[px,py]))
 result.append(result[0]);poly=Polygon(result)
 if not poly.is_valid:return None,dict(reason='视觉选点边界不构成简单闭合多边形')
 return dict(points=result,bounds=list(poly.bounds),area=poly.area,method='vision_boundary_trace_snapped_to_vector_vertices',
    vertex_evidence=evidence,kind='boundary_candidate',note='顶点来自原矢量，门洞段按图中门面/租赁线语义连接；需审查每条边，非自动闭合证明。'),None
