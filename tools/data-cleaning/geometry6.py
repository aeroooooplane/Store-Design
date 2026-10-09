"""r6: stitch only sub-0.18 PDF-point endpoint gaps within the same stroke style."""
import geometry5 as r5
import geometry3 as g
from geometry3 import *
from collections import defaultdict
def polygons6(paths,w,h):
    groups=defaultdict(list)
    for a in paths:
        if a['color'] is None or a['rect'].x0>w*.9:continue
        seg=g.segments(a)
        if a.get('closePath') and seg and math.dist(seg[-1][1],seg[0][0])>.001:seg.append((seg[-1][1],seg[0][0]))
        key=(tuple(round(x,2) for x in a['color']),round(a['width'] or 0,2),a['dashes'])
        groups[key].extend(seg)
    found={};tol=.18
    for seg in groups.values():
        grid=defaultdict(list)
        def vertex(pt):
            cell=tuple(math.floor(v/tol) for v in pt)
            for i in range(-1,2):
                for j in range(-1,2):
                    for other in grid[(cell[0]+i,cell[1]+j)]:
                        if math.dist(other,pt)<=tol:return other
            grid[cell].append(pt);return pt
        unique=set()
        for a,b in seg:
            a,b=vertex(a),vertex(b)
            if a!=b:unique.add(tuple(sorted([a,b])))
        for poly in polygonize([LineString(x) for x in unique]):
            poly=Polygon(poly.exterior)
            if poly.is_valid and 20<poly.area<w*h*.65:found[poly.wkb]=poly
    return sorted(found.values(),key=lambda a:-a.area)
class Route:
    def __truediv__(self,other):return r5.r4.original_cache/('pilot-r6' if other=='pilot-r3' else other)
g.CACHE=Route();g.polygons=polygons6
if __name__=='__main__':sys.stdout.reconfigure(encoding='utf-8');g.main()
