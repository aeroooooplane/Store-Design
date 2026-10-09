"""Twenty-source reconstruction pilot; new revision namespace, never overwrite v1."""
import sys,json,copy,math,argparse,traceback
from pathlib import Path
import pymupdf as fitz
from PIL import Image,ImageDraw
from shapely.geometry import Polygon
from geometry_engine import reconstruct,select,dimension_lines,iou
from network_geometry import network_candidates,snap_trace
from pilot_seeds import CANVAS,DIM,BOUNDARY_ROI,BOUNDARY_TRACE,ADD,REPLACE
from experiment import DIMENSIONS
from sync_sources import ROOT,OUT,write,sha,meta

PREV=ROOT/'资源库/90_处理过程与审核/数据清洗-20261009'
ANN=ROOT/'资源库/90_处理过程与审核/训练标注'
CACHE=PREV/'_cache/全量续跑-02'
NUMS=[1,2,3,5,8,13,19,29,32,35,43,49,51,71,88,90,239,293,296,353]
def read(p):return json.loads(p.read_text(encoding='utf-8'))
def bbox(points):return list(Polygon(points).bounds) if points else None
def main():
 sys.stdout.reconfigure(encoding='utf-8');ap=argparse.ArgumentParser();ap.add_argument('--numbers',nargs='*',type=int,default=NUMS);a=ap.parse_args()
 dest=OUT/'试点-r10';dest.mkdir(exist_ok=True)
 for n in a.numbers:
  sid=f'PDF-{n:03}';dd=dest/sid;receipt=dd/'receipt.json'
  if receipt.exists():
   for name,hsh in read(receipt)['files'].items():assert sha(dd/name)==hsh
   print(sid,'verified skip');continue
  if dd.exists():raise FileExistsError(f'不完整目录不覆盖: {dd}')
  dd.mkdir();old=ANN/f'store-{n:04}/v1';source=read(old/'source.json');inp=read(old/'input.json');target=read(old/'target-layout.json')
  path=ROOT/'资源库/01_各门店原图纸'/Path(source['source_pdf']).name
  with fitz.open(path) as doc:
   q=doc[source['physical_page']-1];q.remove_rotation();w,h=q.rect.width,q.rect.height;paths=q.get_drawings();canvas=CANVAS.get(n,[1888,1334])
   base=read(PREV/f'_cache/pilot-r8/{sid}/vector-candidates.json')['polygons']
   candidates=reconstruct(paths,w,h,base);seeds=[]
   def convert(r):return [r[j]*(w/canvas[0] if j%2==0 else h/canvas[1]) for j in range(4)] if r else None
   if n in (43,51,239,293,353):
    exp=read(OUT/f'柜体与标定实验/{sid}.json')
    for o in exp['items']:
     roi=o['selection_roi_canvas']
     if n==293 and o['id']==6:roi=[650,419,788,510]
     seeds.append(dict(label_text=o['label_text'],function=o['function'],h=o['height'],roi=convert(roi),evidence_method='vision',asset_candidates=[]))
   elif n in REPLACE:
    for label,fun,roi,height in REPLACE[n]:seeds.append(dict(label_text=label,function=fun,h=height,roi=convert(roi),evidence_method='vision',asset_candidates=[]))
   else:
    for o in target['items']:
     poly=o['evidence'].get('pdf_polygon');roi=bbox(poly)
     seeds.append(dict(label_text=o['label_text'],function=o['function'],h=o.get('h'),roi=roi,
       evidence_method='previous_vision_audited_vector' if roi else 'unresolved_previous_label',asset_candidates=o.get('asset_candidates',[])))
   for label,fun,roi,height in ADD.get(n,[]):seeds.append(dict(label_text=label,function=fun,h=height,roi=convert(roi),evidence_method='vision',asset_candidates=[]))
   needs_network=any(s['roi'] and select(s['roi'],candidates)[0] is None for s in seeds) or inp['boundary'] is None
   if needs_network:candidates.extend(network_candidates(paths,w,h))
   items=[]
   for s in seeds:
    c,score=select(s['roi'],candidates);poly=c['points'] if c else None
    bounds=bbox(poly);same=next((i for i in items if bounds and i['bbox_pdf'] and iou(bounds,i['bbox_pdf'])>.94),None)
    if same:
     same.setdefault('label_aliases',[]).append(s['label_text']);continue
    items.append(dict(id=f'object-{len(items)+1:03}',label_text=s['label_text'],function=s['function'],
      h=s['h'],height_unit='m',rotation=None,yaw=None,asset_candidates=s['asset_candidates'],
      bbox_pdf=bounds,pdf_polygon=poly,geometry=c,evidence=dict(method=s['evidence_method'],selection_roi_pdf=s['roi'],best_score=score),
      confidence=.7 if c else .2,training_eligible=False))
   boundary=None;berror=None
   if inp['boundary']:
    bp=inp['boundary']['points']
    if inp['coordinates']['unit']=='m':
     factor=inp['scale']['m_per_pdf_point'];origin=inp['coordinates']['boundary_bbox_origin_pdf'];bp=[[x/factor+origin[0],z/factor+origin[1]] for x,z in bp]
    boundary=dict(points=bp,kind=inp['boundary']['kind'],method='retained_previous_visual_boundary',area=Polygon(bp).area,bounds=bbox(bp))
   else:
    roi=BOUNDARY_ROI.get(n)
    if n==43:roi=[482,360,1196,974]
    boundary,score=select(convert(roi),candidates,.8)
    if boundary:boundary['kind']=None
    if boundary is None and n in BOUNDARY_TRACE:boundary,berror=snap_trace(BOUNDARY_TRACE[n],paths,canvas,w,h)
   anchors=[dict(axis=axis,value_mm=value,endpoints_canvas=ends) for axis,value,ends in DIM.get(n,[])] or DIMENSIONS.get(n,[])
   scale=dimension_lines(paths,anchors,canvas,w,h)
   if n in (1,19):
    scale=copy.deepcopy(inp['scale']);scale['m_per_point']=scale['m_per_pdf_point']
   evidence=old/'evidence.png';im=Image.open(evidence).convert('RGB');dr=ImageDraw.Draw(im);sx,sy=im.width/w,im.height/h
   if boundary:dr.line([(x*sx,y*sy) for x,y in boundary['points']],fill='#008cdd',width=5)
   for i in items:
    if i['pdf_polygon']:
     dr.line([(x*sx,y*sy) for x,y in i['pdf_polygon']],fill='#10862b',width=4)
     b=i['bbox_pdf'];dr.text((b[0]*sx,b[1]*sy),i['id'],fill='#10862b')
   for check in scale.get('checks') or []:
    pp=check.get('endpoints_pdf') or check.get('endpoints')
    if pp:dr.line([(x*sx,y*sy) for x,y in pp],fill='#b000cd',width=4)
   overlay=CACHE/f'{sid}-pilot-r10.png'
   with overlay.open('xb') as f:im.save(f,format='PNG')
   write(dd/'draft.json',dict(source_id=sid,source_pdf=str(path),source_sha256=source['sha256'],page=source['physical_page'],
    original_annotation=str(old),revision='r10',version_id='v1',version_confirmed=False,training_eligible=False,
    boundary=boundary,boundary_error=berror,items=items,scale=scale,unit='pdf_point',source=source,
    overlay=str(overlay),evidence=str(evidence),auto_status='partial',visual_check='pending',
    note='算法修订不是门店新版本；本文件保存原点为PDF左上角的几何，正式打包后按已验证比例换算。'))
   write(dd/'review.json',dict(source_id=sid,auto_status='partial',training_eligible=False,training_ready_auto=False,
    scale=scale,boundary=dict(present=bool(boundary),closed=bool(boundary and boundary['points'][0]==boundary['points'][-1]),semantic_confirmed=False),
    props=dict(records=len(items),located=sum(i['pdf_polygon'] is not None for i in items)),visual_check='pending',
    needs_human=['入口、障碍物、固定设施及全量道具清点未完整；必须另行检查。','版本未确认；原索引SI仅为弱标签。']))
   write(dd/'receipt.json',dict(source_id=sid,files={p.name:sha(p) for p in dd.iterdir() if p.is_file()}))
   with (OUT/'progress.jsonl').open('a',encoding='utf-8') as f:f.write(json.dumps({**meta(),'stage':'pilot_r10', 'source_id':sid,'status':'draft_pending_visual_audit'},ensure_ascii=False)+'\n')
   print(sid,'boundary',bool(boundary),'objects',sum(bool(i['pdf_polygon']) for i in items),'/',len(items),'scale',scale['status'],flush=True)
if __name__=='__main__':main()
