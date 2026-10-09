"""Use original tick intersections, not dimension-line overshoot endpoints."""
import math,sys,argparse,copy
from pathlib import Path
import pymupdf as fitz
from scan_all import read
from sync_sources import OUT,write

def refine(paths,scale):
 ticks=[]
 for i,p in enumerate(paths):
  for j,it in enumerate(p['items']):
   if it[0]!='l':continue
   a,b=tuple(it[1]),tuple(it[2]);dx,dy=abs(a[0]-b[0]),abs(a[1]-b[1])
   if .5<math.dist(a,b)<12 and min(dx,dy)>.25 and .3<dx/dy<3:ticks.append((i,j,a,b))
 checks=[]
 for c in scale.get('checks',[]):
  c=copy.deepcopy(c);axis=c['axis'];dim=c['endpoints_pdf'];ends=[];evidence=[]
  for endpoint in dim:
   candidates=[]
   for i,j,a,b in ticks:
    t=(endpoint[1]-a[1])/(b[1]-a[1]) if axis=='x' else (endpoint[0]-a[0])/(b[0]-a[0])
    if not -.001<=t<=1.001:continue
    p=[a[0]+t*(b[0]-a[0]),a[1]+t*(b[1]-a[1])];delta=math.dist(p,endpoint)
    if delta<4:candidates.append((delta,i,j,p))
   if candidates:
    dist,i,j,p=min(candidates);ends.append(p);evidence.append(dict(tick_path_id=i,tick_item_id=j,offset_from_line_endpoint=dist))
  if len(ends)!=2 or math.dist(*ends)<25:continue
  c.update(raw_line_endpoints_pdf=dim,endpoints_pdf=ends,endpoint_method='original_tick_line_intersections',tick_evidence=evidence,
   length_pdf=math.dist(*ends),m_per_point=c['value_mm']/1000/math.dist(*ends));checks.append(c)
 pairs=[]
 for x in [c for c in checks if c['axis']=='x']:
  for z in [c for c in checks if c['axis']=='z']:
   factor=(x['m_per_point']+z['m_per_point'])/2;error=abs(x['m_per_point']-z['m_per_point'])/factor
   if error>.02:continue
   support=sum(abs(c['m_per_point']-factor)/factor<=.02 for c in checks)
   pairs.append((support,min(x['length_pdf'],z['length_pdf']),x['length_pdf']+z['length_pdf'],-error,x,z,factor))
 pairs.sort(key=lambda a:a[:4],reverse=True)
 if not pairs:return dict(status='unverified',checks=checks,selected=None,error=None,m_per_point=None,two_axes_verified=False)
 support,_,_,-error,x,z,factor=pairs[0]
 return dict(status='candidate_two_axes_pending_vision',checks=checks,selected=[x,z],error=error,m_per_point_candidate=factor,m_per_point=None,
  support_dimension_count=support,two_axes_verified=False,area_used_for_calibration=False,method='ocr_or_text_and_vector_tick_intersections',
  reason='需视觉核对识别数字与刻线交点，不能仅凭一致性把OCR候选设为已验证。')

def main():
 sys.stdout.reconfigure(encoding='utf-8');ap=argparse.ArgumentParser();ap.add_argument('candidates',nargs='+');args=ap.parse_args()
 for file in args.candidates:
  a=read(file);sid,n=a['source_id'],a['page'];dest=OUT/'比例候选-r2'/f'{sid}-p{n:03}.json';dest.parent.mkdir(exist_ok=True)
  if dest.exists():continue
  d=read(a['draft'])
  with fitz.open(d['source_pdf']) as doc:
   p=doc[n-1];p.remove_rotation();scale=refine(p.get_drawings(),a['scale'])
  write(dest,dict(source_id=sid,page=n,draft=a['draft'],previous_candidates=str(file),scale=scale,generator=dict(script='scale_candidates_v2.py',version='2.0.0')))
  print(sid,scale['status'],scale.get('error'),[(c['axis'],c['value_mm']) for c in scale.get('selected') or []],flush=True)
if __name__=='__main__':main()
