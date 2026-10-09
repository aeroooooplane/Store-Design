"""Title semantics after local OCR; preserve unresolved photo/render distinction."""
import re,copy
from classification import classify as previous

def classify(p):
 d=previous(p);w,h=d['page_rect'][2:];ls=d['joined_text'];hits=[]
 for s in ls:
  t=re.sub(r'\s+','',s['text']).upper();b=s['bbox']
  if len(t)>45:continue
  typ=None
  if re.search(r'大样|详图|节点|立面图|剖面图|ELEVATION|DETAIL|SECTION',t):typ='elevation'
  elif re.search(r'设计说明|施工说明|设计总说明|图纸目录|图纸清单',t):typ='cover_index'
  elif re.search(r'^(?:.{0,8})?(?:平面道具图|平面尺寸图|家具尺寸图|道具尺寸图|家具定位图|平面布置图|平面布局图|软装布置图|FURNITUREPLAN|FURNITURELAYOUTPLAN|LAYOUTPLAN)$',t):typ='plan_layout'
  elif re.search(r'原始.*平面|租赁平面|EXISTINGPLAN|ORIGINALPLAN',t):typ='plan_original'
  elif re.search(r'^(?:.{0,12})?(?:天花.*图|灯具.*图|照明.*图|地面.*图|地台.*图|插座.*图|配电.*图|立面索引图|电力.*图|电源.*图|强弱电.*图|应急照明.*图|墙体.*图|隔墙.*图|CEILINGPLAN|LIGHTINGPLAN)$',t):typ='plan_other'
  if typ:
   pr=4 if b[0]>.8*w and b[1]>.45*h else 3 if b[1]>.84*h else 2 if b[1]<.15*h else 1
   hits.append((pr,s['size'],typ,s))
 if hits:
  hits.sort(key=lambda a:(a[0],a[1]),reverse=True);a=hits[0]
  existing=d['signals'].get('title_hits',[])
  # Use the actual title field preferentially; do not let a body annotation override it.
  if a[0]>=3 or d['type']=='other':d.update(type=a[2],confidence=.93 if a[0]>=3 else .7,title=a[3]['text'])
 if d['type']=='cover_index' and d['title'] and len(d['title'])>50:d.update(type='other',confidence=.2,title=None)
 d['signals'].update(classifier='classification_v3.py/3.0.0',requires_vision=d['confidence']<.8)
 return d
