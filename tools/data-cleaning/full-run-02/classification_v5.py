"""Corrections grounded in actual cover/hard-construction/details page reviews."""
import re
from classification_v4 import classify as previous

def classify(p):
 d=previous(p);w,h=d['page_rect'][2:];hits=[]
 for s in d['joined_text']:
  t=re.sub(r'\s+','',s['text']).upper();b=s['bbox'];kind=None
  if len(t)>50:continue
  if re.search(r'砌墙定位|硬装定位|墙体定位|立面索引|WALLCONSTRUCTIONLAYOUTPLAN',t):kind='plan_other'
  elif re.search(r'配件柜开孔尺寸|转换层大样|地面大样|GROUND.*DETAIL',t):kind='elevation'
  elif re.search(r'电气系统图|配电系统图|单线系统图',t):kind='other'
  elif t in ('物料表','材料表','MATERIALTABLE','MATERIALSCHEDULE'):kind='material'
  if kind:
   priority=4 if b[0]>.8*w and b[1]>.45*h else 3 if b[1]>.84*h else 2 if b[1]<.15*h else 1
   hits.append((priority,s['size'],kind,s))
 if hits:
  hits.sort(key=lambda a:(a[0],a[1]),reverse=True);a=hits[0]
  if a[0]>=3 or d['type']=='other':d.update(type=a[2],confidence=.94 if a[0]>=3 else .75,title=a[3]['text'])
 # A cover must have a sparse central title, no sizeable bitmap and few vectors.
 # Do not infer a cover merely because it contains the word 'construction'.
 central=[s for s in d['joined_text'] if s['bbox'][0]<w*.75 and h*.18<s['bbox'][1]<h*.8]
 title=[s for s in central if re.search(r'装饰图纸|装饰.*施工图|电气施工图|电气图|室内机电施工图|方案汇报',s['text'])]
 if title and d['signals'].get('vector_path_count',999)>0 and d['signals'].get('vector_path_count',999)<120 and d['signals'].get('bitmap_area_ratio',1)<.2 and len(central)<20:
  d.update(type='cover_index',confidence=.92,title=title[0]['text']);d['signals']['sparse_cover_title_evidence']=title
 d['signals'].update(classifier='classification_v5.py/5.0.0',requires_vision=d['confidence']<.8)
 return d
