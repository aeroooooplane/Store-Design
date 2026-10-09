"""Find OCR/text dimension-line correspondences; require later visual acceptance."""
import math,re,sys,json,argparse
from pathlib import Path
import pymupdf as fitz
from shapely.geometry import Point,LineString
from scan_all import read
from sync_sources import OUT,write,sha
from ocr_pages import BASE as OCR

def propose(paths,text,w,h):
 segments=[]
 for i,p in enumerate(paths):
  for j,it in enumerate(p['items']):
   if it[0]=='l':
    a,b=tuple(it[1]),tuple(it[2]);length=math.dist(a,b)
    if length>.15:segments.append((i,j,a,b,length))
 ticks=[s for s in segments if .5<s[4]<12 and min(abs(s[2][0]-s[3][0]),abs(s[2][1]-s[3][1]))>.25]
 choices=[]
 for s in text:
  label=s['text'].strip()
  if not re.fullmatch(r'\d{3,6}',label) or (s.get('method')=='ocr' and s.get('ocr_confidence',0)<.97):continue
  value=int(label);b=s['bbox'];cx,cy=(b[0]+b[2])/2,(b[1]+b[3])/2
  if not 200<=value<=50000 or cx>w*.89:continue
  axis='z' if b[3]-b[1]>1.2*(b[2]-b[0]) or abs(s.get('direction',[1,0])[1])>.8 else 'x'
  opts=[]
  for i,j,a,c,length in segments:
   if length<25:continue
   if axis=='x':
    if abs(a[1]-c[1])>.2:continue
    midpoint=abs((a[0]+c[0])/2-cx);distance=min(abs(a[1]-b[1]),abs(a[1]-b[3]));endextent=min(a[0],c[0])<=cx<=max(a[0],c[0])
   else:
    if abs(a[0]-c[0])>.2:continue
    midpoint=abs((a[1]+c[1])/2-cy);distance=min(abs(a[0]-b[0]),abs(a[0]-b[2]));endextent=min(a[1],c[1])<=cy<=max(a[1],c[1])
   if not endextent or midpoint>length*.045+2 or distance>max(8,min(b[2]-b[0],b[3]-b[1])*1.8):continue
   tick_count=sum(any(LineString([t[2],t[3]]).distance(Point(p))<2.6 for t in ticks) for p in [a,c])
   if tick_count<2:continue
   score=distance+midpoint*.25
   opts.append((score,i,j,a,c,length,tick_count))
  if opts:
   score,i,j,a,c,length,ticksfound=min(opts)
   choices.append(dict(axis=axis,value_mm=value,label_text=label,text_bbox=b,text_method=s.get('method','pdf_text'),ocr_confidence=s.get('ocr_confidence'),
    path_id=i,item_id=j,endpoints_pdf=[list(a),list(c)],length_pdf=length,m_per_point=value/1000/length,paired_tick_endpoints=ticksfound,
    matching_score=score,method='text_or_ocr_dimension_with_vector_line_and_end_ticks'))
 pairs=[]
 for x in [a for a in choices if a['axis']=='x']:
  for z in [a for a in choices if a['axis']=='z']:
   mean=(x['m_per_point']+z['m_per_point'])/2;error=abs(x['m_per_point']-z['m_per_point'])/mean
   if error>.02:continue
   support=sum(abs(a['m_per_point']-mean)/mean<=.02 for a in choices)
   pairs.append((support,min(x['length_pdf'],z['length_pdf']),-(x['matching_score']+z['matching_score']),x,z,error,mean))
 pairs.sort(key=lambda p:p[:3],reverse=True)
 if not pairs:return dict(status='unverified',checks=choices,selected=None,error=None,m_per_point=None,reason='未找到两个方向均带端点刻线且比例一致的尺寸候选。')
 support,_,_,x,z,error,factor=pairs[0]
 return dict(status='candidate_two_axes_pending_vision',checks=choices,selected=[x,z],error=error,m_per_point_candidate=factor,m_per_point=None,
  support_dimension_count=support,two_axes_verified=False,area_used_for_calibration=False,
  reason='OCR数字、单位与标注线的语义尚待逐图视觉核验；此时不得换算正式坐标。')

def main():
 sys.stdout.reconfigure(encoding='utf-8');ap=argparse.ArgumentParser();ap.add_argument('draft',nargs='+');args=ap.parse_args()
 for name in args.draft:
  path=Path(name);d=read(path);sid,n=d['source_id'],d['page'];dest=OUT/'比例候选'/f'{sid}-p{n:03}.json';dest.parent.mkdir(exist_ok=True)
  if dest.exists():continue
  text=[];full=OCR/'full_plans'/f'{sid}-p{n:03}.json'
  if full.exists():text.extend(read(full)['text'])
  raw=read(OUT.parent/f'_cache/全量续跑-02/scans/{sid}.json');text.extend(raw['pages'][n-1]['text'])
  with fitz.open(d['source_pdf']) as doc:
   p=doc[n-1];p.remove_rotation();scale=propose(p.get_drawings(),text,p.rect.width,p.rect.height)
  write(dest,dict(source_id=sid,page=n,draft=str(path),draft_sha256=sha(path),scale=scale,generator=dict(script='scale_candidates.py',version='1.0.0')))
  print(sid,n,scale['status'],scale.get('error'),flush=True)
if __name__=='__main__':main()
