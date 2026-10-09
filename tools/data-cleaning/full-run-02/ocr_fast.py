"""Faster title crops; retain v1 OCR receipts and never overwrite them."""
import sys
from rapidocr_onnxruntime import RapidOCR
import ocr_pages as base

ORIGINAL=base.ocr
def fast_engine():
 if base.ENGINE is None:
  base.ENGINE=RapidOCR(intra_op_num_threads=1,inter_op_num_threads=1,det_limit_side_len=640,det_limit_type='max',max_side_len=3000)
 return base.ENGINE
def fast_ocr(q,rect,scale):
 w,h=q.rect.width,q.rect.height
 clip=[w*.85,h*.72,w,h*.94] if rect[0]>0 else [0,h*.90,w*.65,h]
 result=ORIGINAL(q,clip,scale)
 for a in result:a['ocr_profile']='ocr_fast.py/1.0.0: max640; narrow title crops'
 return result
base.engine=fast_engine
base.ocr=fast_ocr
if __name__=='__main__':base.main()
