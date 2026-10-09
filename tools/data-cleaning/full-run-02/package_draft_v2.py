"""Explicitly namespace raw PDF bounds/area when the polygon itself is metric."""
import sys,json,copy
from pathlib import Path
import package_draft as base
from sync_sources import OUT,meta
from scan_all import read

def write(path,data):
 d=copy.deepcopy(data)
 if Path(path).name=='input.json' and d.get('boundary'):
  b=d['boundary']
  if 'bounds' in b:b['bounds_pdf']=b.pop('bounds')
  if 'area' in b:b['area_pdf_point2']=b.pop('area')
 if isinstance(d.get('scale'),dict):d['scale']['area_used_for_calibration']=False
 with Path(path).open('x',encoding='utf-8') as f:json.dump({**d,**meta(), 'generator':dict(script='full-run-02/package_draft_v2.py',version='2.0.0')},f,ensure_ascii=False,indent=2,allow_nan=False)
base.write=write

def main():
 sys.stdout.reconfigure(encoding='utf-8');rows={r['source_id']:r for r in read(OUT/'00_同步与文件清单.json')['files']}
 for a in read(OUT/'试点验收-r12.json')['rows']:
  d=read(a['draft']);sid=a['source_id'];store=f"store-{int(sid[4:]):04}";dest=OUT/'试点标准标注-r13'/store/'v1'
  d['visual_check']['final_gate_record']=a
  r=base.package(d,rows[sid],store,'v1',dest,dict(pilot_gate=str(OUT/'试点验收-r12.json'),frames=[dict(frame_id='frame-1',bbox=d['source']['frame_bbox'],method='vision',independent_frame_count=1)]))
  print(sid,r['auto_status'],r['props']['located_count'],flush=True)
if __name__=='__main__':main()
