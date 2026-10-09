"""Read every source page; exclusive per-source receipts, resumable, no export approval."""
import sys,json,re,os,hashlib,traceback,argparse
from pathlib import Path
from concurrent.futures import ProcessPoolExecutor,as_completed
from collections import Counter
import pymupdf as fitz
from sync_sources import ROOT,OUT,write,meta
sys.path.insert(0,str(ROOT/'tools/data-cleaning'))
from revision2 import classify2

CACHE=OUT.parent/'_cache/全量续跑-02/scans'
def read(p):return json.loads(Path(p).read_text(encoding='utf-8-sig'))
def classify(q,spans,paths,ims):
 w,h=q.rect.width,q.rect.height
 ratio=min(1,sum(max(0,a['bbox'][2]-a['bbox'][0])*max(0,a['bbox'][3]-a['bbox'][1]) for a in ims)/(w*h))
 p=dict(page_rect=list(q.rect),rotation=0,original_rotation=q.rotation,text=spans,images=ims,
  signals=dict(vector_path_count=len(paths),bitmap_area_ratio=round(ratio,4),text_span_count=len(spans)))
 p=classify2(p);ls=p['joined_text'];compact=''.join(a['text'].replace(' ','') for a in ls)
 if re.search(r'图纸目录|图纸索引|DRAWINGINDEX',compact,re.I):
  p.update(type='cover_index',confidence=.98,title='图纸目录/索引')
 if p['type']=='other':
  extra=[('plan_layout',r'家具定位|平面(?:布置|布局|配置)|FURNITURE.{0,8}PLAN|LAYOUT PLAN'),
   ('plan_original',r'原始.{0,8}平面|原建筑|EXISTING PLAN'),('plan_other',r'天花|灯具|地面铺|地坪|地台尺寸|插座|电气|强弱电|照明|CEILING PLAN'),
   ('elevation',r'立面图|剖面图|节点|大样|详图|ELEVATION|SECTION|DETAIL'),
   ('material',r'材料表|材料说明|物料表|软装清单|MATERIAL'),('render',r'效果图|RENDERING'),('photo',r'现场照片|现状照片')]
  hits=[]
  for s in ls:
   b=s['bbox'];t=s['text'].strip()
   if len(t)>70:continue
   for typ,pat in extra:
    if re.search(pat,t,re.I):
     score=(3 if b[0]>.8*w and b[1]>.5*h else 2 if b[1]>.82*h or b[1]<.13*h else 1)
     hits.append((score,s['size'],typ,s))
  if hits:
   hits.sort(key=lambda a:(a[0],a[1]),reverse=True);a=hits[0]
   p.update(type=a[2],confidence=.88 if a[0]>=2 else .6,title=a[3]['text']);p['signals']['fallback_title_hits']=[x[3] for x in hits]
  elif ratio>.6 and len(paths)<100:
   # Appearance alone cannot distinguish a photograph from a render.
   p.update(type='other',confidence=.25);p['signals']['candidate_types']=['render','photo']
 p['signals'].update(requires_vision=p['confidence']<.8,classifier='scan_all.py/1.0.0')
 p['frames']=None;p['frame_detection_status']='unverified'
 return p

def scan(row):
 sid=row['source_id'];dest=CACHE/f'{sid}.json'
 if dest.exists():
  r=read(dest)
  if r['sha256']!=row['sha256']:raise RuntimeError('Resume SHA mismatch '+sid)
  return dict(source_id=sid,status='skipped_receipt',pages=len(r['pages']),types=dict(Counter(x['type'] for x in r['pages'])))
 pages=[];errors=[];imhash={}
 try:
  with fitz.open(row['path']) as doc:
   for n,q in enumerate(doc):
    original=q.rotation;q.remove_rotation()
    try:
     spans=[]
     for b in q.get_text('dict',flags=fitz.TEXTFLAGS_DICT & ~fitz.TEXT_PRESERVE_IMAGES)['blocks']:
      for line in b.get('lines',[]):
       for s in line['spans']:
        if s['text'].strip():spans.append(dict(text=s['text'],bbox=list(s['bbox']),size=s['size'],direction=list(line['dir'])))
     paths=q.get_drawings();ims=[]
     for i in q.get_image_info(hashes=True,xrefs=True):
      x=i.get('xref');digest=None
      if x:
       if x not in imhash:
        data=doc.extract_image(x);imhash[x]=hashlib.sha256(data['image']).hexdigest() if data else None
       digest=imhash[x]
      ims.append(dict(bbox=list(i['bbox']),width=i['width'],height=i['height'],xref=x,sha256=digest,
       sha256_basis='extracted_embedded_image_bytes' if digest else None,method='pdf_image_object',view_description=None,same_layout=None))
     p=classify(q,spans,paths,ims);p.update(**meta(),source_id=sid,page=n+1,original_rotation=original)
    except Exception as e:
     p=dict(**meta(),source_id=sid,page=n+1,type='other',confidence=0,title=None,signals=dict(error=str(e),requires_vision=True),frames=None,text=[],joined_text=[],images=[],page_rect=list(q.rect))
     errors.append(dict(page=n+1,error=str(e)))
    pages.append(p)
 except Exception as e:errors.append(dict(error=str(e)))
 write(dest,dict(source_id=sid,sha256=row['sha256'],source_pdf=row['path'],pages=pages,errors=errors,
  generator=dict(script='full-run-02/scan_all.py',version='1.0.0'),training_eligible=False))
 return dict(source_id=sid,status='done' if not errors else 'partial',pages=len(pages),types=dict(Counter(x['type'] for x in pages)),errors=errors)

def main():
 sys.stdout.reconfigure(encoding='utf-8');a=argparse.ArgumentParser();a.add_argument('--workers',type=int,default=4);args=a.parse_args()
 gate=read(OUT/'试点验收-r12.json');assert gate['gate_passed'] and gate['gate_ratio']>=.8
 CACHE.mkdir(parents=True,exist_ok=True)
 rows=[r for r in read(OUT/'00_同步与文件清单.json')['files'] if r['format']=='pdf']
 with ProcessPoolExecutor(max_workers=args.workers) as pool:
  fs={pool.submit(scan,row):row for row in rows}
  for i,f in enumerate(as_completed(fs),1):
   try:r=f.result()
   except Exception as e:r=dict(source_id=fs[f]['source_id'],status='failed',error=str(e))
   with (OUT/'progress.jsonl').open('a',encoding='utf-8') as out:
    out.write(json.dumps({**meta(),'stage':'all_page_scan',**r},ensure_ascii=False)+'\n');out.flush();os.fsync(out.fileno())
   print(i,len(rows),json.dumps(r,ensure_ascii=False),flush=True)
if __name__=='__main__':main()
