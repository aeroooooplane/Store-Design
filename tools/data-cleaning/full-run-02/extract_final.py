"""Recover only plan pages absent from r2, using raster-aware classifications."""
import sys
from pathlib import Path
import extract_enriched as run
from raster_pages import DEST as RASTER,classify_chapter
from scan_all import read
from sync_sources import OUT

run.OCR=RASTER
run.classify=classify_chapter
run.base.classify=classify_chapter
run.base.DEST=OUT/'平面候选-r3'
run.base.CACHE=OUT.parent/'_cache/全量续跑-02/geometry-r3'
ORIGINAL=run.enriched_read

def read_final(path):
 path=Path(path)
 if path.name=='00_同步与文件清单.json':
  data=run.RAW_READ(path);rows=[]
  for r in data['files']:
   p=RASTER/r['source_id']/'classified.json'
   if r['format']!='pdf' or not p.exists():continue
   desired={a['page'] for a in read(p)['pages'] if classify_chapter(a)['type']=='plan_layout'}
   have={int(a.parent.name[1:]) for a in (OUT/'平面候选-r2'/r['source_id']).glob('p*/draft.json')}
   if desired-have or not have:rows.append(r)
  data['files']=rows;return data
 return ORIGINAL(path)
run.base.read=read_final
if __name__=='__main__':run.base.main()
