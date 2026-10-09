"""r7: explicit red dashed outlines; shortened furniture names; no scale inference."""
import geometry6 as r6
import geometry3 as g
from geometry3 import *
ORIGINAL_FUNCTION=g.function
def function7(t):
    if re.search('安装尺寸图|LOGO指定高度|LOGO高度',t,re.I):return None
    found=ORIGINAL_FUNCTION(t)
    if found:return found
    if re.search('中岛(?!店|陈列柜)',t):return 'island_table'
    if re.search('陈列柜|accessor(?:ies|y) cabinet',t,re.I):return 'accessory_cabinet'
    if re.search('显示屏',t):return 'screen'
    return None
def rental7(paths,ls):
    red=[a for a in paths if a['color'] and a['color'][0]>.9 and max(a['color'][1:])<.1 and all(it[0]=='l' for it in a['items'])]
    segments=[(u,v) for a in red for u,v in g.segments(a)]
    chains=[];current=[]
    for a,b in segments:
        if current and math.dist(current[-1],a)>3:
            chains.append(current);current=[]
        current.extend([a,b])
    if current:chains.append(current)
    for c in sorted(chains,key=len,reverse=True):
        if len(c)>8 and math.dist(c[0],c[-1])<3:
            poly=Polygon(c).simplify(.2,preserve_topology=True)
            if poly.is_valid and poly.area>1000:return poly
    return None
class Route:
    def __truediv__(self,other):return r6.r5.r4.original_cache/('pilot-r7' if other=='pilot-r3' else other)
g.CACHE=Route();g.function=function7;g.rental=rental7
if __name__=='__main__':sys.stdout.reconfigure(encoding='utf-8');g.main()
