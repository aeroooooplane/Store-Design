"""Copy authorized new sources without modifying or overwriting any original."""
import hashlib,json,sys,shutil
from pathlib import Path
from datetime import datetime,timezone
from collections import defaultdict
import fitz
ROOT=Path(__file__).resolve().parents[3]
OUT=ROOT/'资源库/90_处理过程与审核/数据清洗-20261009/全量续跑-02'
DEST=ROOT/'资源库/01_各门店原图纸'
SOURCE=Path('D:/各门店图纸')
def meta():return dict(schemaVersion=1,generatedAt=datetime.now(timezone.utc).isoformat(),generator=dict(script='full-run-02/sync_sources.py',version='1.0.0'))
def sha(p):
 h=hashlib.sha256()
 with p.open('rb') as f:
  for b in iter(lambda:f.read(4*1024*1024),b''):h.update(b)
 return h.hexdigest()
def write(p,d):
 with p.open('x',encoding='utf-8') as f:json.dump({**meta(),**d},f,ensure_ascii=False,indent=2)
def main():
 sys.stdout.reconfigure(encoding='utf-8');OUT.mkdir(exist_ok=True)
 receipt=OUT/'00_同步与文件清单.json'
 if receipt.exists():
  print('已有同步完成清单；校验后跳过。')
  for row in json.loads(receipt.read_text(encoding='utf-8'))['incoming']:
   assert sha(Path(row['source']))==row['sha256'] and sha(Path(row['destination']))==row['sha256']
  return
 index=json.loads((ROOT/'资源库/00_资源索引/门店资源索引.json').read_text(encoding='utf-8'))['sources']
 byhash=defaultdict(list)
 for i in index:byhash[i['sha256']].append(i)
 existing={p:sha(p) for p in DEST.rglob('*') if p.is_file() and p.suffix.lower() in ('.pdf','.xlsx','.xls','.csv','.pptx','.rar')}
 lookup=defaultdict(list)
 for p,h in existing.items():lookup[h].append(p)
 incoming=[];conflicts=[]
 for src in sorted(SOURCE.rglob('*')):
  if not src.is_file():continue
  h=sha(src);dst=DEST/src.relative_to(SOURCE)
  if dst.exists():
   if sha(dst)!=h:conflicts.append(dict(source=str(src),destination=str(dst),reason='同名异内容，禁止覆盖'))
   action='already_present'
  elif h in lookup:dst=lookup[h][0];action='duplicate_content_reused'
  else:action='copy'
  incoming.append(dict(source=str(src),destination=str(dst),sha256=h,bytes=src.stat().st_size,action=action))
 if conflicts:
  write(OUT/'00_同步冲突.json',dict(conflicts=conflicts));raise RuntimeError('同步存在同名异内容，未开始复制，见冲突清单')
 write(OUT/'00_同步计划.json',dict(incoming=incoming,preexisting=[dict(path=str(p),sha256=h) for p,h in existing.items()]))
 for row in incoming:
  dst=Path(row['destination'])
  if row['action']=='copy':
   dst.parent.mkdir(exist_ok=True,parents=True)
   with Path(row['source']).open('rb') as src,dst.open('xb') as out:shutil.copyfileobj(src,out,4*1024*1024)
  assert sha(dst)==row['sha256']
  with (OUT/'progress.jsonl').open('a',encoding='utf-8') as f:f.write(json.dumps({**meta(),'stage':'source_sync',**row},ensure_ascii=False)+'\n')
 files=[];new=6
 for p in sorted(DEST.rglob('*')):
  if not p.is_file() or p.suffix.lower() not in ('.pdf','.xlsx','.xls','.csv','.pptx','.rar'):continue
  h=sha(p);matches=byhash.get(h,[]);preferred=next((i for i in matches if i['source_file']==p.name),matches[0] if matches else None)
  sid=preferred['source_id'] if preferred else f'NEW-{new:03d}'
  if preferred is None:new+=1
  row=dict(source_id=sid,path=str(p),filename=p.name,sha256=h,bytes=p.stat().st_size,
    format=p.suffix[1:].lower(),index_status='sha256_verified' if preferred else '未入索引',
    index_matches=matches,training_eligible=False,page_count=None,encrypted=None,damaged=None)
  if p.suffix.lower()=='.pdf':
   try:
    with fitz.open(p) as d:row.update(page_count=d.page_count,encrypted=bool(d.needs_pass),damaged=False)
   except Exception as e:row.update(damaged=True,error=str(e))
  files.append(row)
 duplicates=defaultdict(list)
 for row in files:duplicates[row['sha256']].append(row['source_id'])
 summary=dict(incoming_count=len(incoming),copied=sum(r['action']=='copy' for r in incoming),
  reused=sum(r['action']!='copy' for r in incoming),project_pdfs=sum(r['format']=='pdf' for r in files),
  pdf_pages=sum(r['page_count'] or 0 for r in files),unindexed_pdfs=sum(r['format']=='pdf' and not r['index_matches'] for r in files))
 write(receipt,dict(summary=summary,incoming=incoming,files=files,duplicates={h:s for h,s in duplicates.items() if len(s)>1},
  new_id_note='NEW-001…005已在原运行分配给2份PPTX和3份RAR；本次从NEW-006开始，避免编号冲突。'))
 print(json.dumps(summary,ensure_ascii=False))
if __name__=='__main__':main()
