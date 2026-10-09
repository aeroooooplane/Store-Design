"""Continue independent receipt-based stages; never run concurrent writers per stage.

Pass the existing Python parent PIDs to wait for current batches. Stop/restart this
controller only after its child stage exits, or pass those child PIDs on resume.
The controller creates logs only inside the authorized task cache.
"""
import argparse,ctypes,json,subprocess,sys,time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from pathlib import Path
from sync_sources import OUT,ROOT,meta

C=OUT.parent/'_cache/全量续跑-02';S=Path(__file__).resolve().parent
def live(pid):
 if not pid:return False
 handle=ctypes.windll.kernel32.OpenProcess(0x1000,False,pid)
 if not handle:return False
 code=ctypes.c_ulong()
 try:return bool(ctypes.windll.kernel32.GetExitCodeProcess(handle,ctypes.byref(code))) and code.value==259
 finally:ctypes.windll.kernel32.CloseHandle(handle)
def wait_pids(pids):
 while any(live(p) for p in pids):time.sleep(15)
def count(stage):
 return len(list((C/stage).glob('*.json' if stage=='scans' else '*/receipt.json')))
def log(stage,**kw):
 with (OUT/'progress.jsonl').open('a',encoding='utf-8') as f:f.write(json.dumps({**meta(),'stage':'controller','operation':stage,**kw},ensure_ascii=False)+'\n')
 print(stage,kw,flush=True)
def run(script,workers):
 logs=C/'controller-logs';logs.mkdir(exist_ok=True)
 path=logs/f'{datetime.now():%Y%m%d-%H%M%S-%f}-{script}.log'
 with path.open('x',encoding='utf-8') as f:
  p=subprocess.Popen([sys.executable,str(S/script),'--workers',str(workers)],cwd=ROOT,stdout=f,stderr=subprocess.STDOUT,creationflags=subprocess.CREATE_NO_WINDOW)
  log(script,pid=p.pid,log=str(path));code=p.wait();log(script,exit_code=code)
 return code
def ocr_lane(args):
 wait_pids(args.ocr_pids)
 while True:
  before=count('ocr');scanned=count('scans')
  if scanned>before:run('ocr_fast_v4.py',3)
  if count('ocr')>=args.expected:return
  if not any(live(p) for p in args.scan_pids) and count('scans')==scanned and count('ocr')==before:
   log('ocr_unresolved',expected=args.expected,receipts=count('ocr'));return
  time.sleep(15)
def raster_lane(args):
 wait_pids(args.raster_pids)
 while True:
  before=count('raster')
  if count('ocr')>before:run('raster_pages.py',1)
  if count('raster')>=args.expected:return
  if lanes['ocr'].done() and count('raster')==before:log('raster_unresolved',receipts=before);return
  time.sleep(15)
def geometry_lane(args):
 wait_pids(args.geometry_pids)
 while True:
  before=len(list((OUT/'平面候选-r2').glob('*/receipt.json')))
  if count('ocr')>before:run('extract_enriched_v4.py',2)
  after=len(list((OUT/'平面候选-r2').glob('*/receipt.json')))
  if lanes['ocr'].done() and after==before:break
  if after>=args.expected:break
  time.sleep(15)
 lanes['raster'].result()
 run('extract_final.py',2)
 run('propose_scales_all.py',2)
 log('machine_stages_finished',note='Rendering and extraction are not visual approval; review/package/report remain required.')
if __name__=='__main__':
 sys.stdout.reconfigure(encoding='utf-8');ap=argparse.ArgumentParser()
 for name in ['scan','ocr','raster','geometry']:ap.add_argument('--'+name+'-pids',type=int,nargs='*',default=[])
 ap.add_argument('--expected',type=int,default=513);args=ap.parse_args();lanes={}
 with ThreadPoolExecutor(max_workers=3) as ex:
  lanes['ocr']=ex.submit(ocr_lane,args);lanes['raster']=ex.submit(raster_lane,args);lanes['geometry']=ex.submit(geometry_lane,args)
  for f in lanes.values():f.result()
