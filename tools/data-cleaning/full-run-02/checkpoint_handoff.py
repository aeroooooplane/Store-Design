"""Low-load, read-only audit of completed artifacts before copying to another PC."""
import json,hashlib,sys,collections
from pathlib import Path
from datetime import datetime,timezone
ROOT=Path(__file__).resolve().parents[3]
RUN=ROOT/'资源库/90_处理过程与审核/数据清洗-20261009'
OUT=RUN/'全量续跑-02';CACHE=RUN/'_cache/全量续跑-02'
HANDOFF=RUN/'迁移交接-20261009-1503'
def read(p):return json.loads(p.read_text(encoding='utf-8-sig'))
def digest(p):
 h=hashlib.sha256()
 with p.open('rb') as f:
  for b in iter(lambda:f.read(1024*1024),b''):h.update(b)
 return h.hexdigest()
def main():
 sys.stdout.reconfigure(encoding='utf-8');HANDOFF.mkdir()
 metadata=dict(schemaVersion=1,generatedAt=datetime.now(timezone.utc).isoformat(),generator=dict(script='checkpoint_handoff.py',version='1.0.0'))
 bad=[];stage={};missing={};partial={};pdfs=[r for r in read(OUT/'00_同步与文件清单.json')['files'] if r['format']=='pdf'];ids={r['source_id'] for r in pdfs}
 for label,base,pattern in [('page_scan',CACHE/'scans','*.json'),('title_ocr',CACHE/'ocr','*/receipt.json'),('raster_recovery',CACHE/'raster','*/receipt.json'),('geometry_r2',OUT/'平面候选-r2','*/receipt.json'),('geometry_r3',OUT/'平面候选-r3','*/receipt.json'),('review_gallery',CACHE/'page-review','*/receipt.json')]:
  valid={};pages=0
  for p in base.glob(pattern):
   try:
    d=read(p);sid=d.get('source_id',p.stem if pattern=='*.json' else p.parent.name);valid[sid]=str(p.relative_to(ROOT));pages+=len(d.get('pages',[])) if isinstance(d.get('pages'),list) else d.get('pages',0) if isinstance(d.get('pages'),int) else 0
   except Exception as e:bad.append(dict(path=str(p.relative_to(ROOT)),reason=str(e)))
  stage[label]=dict(valid_source_receipts=len(valid),page_count=pages,source_ids=sorted(valid),receipts=valid);missing[label]=sorted(ids-set(valid))
  if pattern!='*.json':partial[label]=[str(p.relative_to(ROOT)) for p in base.iterdir() if p.is_dir() and p.name in ids and not(p/'receipt.json').exists()]
 counts=collections.Counter();total=0;files=[]
 for base in [ROOT/'tools/data-cleaning',RUN]:
  for p in base.rglob('*'):
   if not p.is_file() or '.venv' in p.parts or '__pycache__' in p.parts or HANDOFF in p.parents:continue
   stat=p.stat();total+=stat.st_size;counts[p.suffix]+=1;files.append(dict(path=str(p.relative_to(ROOT)),bytes=stat.st_size))
   if p.suffix=='.json':
    try:read(p)
    except Exception as e:
     if not any(a['path']==str(p.relative_to(ROOT)) for a in bad):bad.append(dict(path=str(p.relative_to(ROOT)),reason=str(e)))
 for p in (ROOT/'资源库/01_各门店原图纸').rglob('*'):
  if p.is_file():files.append(dict(path=str(p.relative_to(ROOT)),bytes=p.stat().st_size));total+=p.stat().st_size
 essentials=[OUT/'00_同步与文件清单.json',OUT/'progress.jsonl',OUT/'试点验收-r12.json']+list((ROOT/'tools/data-cleaning').rglob('*.py'))+list((ROOT/'tools/data-cleaning/full-run-02').glob('requirements.txt'))
 essential_hashes={str(p.relative_to(ROOT)):digest(p) for p in essentials if '.venv' not in p.parts and '__pycache__' not in p.parts}
 pilot=read(OUT/'试点验收-r12.json')
 summary=dict(pdf_files=len(pdfs),physical_pages=sum(r['page_count'] or 0 for r in pdfs),unique_pdf_sha256=len({r['sha256'] for r in pdfs}),
  completed_stages={k:dict(sources=v['valid_source_receipts'],pages=v['page_count']) for k,v in stage.items()},
  geometry_r2_draft_pages=len(list((OUT/'平面候选-r2').glob('*/p*/draft.json'))),auto_scale_candidate_pages=len(list((OUT/'自动比例候选').glob('*.json'))),
  pilot_gate_ratio=pilot['gate_ratio'],pilot_auto_status=dict(complete=0,partial=20,failed=0),pilot_training_candidates=0,
  invalid_json_files=len(bad),partial_stage_directories=sum(map(len,partial.values())),transfer_files=len(files),transfer_bytes=total)
 report={**metadata,'summary':summary,'stages':stage,'missing':missing,'partial_directories':partial,'invalid_json':bad,'essential_sha256':essential_hashes,
  'compute_status':'stopped_for_handoff','training_eligible':False,'note':'Completed receipts are checkpoints; rendered images or raw scans do not mean completed semantic/visual cleaning.'}
 with (HANDOFF/'checkpoint.json').open('x',encoding='utf-8') as f:json.dump(report,f,ensure_ascii=False,indent=2)
 with (HANDOFF/'transfer-files.json').open('x',encoding='utf-8') as f:json.dump({**metadata,'files':files},f,ensure_ascii=False,indent=2)
 print(json.dumps(summary,ensure_ascii=False,indent=2),flush=True)
 print('PARTIAL',json.dumps(partial,ensure_ascii=False),flush=True);print('INVALID',json.dumps(bad,ensure_ascii=False),flush=True)
if __name__=='__main__':main()
