"""Local-only OCR of outlined CAD titles and plan labels. No source uploads."""
import sys,json,argparse,time,copy,re
from pathlib import Path
from concurrent.futures import ProcessPoolExecutor,as_completed
import pymupdf as fitz
import numpy as np
from rapidocr_onnxruntime import RapidOCR
from sync_sources import OUT,ROOT,write,meta,sha
from scan_all import CACHE as SCANS,read
from classification_v3 import classify

BASE=OUT.parent/'_cache/全量续跑-02/ocr'
ENGINE=None
def engine():
 global ENGINE
 if ENGINE is None:ENGINE=RapidOCR(intra_op_num_threads=1,inter_op_num_threads=1,det_limit_side_len=960,max_side_len=3000)
 return ENGINE
def ocr(q,rect,scale):
 pix=q.get_pixmap(matrix=fitz.Matrix(scale,scale),clip=fitz.Rect(rect),alpha=False)
 arr=np.frombuffer(pix.samples,np.uint8).reshape(pix.height,pix.width,pix.n)[:,:,:3]
 r,elapsed=engine()(arr)
 out=[]
 for quad,t,score in r or []:
  pts=[[x/scale+rect[0],y/scale+rect[1]] for x,y in quad]
  xs=[p[0] for p in pts];ys=[p[1] for p in pts]
  b=[min(xs),min(ys),max(xs),max(ys)]
  out.append(dict(text=t,bbox=b,size=max(1,min(b[2]-b[0],b[3]-b[1])),direction=[1,0],method='ocr',ocr_confidence=float(score),quad=pts,
   engine='rapidocr-onnxruntime/1.4.4',render_scale=scale,clip_pdf=rect))
 return out
def run(row):
 sid=row['source_id'];dest=BASE/sid;dest.mkdir(parents=True,exist_ok=True);receipt=dest/'receipt.json'
 if receipt.exists():return dict(source_id=sid,status='skip')
 raw=read(SCANS/f'{sid}.json');result=[];count=0;plans=[]
 with fitz.open(row['path']) as doc:
  for p in raw['pages']:
   d=classify(p);n=d['page'];file=dest/f'p{n:03}.json';extra=[]
   if file.exists():a=read(file);extra=a['text']
   elif d['type']=='other' and d['signals'].get('vector_path_count',0)>100:
    q=doc[n-1];q.remove_rotation();w,h=q.rect.width,q.rect.height;s=3000/max(w,h)
    clips=[[w*.78,h*.44,w,h],[0,h*.84,w*.86,h]]
    for clip in clips:
     extra.extend(ocr(q,clip,s))
     trial=copy.deepcopy(p);trial['text']=trial['text']+[a for a in extra if a['ocr_confidence']>=.85];trial=classify(trial)
     if trial['type']!='other':break
    write(file,dict(source_id=sid,page=n,source_sha256=row['sha256'],method='ocr',text=extra,generator=dict(script='ocr_pages.py',version='1.0.0')));count+=1
   if extra:
    d=copy.deepcopy(p);d['text']=d['text']+[a for a in extra if a['ocr_confidence']>=.85];d=classify(d)
    d['signals']['ocr_evidence_file']=str(file)
   result.append(d)
   if d['type']=='plan_layout':plans.append(n)
 write(dest/'classified.json',dict(source_id=sid,sha256=row['sha256'],pages=result,generator=dict(script='ocr_pages.py',version='1.0.0')))
 write(receipt,dict(source_id=sid,sha256=row['sha256'],pages=len(result),ocr_title_pages=count,plans=plans))
 return dict(source_id=sid,status='done',ocr_title_pages=count,plans=plans)
def main():
 sys.stdout.reconfigure(encoding='utf-8');ap=argparse.ArgumentParser();ap.add_argument('--workers',type=int,default=3);ap.add_argument('--sources',nargs='*');args=ap.parse_args()
 BASE.mkdir(parents=True,exist_ok=True)
 rows=[r for r in read(OUT/'00_同步与文件清单.json')['files'] if r['format']=='pdf' and (SCANS/f"{r['source_id']}.json").exists() and not(BASE/r['source_id']/'receipt.json').exists() and (not args.sources or r['source_id'] in args.sources)]
 with ProcessPoolExecutor(max_workers=args.workers) as ex:
  fs={ex.submit(run,r):r for r in rows}
  for i,f in enumerate(as_completed(fs),1):
   try:r=f.result()
   except Exception as e:r=dict(source_id=fs[f]['source_id'],status='failed',error=str(e))
   with (OUT/'progress.jsonl').open('a',encoding='utf-8') as out:out.write(json.dumps({**meta(),'stage':'ocr_titles',**r},ensure_ascii=False)+'\n')
   print(i,len(rows),json.dumps(r,ensure_ascii=False),flush=True)
if __name__=='__main__':main()
