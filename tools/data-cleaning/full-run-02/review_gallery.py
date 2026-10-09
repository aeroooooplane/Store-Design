"""Render uncertain pages faithfully for actual visual review, not guessed image labels."""
import sys,argparse,math,json
from pathlib import Path
from concurrent.futures import ProcessPoolExecutor,as_completed
import pymupdf as fitz
from PIL import Image,ImageDraw,ImageFont
from scan_all import read
from sync_sources import OUT,write,meta,sha
from raster_pages import DEST as RASTER

BASE=OUT.parent/'_cache/全量续跑-02/page-review'
def run(row):
 sid=row['source_id'];dest=BASE/sid;dest.mkdir(parents=True,exist_ok=True)
 if (dest/'receipt.json').exists():return dict(source_id=sid,status='skip')
 pages=read(RASTER/sid/'classified.json')['pages'];selected=[p for p in pages if p['type'] in ('other','render','photo') or p['confidence']<.8]
 images=[]
 with fitz.open(row['path']) as doc:
  for p in selected:
   n=p['page'];file=dest/f'p{n:03}.png'
   if not file.exists():
    q=doc[n-1];q.remove_rotation();s=2000/max(q.rect.width,q.rect.height);pix=q.get_pixmap(matrix=fitz.Matrix(s,s),alpha=False)
    with file.open('xb') as f:f.write(pix.tobytes('png'))
   images.append(dict(source_id=sid,page=n,classification=p['type'],confidence=p['confidence'],image=str(file),image_sha256=sha(file)))
 sheets=[]
 font=ImageFont.truetype('C:/Windows/Fonts/arial.ttf',28)
 for start in range(0,len(images),6):
  group=images[start:start+6];file=dest/f'contact-{start//6+1:02}.png';canvas=Image.new('RGB',(2700,2*700),'#e5e5e5');dr=ImageDraw.Draw(canvas)
  for j,a in enumerate(group):
   im=Image.open(a['image']).convert('RGB');im.thumbnail((890,645));x=(j%3)*900;y=(j//3)*700
   canvas.paste(im,(x+(900-im.width)//2,y+48));dr.text((x+10,y+7),f"{sid} p{a['page']:03} [{a['classification']}]",font=font,fill='black')
  if not file.exists():
   with file.open('xb') as f:canvas.save(f,format='PNG')
  sheets.append(dict(image=str(file),pages=[a['page'] for a in group],sha256=sha(file),visual_review='pending'))
 write(dest/'receipt.json',dict(source_id=sid,source_sha256=row['sha256'],pages=images,contact_sheets=sheets,
  generator=dict(script='review_gallery.py',version='1.0.0'),note='生成缩略图不等于已实际进行视觉审核。'))
 return dict(source_id=sid,status='rendered_pending_vision',pages=len(images),sheets=len(sheets))
def main():
 sys.stdout.reconfigure(encoding='utf-8');ap=argparse.ArgumentParser();ap.add_argument('--workers',type=int,default=2);ap.add_argument('--limit',type=int);args=ap.parse_args();BASE.mkdir(parents=True,exist_ok=True)
 rows=[r for r in read(OUT/'00_同步与文件清单.json')['files'] if r['format']=='pdf' and (RASTER/r['source_id']/'classified.json').exists() and not(BASE/r['source_id']/'receipt.json').exists()]
 if args.limit:rows=rows[:args.limit]
 with ProcessPoolExecutor(max_workers=args.workers) as ex:
  fs={ex.submit(run,r):r for r in rows}
  for i,f in enumerate(as_completed(fs),1):
   try:r=f.result()
   except Exception as e:r=dict(source_id=fs[f]['source_id'],status='failed',error=str(e))
   with (OUT/'progress.jsonl').open('a',encoding='utf-8') as out:out.write(json.dumps({**meta(),'stage':'page_visual_evidence_render',**r},ensure_ascii=False)+'\n')
   print(i,len(rows),json.dumps(r,ensure_ascii=False),flush=True)
if __name__=='__main__':main()
