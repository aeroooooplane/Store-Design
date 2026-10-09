"""Batch scale proposals, with cheap point-to-segment tests and audit overlays."""
import sys,argparse,json,math
from pathlib import Path
from concurrent.futures import ProcessPoolExecutor,as_completed
from PIL import Image,ImageDraw
import pymupdf as fitz
import scale_candidates as first
from scale_candidates_v3 import refine
from scan_all import read,CACHE as SCANS
from sync_sources import OUT,write,meta,sha
from ocr_pages import BASE as OCR

class FastLine:
 def __init__(self,points):self.a,self.b=points
 def distance(self,p):
  a,b=self.a,self.b
  if p[0]<min(a[0],b[0])-3 or p[0]>max(a[0],b[0])+3 or p[1]<min(a[1],b[1])-3 or p[1]>max(a[1],b[1])+3:return 999.
  dx,dy=b[0]-a[0],b[1]-a[1];t=max(0,min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/(dx*dx+dy*dy)))
  return math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dy)
first.LineString=FastLine
first.Point=lambda a:a

DEST=OUT/'自动比例候选'
def run(path):
 d=read(path);sid,n=d['source_id'],d['page'];out=DEST/f'{sid}-p{n:03}.json'
 if out.exists():return dict(source_id=sid,page=n,status='skip')
 full=OCR/'full_plans'/f'{sid}-p{n:03}.json';raw=read(SCANS/f'{sid}.json');text=list(raw['pages'][n-1]['text'])
 if full.exists():text+=read(full)['text']
 with fitz.open(d['source_pdf']) as doc:
  p=doc[n-1];p.remove_rotation();w,h=p.rect.width,p.rect.height;paths=p.get_drawings()
  initial=first.propose(paths,text,w,h);seen=set();checks=[]
  for c in initial.get('checks',[]):
   key=(c['axis'],c['value_mm'],c['path_id'],c['item_id'])
   if key not in seen:seen.add(key);checks.append(c)
  initial['checks']=checks;scale=refine(paths,initial)
 overlay=None
 if scale.get('selected'):
  im=Image.open(d['evidence']).convert('RGB');dr=ImageDraw.Draw(im);sx,sy=im.width/w,im.height/h
  for c in scale['selected']:
   dr.line([(x*sx,y*sy) for x,y in c['endpoints_pdf']],fill='#bd00cd',width=4)
   for x,y in c['endpoints_pdf']:dr.ellipse([x*sx-5,y*sy-5,x*sx+5,y*sy+5],outline='#bd00cd',width=2)
  overlay=OUT.parent/'_cache/全量续跑-02/scale-overlays'/f'{sid}-p{n:03}.png';overlay.parent.mkdir(exist_ok=True)
  with overlay.open('xb') as f:im.save(f,format='PNG')
 write(out,dict(source_id=sid,page=n,source_sha256=d['source_sha256'],draft=str(path),draft_sha256=sha(path),scale=scale,
  overlay=str(overlay) if overlay else None,visual_check='pending',training_eligible=False,generator=dict(script='propose_scales_all.py',version='1.0.0')))
 return dict(source_id=sid,page=n,status=scale['status'],error=scale.get('error'))

def main():
 sys.stdout.reconfigure(encoding='utf-8');ap=argparse.ArgumentParser();ap.add_argument('--workers',type=int,default=2);ap.add_argument('--limit',type=int);args=ap.parse_args();DEST.mkdir(exist_ok=True)
 paths={}
 for folder in ['平面候选-r2','平面候选-r3']:
  for p in (OUT/folder).glob('*/p*/draft.json'):
   if not(DEST/f'{p.parent.parent.name}-{p.parent.name}.json').exists():paths[(p.parent.parent.name,p.parent.name)]=p
 jobs=list(paths.values());jobs=jobs[:args.limit] if args.limit else jobs
 with ProcessPoolExecutor(max_workers=args.workers) as ex:
  fs={ex.submit(run,p):p for p in jobs}
  for i,f in enumerate(as_completed(fs),1):
   try:r=f.result()
   except Exception as e:r=dict(draft=str(fs[f]),status='failed',error=str(e))
   with (OUT/'progress.jsonl').open('a',encoding='utf-8') as out:out.write(json.dumps({**meta(),'stage':'auto_scale_proposal',**r},ensure_ascii=False)+'\n')
   print(i,len(jobs),json.dumps(r,ensure_ascii=False),flush=True)
if __name__=='__main__':main()
