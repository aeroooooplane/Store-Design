import pipeline as p
import fitz,sys
from geometry3 import segments,SELECT
sys.stdout.reconfigure(encoding='utf-8')
for sid in ['PDF-001','PDF-019','PDF-032','PDF-051','PDF-090']:
    src=p.read(p.CACHE/'pilot-r7'/sid/'source.json');inp=p.read(p.CACHE/'pilot-r7'/sid/'input.json')
    pts=inp['boundary']['points'];xs=[a[0] for a in pts];ys=[a[1] for a in pts];b=[min(xs),min(ys),max(xs),max(ys)]
    print(sid,'boundary',b)
    d=fitz.open(src['source_pdf']);q=d[src['physical_page']-1];q.remove_rotation()
    for i,a in enumerate(q.get_drawings()):
        for u,v in segments(a):
            dx,dy=abs(v[0]-u[0]),abs(v[1]-u[1])
            if (dy<.2 and abs(dx-(b[2]-b[0]))<2 and (u[1]<b[1] or u[1]>b[3])) or (dx<.2 and abs(dy-(b[3]-b[1]))<2 and (u[0]<b[0] or u[0]>b[2])):
                print(i,[list(u),list(v)],'length',dx or dy,'color',a['color'])
