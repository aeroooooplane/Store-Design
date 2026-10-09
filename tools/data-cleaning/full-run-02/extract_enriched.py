"""Reproducible r2 extraction from OCR-enriched pages; r1 artifacts stay immutable."""
import sys,copy,re,json
from pathlib import Path
import pymupdf as fitz
from rapidocr_onnxruntime import RapidOCR
import extract_candidates as base
import ocr_pages
from classification_v3 import classify
from sync_sources import OUT,write
from scan_all import CACHE as SCANS,read

OCR=ocr_pages.BASE
FULL=OCR/'full_plans'
RAW_READ=base.read
RAW_WRITE=base.write
base.DEST=OUT/'平面候选-r2'
base.CACHE=OUT.parent/'_cache/全量续跑-02/geometry-r2'
base.classify=classify

def full_engine():
 if ocr_pages.ENGINE is None:
  ocr_pages.ENGINE=RapidOCR(intra_op_num_threads=1,inter_op_num_threads=1,det_limit_side_len=1280,det_limit_type='max',max_side_len=3000)
 return ocr_pages.ENGINE
ocr_pages.engine=full_engine

def enriched_read(path):
 path=Path(path)
 if path.parent==SCANS:
  receipt=OCR/path.stem/'classified.json'
  if not receipt.exists():raise RuntimeError('Title OCR not ready '+path.stem)
  data=RAW_READ(receipt);FULL.mkdir(parents=True,exist_ok=True)
  source=RAW_READ(path)['source_pdf']
  with fitz.open(source) as doc:
   for p in data['pages']:
    if classify(p)['type']!='plan_layout':continue
    n=p['page'];dest=FULL/f'{path.stem}-p{n:03}.json'
    if dest.exists():extra=RAW_READ(dest)['text']
    else:
     q=doc[n-1];q.remove_rotation();w,h=q.rect.width,q.rect.height
     extra=ocr_pages.ocr(q,[0,0,w,h],2500/max(w,h))
     write(dest,dict(source_id=path.stem,page=n,source_sha256=data['sha256'],method='ocr',text=extra,
      profile='extract_enriched.py/1.0.0: full-plan max1280 detection, original2500 recognition',generator=dict(script='extract_enriched.py',version='1.0.0')))
    for a in extra:
     if a['ocr_confidence']<.88:continue
     # Deduplicate only overlapping identical text, preserving conflicting readings.
     text=re.sub(r'\s+','',a['text']).casefold();b=a['bbox'];same=False
     for s in p['text']:
      if re.sub(r'\s+','',s['text']).casefold()!=text:continue
      c=s['bbox'];over=max(0,min(b[2],c[2])-max(b[0],c[0]))*max(0,min(b[3],c[3])-max(b[1],c[1]))
      if over>min((b[2]-b[0])*(b[3]-b[1]),(c[2]-c[0])*(c[3]-c[1]))*.3:same=True;break
     if not same:p['text'].append(a)
    p['signals']['full_plan_ocr_evidence']=str(dest)
  return data
 if path.name=='00_同步与文件清单.json':
  d=RAW_READ(path);d['files']=[r for r in d['files'] if (OCR/r['source_id']/'classified.json').exists()];return d
 return RAW_READ(path)

def enriched_write(path,d):
 d=dict(d);d['generator']=dict(script='full-run-02/extract_enriched.py',version='2.0.0')
 if Path(path).name=='draft.json':d['ocr_sources']=[str(OCR/d['source_id']/f"p{d['page']:03}.json"),str(FULL/f"{d['source_id']}-p{d['page']:03}.json")]
 return RAW_WRITE(path,d)
base.read=enriched_read
base.write=enriched_write
if __name__=='__main__':base.main()
