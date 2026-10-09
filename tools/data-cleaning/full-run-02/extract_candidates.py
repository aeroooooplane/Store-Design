"""All plan candidates: source vectors, conservative semantic proposals, exclusive output."""
import sys,json,re,math,copy,argparse,traceback,os
from pathlib import Path
from concurrent.futures import ProcessPoolExecutor,as_completed
from shapely.geometry import Polygon,Point,box
from PIL import Image,ImageDraw
import pymupdf as fitz
from sync_sources import ROOT,OUT,write,sha,meta
from scan_all import CACHE as SCANS,read
from classification import classify
from geometry_engine import reconstruct
from network_geometry import network_candidates
sys.path.insert(0,str(ROOT/'tools/data-cleaning'))
import geometry6 as g6
from geometry8 import chain_polygons
from geometry3 import function,ASSETS,WEB
from package_pilot import nominal

CACHE=OUT.parent/'_cache/全量续跑-02'
DEST=OUT/'平面候选-r1'

def matches(t,fun,si):
 n=nominal(t);result=[]
 for a in ASSETS:
  if a['material_category']!='软装物料' or function(a['standard_name'])!=fun:continue
  an=nominal(a['standard_name']+' '+a.get('variant',''))
  if n and an and abs(n-an)/n>.15:continue
  if fun=='negotiation_table':continue
  if fun=='seating' and not any(k in t and k in a['standard_name'] for k in ['字母凳','培训坐凳','沙发']):continue
  score=.55+(.2 if n and an else 0)+(.15 if si and a.get('material_si')==si else 0)
  result.append(dict(asset_id=a['asset_id'],score=round(score,2),basis=dict(function=fun,nominal_length_m=n,asset_nominal_m=an,
   si_priority='index_weak_label' if si else None,si_value=si,dimension_tolerance=.15),web_available=a['asset_id'] in WEB))
 return sorted(result,key=lambda a:-a['score'])[:3]

def info(ls):
 out={}
 for name,pat in [('stated_area',r'(?:实测面积|SITE|AREA|面积)\s*[:：]?\s*(\d+(?:\.\d+)?)\s*(?:m|㎡|平)'),
  ('room_height',r'(?:店铺天花高度|店铺现有吊顶高度|天花高度|层高)\s*[:：]?\s*(\d+(?:\.\d+)?)\s*(mm|m|米)')]:
  ev=[]
  for a in ls:
   m=re.search(pat,a['text'],re.I)
   if m:ev.append(dict(value=float(m[1])/(1000 if name=='room_height' and m[2].lower()=='mm' else 1),text=a['text'],bbox=a['bbox'],method='pdf_text'))
  out[name]=dict(value=ev[0]['value'] if len(set(v['value'] for v in ev))==1 else None,unit='m2' if name=='stated_area' else 'm',evidence=ev)
 return out

def run(row):
 sid=row['source_id'];raw=read(SCANS/f'{sid}.json');pages=[classify(p) for p in raw['pages']];dst=DEST/sid
 if (dst/'receipt.json').exists():
  a=read(dst/'receipt.json');assert a['sha256']==row['sha256'];return dict(source_id=sid,status='skipped',plans=a['plans'])
 if dst.exists():raise FileExistsError('Partial output exists; do not overwrite: '+str(dst))
 dst.mkdir(parents=True)
 plans=[p for p in pages if p['type']=='plan_layout']
 fallback=False
 if not plans:
  # Historical pages are candidates, not relabeled layouts.
  idx=row['index_matches'][0] if row['index_matches'] else {}
  nums=[n for n in idx.get('plan_candidates',[]) if 0<n<=len(pages)]
  if not nums:
   nums=[p['page'] for p in pages if p['type']=='other' and p['signals'].get('vector_path_count',0)>300][:3]
  plans=[pages[n-1] for n in nums];fallback=True
 if not plans and pages:plans=[pages[0]];fallback=True
 idx=next((r for r in row['index_matches'] if r['source_id']==sid),row['index_matches'][0] if row['index_matches'] else {})
 written=[];errors=[]
 with fitz.open(row['path']) as doc:
  for pd in plans:
   n=pd['page'];dd=dst/f'p{n:03}';dd.mkdir()
   try:
    q=doc[n-1];original_rotation=q.rotation;q.remove_rotation();w,h=q.rect.width,q.rect.height
    paths=q.get_drawings();ls=pd['joined_text'];base=g6.polygons6(paths,w,h)
    cands=reconstruct(paths,w,h,[dict(points=list(p.exterior.coords)) for p in base])
    cands.extend(network_candidates(paths,w,h));polys=[Polygon(c['points']) for c in cands]
    items=[];fixed=[];obstacles=[];entrances=[]
    for s in ls:
     t=s['text'];fun=function(t);b=s['bbox'];cx,cy=(b[0]+b[2])/2,(b[1]+b[3])/2
     if len(t)>90 or b[0]>.88*w:continue
     isobs=bool(re.search(r'柱子|结构柱|管井|配电箱|配电间|强弱电箱|消防栓|消火栓|楼梯',t));isfix=bool(re.search(r'灯箱|墙面.*画|LOGO|lightbox',t,re.I)) and not fun
     isentrance=bool(re.search(r'主入口|店铺入口|入口|ENTRANCE',t,re.I)) and len(t)<30
     if isentrance:entrances.append(dict(label_text=t,segment=None,evidence=dict(method='pdf_text',text_bbox=b)))
     if not(fun or isobs or isfix):continue
     options=[]
     if fun and not isobs:
      for i,poly in enumerate(polys):
       x0,y0,x1,y1=poly.bounds;pw,ph=x1-x0,y1-y0
       if min(pw,ph)<2 or pw>w*.32 or ph>h*.42 or poly.area<35 or poly.area/(pw*ph)<.55:continue
       dist=poly.distance(Point(cx,cy))
       if dist>max(22,s['size']*5):continue
       # Enclosing text is strongest; proximity proposals remain explicitly unverified.
       penalty=dist+(0 if x0<=cx<=x1 else 12)+(0 if y0>=b[1] or poly.covers(Point(cx,cy)) else 8)
       if poly.covers(Point(cx,cy)):penalty+=math.sqrt(poly.area)*.015
       options.append((penalty,i))
     options.sort();geom=cands[options[0][1]] if options else None
     near=[a for a in ls if re.search(r'H\s*[:：]\s*\d+',a['text'],re.I) and abs((a['bbox'][0]+a['bbox'][2])/2-cx)<max(10,(b[2]-b[0])*.8) and -s['size']*.5<=a['bbox'][1]-b[1]<s['size']*3]
     hm=re.search(r'H\s*[:：]\s*(\d+(?:\.\d+)?)\s*(mm|米|m)?',t,re.I)
     htext=t if hm else near[0]['text'] if near else None
     if not hm and htext:hm=re.search(r'H\s*[:：]\s*(\d+(?:\.\d+)?)\s*(mm|米|m)?',htext,re.I)
     rec=dict(id=f'object-{len(items)+len(fixed)+len(obstacles)+1:03}',label_text=t,function=fun or 'other',
      h=float(hm[1])/(1 if hm[2] in ('m','米') else 1000) if hm else None,height_unit='m',rotation=None,
      pdf_polygon=geom['points'] if geom else None,bbox_pdf=geom['bounds'] if geom else None,geometry=geom,
      asset_candidates=matches(t,fun,idx.get('si')) if fun else [],confidence=.45 if geom else .2,
      evidence=dict(method='pdf_text_vector_proximity',text_bbox=b,nominal_length_m=nominal(t),height_text=htext,
       geometry_status='candidate_unverified' if geom else 'unresolved',alternative_candidates=[dict(score=round(sc,3),bounds=cands[i]['bounds']) for sc,i in options[:3]]),training_eligible=False)
     (obstacles if isobs else fixed if isfix else items).append(rec)
    boundary=None
    if any('租赁线' in s['text'] for s in ls):
     rent=chain_polygons(paths,w,h,True)
     if rent:
      p=max(rent,key=lambda p:p.area);boundary=dict(points=list(p.exterior.coords),bounds=list(p.bounds),area=p.area,kind='lease_line',method='explicit_red_dashed_lease_line',confidence=.7)
    if boundary is None:
     centers=[Point((a['bbox_pdf'][0]+a['bbox_pdf'][2])/2,(a['bbox_pdf'][1]+a['bbox_pdf'][3])/2) for a in items if a['bbox_pdf']]
     opts=[]
     for i,p in enumerate(polys):
      x0,y0,x1,y1=p.bounds
      if w*h*.02<p.area<w*h*.65 and x1<w*.93 and y0>h*.04 and y1<h*.96 and centers and sum(p.covers(c) for c in centers)/len(centers)>.85:
       opts.append((p.area,i))
     if opts:
      _,i=min(opts);boundary=dict(cands[i],kind=None,confidence=.35,selection_method='enclosing_major_prop_candidates')
    factor=2500/max(w,h);ev=CACHE/'plan-renders'/sid/f'p{n:03}.png';ev.parent.mkdir(parents=True,exist_ok=True)
    pix=q.get_pixmap(matrix=fitz.Matrix(factor,factor),alpha=False)
    with ev.open('xb') as f:f.write(pix.tobytes('png'))
    im=Image.open(ev).convert('RGB');dr=ImageDraw.Draw(im)
    if boundary:dr.line([(x*factor,y*factor) for x,y in boundary['points']],fill='#008cdd',width=5)
    for o in items:
     if o['pdf_polygon']:
      dr.line([(x*factor,y*factor) for x,y in o['pdf_polygon']],fill='#10862b',width=3)
      b=o['bbox_pdf'];dr.text((b[0]*factor,b[1]*factor),o['id'],fill='#006b15')
    overlay=CACHE/'plan-overlays'/sid/f'p{n:03}.png';overlay.parent.mkdir(parents=True,exist_ok=True)
    with overlay.open('xb') as f:im.save(f,format='PNG')
    scale=dict(status='unverified',method=None,checks=[],error=None,m_per_point=None,two_axes_verified=False,
     reason='尚未建立尺寸数字与两个方向原始尺寸线的可靠匹配；没有使用图像比例、图签比例或面积猜测米制尺度。')
    d=dict(source_id=sid,source_pdf=row['path'],source_sha256=row['sha256'],page=n,frame_bbox=list(q.rect),
     page_classification=pd['type'],page_confidence=pd['confidence'],fallback_candidate=fallback,
     boundary=boundary,items=items,fixed=fixed,obstacles=obstacles,entrances=entrances or None,scale=scale,
     **info(ls),si_index_label=idx.get('si'),shop_type=dict(value=idx.get('shop_type'),source='门店资源索引.json' if idx else None),
     si_evidence=[dict(text=s['text'],bbox=s['bbox'],method='pdf_text') for s in ls if re.search(r'\bSI\s*[12](?:[.．]0)?\b',s['text'],re.I)] or None,
     title_block=[s for s in ls if s['bbox'][0]>.8*w],unit='pdf_point',render_dpi=factor*72,original_rotation=original_rotation,
     evidence=str(ev),overlay=str(overlay),visual_check='pending',version_confirmed=False,training_eligible=False,auto_status='partial',
     geometry_candidate_count=len(cands),frame_detection_status='unverified',generator=dict(script='full-run-02/extract_candidates.py',version='1.0.0'))
    write(dd/'draft.json',d);written.append(n)
   except Exception as e:
    err=dict(page=n,error=str(e),traceback=traceback.format_exc());write(dd/'error.json',err);errors.append(err)
 write(dst/'classified.json',dict(source_id=sid,sha256=row['sha256'],pages=pages,generator=dict(script='classification.py',version='2.0.0')))
 write(dst/'receipt.json',dict(source_id=sid,sha256=row['sha256'],plans=written,errors=errors,plan_fallback=fallback))
 return dict(source_id=sid,status='done' if not errors else 'partial',plans=written,errors=[a['error'] for a in errors])

def main():
 sys.stdout.reconfigure(encoding='utf-8');ap=argparse.ArgumentParser();ap.add_argument('--workers',type=int,default=2);ap.add_argument('--limit',type=int);args=ap.parse_args()
 assert read(OUT/'试点验收-r12.json')['gate_passed'];DEST.mkdir(exist_ok=True)
 rows=[r for r in read(OUT/'00_同步与文件清单.json')['files'] if r['format']=='pdf' and (SCANS/f"{r['source_id']}.json").exists() and not (DEST/r['source_id']/'receipt.json').exists()]
 if args.limit:rows=rows[:args.limit]
 with ProcessPoolExecutor(max_workers=args.workers) as ex:
  fs={ex.submit(run,r):r for r in rows}
  for i,f in enumerate(as_completed(fs),1):
   try:r=f.result()
   except Exception as e:r=dict(source_id=fs[f]['source_id'],status='failed',error=str(e))
   with (OUT/'progress.jsonl').open('a',encoding='utf-8') as out:out.write(json.dumps({**meta(),'stage':'plan_candidates',**r},ensure_ascii=False)+'\n')
   print(i,len(rows),json.dumps(r,ensure_ascii=False),flush=True)
if __name__=='__main__':main()
