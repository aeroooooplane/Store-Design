"""Single-process, sequential-stage continuation. Default is read-only preflight.

Keep the project at D:\\text demo on the destination. Existing artifacts are
read-only; an interrupted geometry directory gets a separate recovery namespace.
This continues machine extraction only, not visual acceptance or final reporting.
"""
import argparse,hashlib,json,os,subprocess,sys
from pathlib import Path
from datetime import datetime,timezone
ROOT=Path(__file__).resolve().parents[3]
RUN=ROOT/'资源库/90_处理过程与审核/数据清洗-20261009'
OUT=RUN/'全量续跑-02';C=RUN/'_cache/全量续跑-02'
H=RUN/'迁移交接-20261009-1503'
STAGES=['scan','ocr','raster','geometry','recover','scales']
def read(p):return json.loads(Path(p).read_text(encoding='utf-8-sig'))
def digest(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def meta():return dict(schemaVersion=1,generatedAt=datetime.now(timezone.utc).isoformat(),generator=dict(script='resume_checkpoint_v2.py',version='2.0.0'))
def preflight():
 cp=read(H/'checkpoint.json');missing=[]
 original_sizes={a['path']:a['bytes'] for a in read(H/'transfer-files.json')['files']}
 for name,h in cp['essential_sha256'].items():
  p=ROOT/name
  if p.name=='progress.jsonl' and p.exists():
   size=original_sizes[name]
   with p.open('rb') as f:valid=p.stat().st_size>=size and hashlib.sha256(f.read(size)).hexdigest()==h
  else:valid=p.exists() and digest(p)==h
  if not valid:missing.append(name)
 assert not missing,'Missing/changed checkpoint files: '+str(missing)
 assert str(ROOT).replace('\\','/').lower()=='d:/text demo','此入口要求保持 D:\\text demo；其他盘符请先做运行时路径映射，不要修改旧证据。'
 rows=read(OUT/'00_同步与文件清单.json')['files']
 assert all(Path(r['path']).is_file() and Path(r['path']).stat().st_size==r['bytes'] for r in rows),'源文件丢失或长度变化'
 # Preserve partial directories. Page-level OCR caches can be reused as-is.
 for group in ['title_ocr','raster_recovery']:
  for rel in cp['partial_directories'][group]:
   for p in (ROOT/rel).glob('*.json'):read(p)
 print(json.dumps(cp['summary'],ensure_ascii=False,indent=2),flush=True)
 print('Preflight passed. No cleaning started unless --execute is supplied.',flush=True)
 return rows
def run_stage(stage,rows,stop):
 rows=[r for r in rows if r['format']=='pdf'];runner=None;jobs=[]
 if stage=='scan':
  import scan_all as m
  runner=m.scan;jobs=[r for r in rows if not(m.CACHE/f"{r['source_id']}.json").exists()]
 elif stage=='ocr':
  import ocr_fast_v4 as fast
  m=fast.run.base;runner=m.run;jobs=[r for r in rows if (C/'scans'/f"{r['source_id']}.json").exists() and not(m.BASE/r['source_id']/'receipt.json').exists()]
 elif stage=='raster':
  import raster_pages as m
  runner=m.run;jobs=[r for r in rows if (C/'ocr'/r['source_id']/'receipt.json').exists() and not(m.DEST/r['source_id']/'receipt.json').exists()]
 elif stage in ('geometry','recover'):
  if stage=='geometry':
   import extract_enriched_v4 as wrapper
   m=wrapper.run.base
   jobs=[r for r in rows if (C/'ocr'/r['source_id']/'receipt.json').exists() and not(m.DEST/r['source_id']/'receipt.json').exists()]
  else:
   import extract_final as wrapper
   m=wrapper.run.base
   jobs=[r for r in m.read(OUT/'00_同步与文件清单.json')['files'] if not(m.DEST/r['source_id']/'receipt.json').exists()]
  m.DEST.mkdir(exist_ok=True)
  def runner(row):
   original_dest,original_cache=m.DEST,m.CACHE
   try:
    if (m.DEST/row['source_id']).exists() and not(m.DEST/row['source_id']/'receipt.json').exists():
     m.DEST=OUT/f'平面候选-迁移续跑-{stage}-r4';m.CACHE=C/f'geometry-handoff-{stage}-r4';m.DEST.mkdir(exist_ok=True)
    return m.run(row)
   finally:m.DEST,m.CACHE=original_dest,original_cache
 elif stage=='scales':
  import propose_scales_all as m
  m.DEST.mkdir(exist_ok=True);paths={}
  for folder in ['平面候选-r2','平面候选-r3','平面候选-迁移续跑-geometry-r4','平面候选-迁移续跑-recover-r4']:
   for p in (OUT/folder).glob('*/p*/draft.json'):
    if not(m.DEST/f'{p.parent.parent.name}-{p.parent.name}.json').exists():paths[(p.parent.parent.name,p.parent.name)]=p
  jobs=list(paths.values());runner=m.run
 errors=[]
 for i,job in enumerate(jobs,1):
  if stop.exists():print('STOP requested; current source is saved. Remaining queue retained.',flush=True);return 3
  try:r=runner(job)
  except Exception as e:r=dict(status='failed',source_id=job.get('source_id') if isinstance(job,dict) else str(job),error=str(e));errors.append(r)
  with (OUT/'progress.jsonl').open('a',encoding='utf-8') as f:
   f.write(json.dumps({**meta(),'stage':'handoff_'+stage,**r},ensure_ascii=False)+'\n');f.flush();os.fsync(f.fileno())
  print(stage,i,len(jobs),json.dumps(r,ensure_ascii=False),flush=True)
 print(stage,'finished; errors',len(errors),flush=True)
 return 2 if errors else 0
def main():
 sys.stdout.reconfigure(encoding='utf-8');ap=argparse.ArgumentParser();ap.add_argument('--execute',action='store_true');ap.add_argument('--stage',choices=STAGES+['all'],default='all');ap.add_argument('--run-id');args=ap.parse_args()
 rows=preflight()
 if not args.execute:return 0
 runid=args.run_id or datetime.now().strftime('%Y%m%d-%H%M%S');control=C/'handoff-control';control.mkdir(exist_ok=True);stop=control/f'stop-{runid}.flag'
 print('单进程顺序执行；不会启动多阶段并发。',flush=True)
 print('要在当前来源完成后停止，新建这个空文件：'+str(stop),flush=True)
 if args.stage!='all':return run_stage(args.stage,rows,stop)
 for stage in STAGES:
  if stop.exists():return 3
  code=subprocess.call([sys.executable,str(Path(__file__).resolve()),'--execute','--stage',stage,'--run-id',runid],cwd=ROOT,creationflags=subprocess.CREATE_NO_WINDOW)
  if code:return code
 print('自动阶段完成；仍须逐店视觉核验、版本分组、标准封装及质检报告。没有训练准入批准。',flush=True)
 return 0
if __name__=='__main__':raise SystemExit(main())
