"""Explicit discipline titles outrank generic English 'layout'; broader furniture names."""
import re
from classification_v3 import classify as previous

def classify(p):
 d=previous(p);w,h=d['page_rect'][2:];hits=[]
 for s in d['joined_text']:
  t=re.sub(r'\s+','',s['text']).upper();b=s['bbox'];typ=None
  if len(t)>45:continue
  if re.search(r'大样|详图|节点|立面图|剖面图|ELEVATION|DETAIL|SECTION',t):typ='elevation'
  elif re.search(r'设计说明|施工说明|设计总说明|图纸目录|图纸清单',t):typ='cover_index'
  elif re.search(r'^(?:.{0,12})?(?:弱电.*图|强电.*图|强弱电.*图|网络.*图|监控.*图|安防.*图|插座.*图|给排水.*图|排水.*图|空调.*图|地坪.*图|铺装.*图|铺贴.*图|综合天花.*图|照明.*图|灯具.*图|应急.*图|配电.*图|立面索引.*图|墙体.*图|隔墙.*图|天花.*图|地台.*图|地面.*图)$',t) or re.search(r'(?:NETWORK|ELECTRICAL|POWER|LIGHTING|CEILING|FLOORING|SOCKET|HVAC|FIRE).*(?:PLAN|LAYOUT)$',t):typ='plan_other'
  elif re.search(r'平面(?:道具|家具|软装)?(?:布置|布局|配置|定位|尺寸)图|平面道具图|家具(?:定位|布置|尺寸)图|软装布置图',t):typ='plan_layout'
  elif t in ('FURNITUREPLAN','FURNITURELAYOUTPLAN','LAYOUTPLAN','FIXTUREFURNISHINGPLAN'):typ='plan_layout'
  if typ:
   priority=4 if b[0]>.8*w and b[1]>.45*h else 3 if b[1]>.84*h else 2 if b[1]<.15*h else 1
   hits.append((priority,s['size'],typ,s))
 if hits:
  hits.sort(key=lambda a:(a[0],a[1]),reverse=True);a=hits[0]
  if a[0]>=3 or d['type']=='other':d.update(type=a[2],confidence=.94 if a[0]>=3 else .72,title=a[3]['text'])
 d['signals'].update(classifier='classification_v4.py/4.0.0',requires_vision=d['confidence']<.8)
 return d
