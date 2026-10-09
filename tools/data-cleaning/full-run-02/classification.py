"""Second pass: title-block field names are not sheet titles."""
import re,copy,sys
from sync_sources import ROOT
sys.path.insert(0,str(ROOT/'tools/data-cleaning'))
from revision2 import classify2

def classify(p):
 p=classify2(copy.deepcopy(p));w,h=p['page_rect'][2:];hits=[]
 rules=[('plan_layout',r'^(?:.*层)?(?:家具定位图?|家具布置图?|平面布置图?|平面布局图?|平面配置图?|软装布置图?|FURNITURE(?:LAYOUT)?PLAN|FIXTUREFURNISHINGPLAN|LAYOUTPLAN)$'),
 ('plan_original',r'^(?:.*层)?(?:原始.*平面图?|原建.*平面图?|租赁.*平面图?|建筑.*平面图?|EXISTINGPLAN|ORIGINALPLAN)$'),
 ('plan_other',r'^.{0,20}(?:天花.*图|灯具.*图|照明.*图|铺装图|铺贴图|地坪.*图|插座.*图|强弱电.*图|电气.*图|给排水.*图|消防.*图|开关.*图|地面.*图|地台.*图|墙体.*图|隔墙.*图|CEILINGPLAN|FLOORINGPLAN|LIGHTINGPLAN)$'),
 ('elevation',r'^.{0,25}(?:立面图?|剖面图?|大样图?|详图|节点图?|ELEVATION|SECTION|DETAIL)$'),
 ('cover_index',r'^(?:图纸目录|图纸清单|目录|DRAWINGINDEX|CONTENTS|施工说明|设计说明|.{0,12}设计说明[（(一二三123)）]*)$'),
 ('material',r'^.{0,15}(?:材料表|材料清单|材料说明|物料清单|软装清单|道具清单|MATERIALLIST)$'),
 ('render',r'^(?:.{0,5}效果图|RENDERING)$'),('photo',r'^.{0,5}(?:现场照片|现状照片|现场实景)$')]
 for s in p['joined_text']:
  t=re.sub(r'\s+','',s['text']).upper();b=s['bbox']
  if t in ('图纸索引','DRAWINGTITLE','图纸名称','图名','INDEX','图号'):continue
  for typ,pat in rules:
   if re.search(pat,t,re.I):
    pr=4 if b[0]>.8*w and b[1]>.45*h else 3 if b[1]>.86*h else 2 if b[1]<.15*h else 1
    hits.append((pr,s['size'],typ,s));break
 # Front matter lists several drawing types in a subtitle; never call it a render.
 cover=next((s for s in p['joined_text'] if ('平面图' in s['text'] and '效果图' in s['text'] and '施工图' in s['text']) or re.search(r'设计方案|施工图册|DESIGNPROPOSAL',s['text'].replace(' ',''),re.I)),None)
 if cover and not any(x[0]>=3 and x[2].startswith('plan_') for x in hits):
  p.update(type='cover_index',confidence=.9,title=cover['text'])
 elif hits:
  hits.sort(key=lambda x:(x[0],x[1]),reverse=True);a=hits[0]
  # A true index has many drawing titles in the body and an explicit index heading.
  heading=next((x for x in hits if x[2]=='cover_index' and re.search('目录|清单|INDEX',x[3]['text'],re.I)),None)
  if heading and len(hits)>6 and heading[3]['bbox'][1]<h*.5:a=heading
  p.update(type=a[2],confidence=.95 if a[0]>=3 else .78,title=a[3]['text'])
 else:p.update(type='other',confidence=.2,title=None)
 p['signals'].update(classifier='classification.py/2.0.0',title_hits=[x[3] for x in hits],requires_vision=p['confidence']<.8)
 p['frames']=None;p['frame_detection_status']='unverified'
 return p
