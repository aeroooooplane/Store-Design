import sys,json
from pathlib import Path
import pymupdf as fitz
from PIL import Image,ImageDraw
from geometry_engine import reconstruct,select,dimension_lines
from sync_sources import ROOT,OUT,write,sha

CACHE=ROOT/'资源库/90_处理过程与审核/数据清洗-20261009/_cache/全量续跑-02'
PREV=ROOT/'资源库/90_处理过程与审核/数据清洗-20261009/方法对比-01'
ANN=ROOT/'资源库/90_处理过程与审核/训练标注'
DIMENSIONS={
43:[dict(axis='x',value_mm=8200,endpoints_canvas=[[482,313],[1197,313]]),dict(axis='z',value_mm=7050,endpoints_canvas=[[427,360],[427,974]])],
51:[dict(axis='x',value_mm=6700,endpoints_canvas=[[278,388],[1478,388]]),dict(axis='z',value_mm=2400,endpoints_canvas=[[1547,465],[1547,894]])],
239:[dict(axis='x',value_mm=5930,endpoints_canvas=[[361,267],[1305,267]]),dict(axis='z',value_mm=3400,endpoints_canvas=[[274,357],[274,898]])],
293:[dict(axis='x',value_mm=4760,endpoints_canvas=[[482,959],[1195,959]]),dict(axis='z',value_mm=1800,endpoints_canvas=[[914,590],[914,859]])],
353:[dict(axis='x',value_mm=8845,endpoints_canvas=[[300,286],[1558,286]]),dict(axis='z',value_mm=3835,endpoints_canvas=[[1591,411],[1591,956]])]
}
def main():
 sys.stdout.reconfigure(encoding='utf-8');CACHE.mkdir(exist_ok=True,parents=True)
 dest=OUT/'柜体与标定实验';dest.mkdir(exist_ok=True)
 selections=json.loads((PREV/'vision-selections.json').read_text(encoding='utf-8'))['cases']
 for ns,case in selections.items():
  n=int(ns);sid=f'PDF-{n:03}';target=dest/f'{sid}.json'
  if target.exists():continue
  source=json.loads((ANN/f'store-{n:04}/v1/source.json').read_text(encoding='utf-8'))
  path=ROOT/'资源库/01_各门店原图纸'/Path(source['source_pdf']).name
  assert sha(path)==source['sha256']
  with fitz.open(path) as d:
   q=d[source['physical_page']-1];q.remove_rotation();w,h=q.rect.width,q.rect.height;paths=q.get_drawings()
   base=json.loads((PREV.parent/f'_cache/pilot-r8/{sid}/vector-candidates.json').read_text(encoding='utf-8'))['polygons']
   candidates=reconstruct(paths,w,h,base);items=[]
   for i,(label,func,roi,height) in enumerate(case['items'],1):
    # Revised visual windows follow the actual curved cabinet extents, not a rectangle guess.
    if n==293 and i in (4,5,6):roi={4:[486,584,595,728],5:[538,484,695,619],6:[676,417,803,535]}[i]
    r=[roi[j]*(w/case['canvas'][0] if j%2==0 else h/case['canvas'][1]) for j in range(4)] if roi else None
    c,score=select(r,candidates)
    items.append(dict(id=i,label_text=label,function=func,height=height,selection_roi_canvas=roi,geometry=c,best_score=score))
   scale=dimension_lines(paths,DIMENSIONS[n],case['canvas'],w,h)
   im=Image.open(ANN/f'store-{n:04}/v1/evidence.png').convert('RGB');draw=ImageDraw.Draw(im);sx,sy=im.width/w,im.height/h
   for item in items:
    if item['geometry']:
     pts=item['geometry']['points'];draw.line([(x*sx,y*sy) for x,y in pts],fill='#148b38',width=4)
     x,y=pts[0];draw.text((x*sx,y*sy),str(item['id']),fill='#148b38')
   for a in scale['checks']:
    if a['endpoints_pdf']:draw.line([(x*sx,y*sy) for x,y in a['endpoints_pdf']],fill='#a000d0',width=4)
   image=CACHE/f'{sid}-reconstruction.png'
   with image.open('xb') as f:im.save(f,format='PNG')
   write(target,dict(source_id=sid,page=source['physical_page'],source_sha256=source['sha256'],draft=True,
       training_eligible=False,items=items,scale=scale,overlay=str(image),geometry_unit='pdf_point',
       method='vision_selection_and_original_path_face_union',visual_check='pending'))
   print(sid,'found',sum(x['geometry'] is not None for x in items),'/',len(items),'scale',scale['status'],scale['error'],flush=True)
if __name__=='__main__':main()
