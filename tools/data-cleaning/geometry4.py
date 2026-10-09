"""r4: isolate stroke styles, remove exact duplicate edges, preserve exterior outlines."""
import geometry3 as g
from geometry3 import *
from shapely.ops import unary_union
from collections import defaultdict
def polygons4(paths,w,h):
    groups=defaultdict(list);direct=[]
    for i,a in enumerate(paths):
        if a['color'] is None or a['rect'].x0>w*.9:continue
        seg=g.segments(a)
        if a.get('closePath') and seg and math.dist(seg[-1][1],seg[0][0])>.01:
            seg.append((seg[-1][1],seg[0][0]))
        style=(tuple(round(x,2) for x in a['color']),round(a['width'] or 0,2),a['dashes'])
        groups[style].extend(seg)
    found={}
    for group in groups.values():
        unique=set()
        for u,v in group:
            u=tuple(round(k,2) for k in u);v=tuple(round(k,2) for k in v)
            if u!=v:unique.add(tuple(sorted([u,v])))
        for poly in polygonize([LineString(x) for x in unique]):
            poly=Polygon(poly.exterior)
            if poly.is_valid and 20<poly.area<w*h*.65:
                found[poly.wkb]=poly
    return list(found.values())
g.polygons=polygons4
# Redirect this immutable revision's outputs; the r3 drafts remain auditable.
original_cache=g.CACHE
class CacheRoute:
    def __truediv__(self,other):return original_cache/('pilot-r4' if other=='pilot-r3' else other)
g.CACHE=CacheRoute()
if __name__=='__main__':sys.stdout.reconfigure(encoding='utf-8');g.main()
