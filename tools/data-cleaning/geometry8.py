"""r8: join reversed dash chains; preserve independent stroke styles and evidence."""
import geometry7 as r7
import geometry3 as g
from geometry3 import *
from collections import defaultdict

BASE_POLYGONS=g.polygons
def chain_polygons(paths,w,h,red_only=False):
    groups=defaultdict(list)
    for a in paths:
        c=a['color']
        if c is None or a['rect'].x0>w*.9:continue
        if red_only and not(c[0]>.7 and max(c[1:])<.2):continue
        if any(it[0]=='c' for it in a['items']):continue
        key=(tuple(round(x,2) for x in c),round(a['width'] or 0,2),a['dashes'])
        groups[key].extend(g.segments(a))
    polys=[]
    for segments in groups.values():
        chains=[];cur=[]
        for a,b in segments:
            if cur and math.dist(cur[-1],a)>3.1:chains.append(cur);cur=[]
            cur.extend([a,b])
        if cur:chains.append(cur)
        # Only long dash chains are connected, never arbitrary isolated dimension lines.
        chains=[c for c in chains if len(c)>=8]
        while chains:
            c=chains.pop(0)
            while math.dist(c[0],c[-1])>3.1:
                matches=[]
                for j,d in enumerate(chains):
                    for end in [0,-1]:
                        dist=math.dist(c[-1],d[end])
                        if dist<=3.1:matches.append((dist,j,end))
                if len(matches)!=1:break
                _,j,end=matches[0];d=chains.pop(j)
                c.extend(d if end==0 else d[::-1])
            if len(c)>8 and math.dist(c[0],c[-1])<=3.1:
                poly=Polygon(c).simplify(.2,preserve_topology=True)
                if poly.is_valid and w*h*.02<poly.area<w*h*.65:polys.append(poly)
    return polys

def polygons8(paths,w,h):return BASE_POLYGONS(paths,w,h)+chain_polygons(paths,w,h)
def rental8(paths,ls):
    # Rendered CAD red can be RGB 0.784, not only full intensity 1.0.
    maxx=max((a['rect'].x1 for a in paths),default=1200)
    maxy=max((a['rect'].y1 for a in paths),default=840)
    polys=chain_polygons(paths,maxx,maxy,True)
    return max(polys,key=lambda p:p.area) if polys else None
class Route:
    def __truediv__(self,other):return r7.r6.r5.r4.original_cache/('pilot-r8' if other=='pilot-r3' else other)
g.CACHE=Route();g.polygons=polygons8;g.rental=rental8
if __name__=='__main__':sys.stdout.reconfigure(encoding='utf-8');g.main()
