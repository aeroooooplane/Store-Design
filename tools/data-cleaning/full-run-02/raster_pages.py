"""Recover bitmap plan pages; do not mistake chapter dividers for drawings."""
import sys,json,argparse,copy,re
from concurrent.futures import ProcessPoolExecutor,as_completed
import pymupdf as fitz,numpy as np
import extract_enriched as enriched
from ocr_pages import BASE as OCR,ocr
from classification_v4 import classify
from scan_all import read
from sync_sources import OUT,write,meta

DEST=OUT.parent/'_cache/全量续跑-02/raster'
def classify_chapter(p):
 d=classify(p);txt=' '.join(s['text'] for s in d['text']);v=d['signals'].get('vector_path_count',0);b=d['signals'].get('bitmap_area_ratio',0)
 if (d['type'] in ('plan_layout','render') and v<50 and b<.2) or re.search(r'方案汇报|PROPOSAL\s*PRESENTATION|THANKS|谢谢观看',txt,re.I):
  d.update(type='cover_index',confidence=.96,title='章节页/封面/结束页');d['signals']['chapter_without_drawing']=True;d['signals']['requires_vision']=False
 return d
def run(row):
 sid=row['source_id'];dd=DEST/sid;dd.mkdir(parents=True,exist_ok=True)
 if (dd/'receipt.json').exists():return dict(source_id=sid,status='skip')
 pages=read(OCR/sid/'classified.json')['pages'];result=[];recovered=[]
 with fitz.open(row['path']) as doc:
  for p in pages:
   d=classify_chapter(p);n=d['page'];cache=dd/f'p{n:03}.json';extra=[]
   if cache.exists():probe=read(cache);extra=probe.get('text',[])
   elif d['type']=='other' and d['signals'].get('bitmap_area_ratio',0)>.35:
    q=doc[n-1];q.remove_rotation();w,h=q.rect.width,q.rect.height
    pix=q.get_pixmap(matrix=fitz.Matrix(400/max(w,h),400/max(w,h)),alpha=False)
    rgb=np.frombuffer(pix.samples,np.uint8).reshape(pix.height,pix.width,3);white=float(np.mean(np.min(rgb,axis=2)>225));gray=float(np.mean(np.max(rgb,axis=2)-np.min(rgb,axis=2)<12))
    probe=dict(source_id=sid,page=n,source_sha256=row['sha256'],white_fraction=white,gray_fraction=gray,method='raster_pixel_statistics',text=[])
    if white>.58 and gray>.55:
     extra=ocr(q,[0,0,w,h],2500/max(w,h));probe.update(text=extra,method='raster_statistics_then_local_ocr')
    write(cache,probe)
   if extra:
    d=copy.deepcopy(p);d['text']=d['text']+[a for a in extra if a.get('ocr_confidence',0)>=.88];d=classify_chapter(d);d['signals']['raster_ocr_evidence']=str(cache)
    if d['type']=='plan_layout':recovered.append(n)
   result.append(d)
 write(dd/'classified.json',dict(source_id=sid,sha256=row['sha256'],pages=result,generator=dict(script='raster_pages.py',version='1.0.0')))
 write(dd/'receipt.json',dict(source_id=sid,source_sha256=row['sha256'],pages=len(result),recovered_plans=recovered))
 return dict(source_id=sid,status='done',recovered_plans=recovered)
def main():
 sys.stdout.reconfigure(encoding='utf-8');ap=argparse.ArgumentParser();ap.add_argument('--workers',type=int,default=2);args=ap.parse_args();DEST.mkdir(parents=True,exist_ok=True)
 rows=[r for r in read(OUT/'00_同步与文件清单.json')['files'] if r['format']=='pdf' and (OCR/r['source_id']/'classified.json').exists() and not(DEST/r['source_id']/'receipt.json').exists()]
 with ProcessPoolExecutor(max_workers=args.workers) as ex:
  fs={ex.submit(run,r):r for r in rows}
  for i,f in enumerate(as_completed(fs),1):
   try:r=f.result()
   except Exception as e:r=dict(source_id=fs[f]['source_id'],status='failed',error=str(e))
   with (OUT/'progress.jsonl').open('a',encoding='utf-8') as out:out.write(json.dumps({**meta(),'stage':'raster_plan_recovery',**r},ensure_ascii=False)+'\n')
   print(i,len(rows),json.dumps(r,ensure_ascii=False),flush=True)
if __name__=='__main__':main()
