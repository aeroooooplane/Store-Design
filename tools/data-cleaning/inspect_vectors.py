import sys, collections
import pipeline as p
import fitz
sid=sys.argv[1];num=int(sys.argv[2])
r=next(r for r in p.inventory()['files'] if r['source_id']==sid)
d=fitz.open(r['path']);page=d[num-1];paths=page.get_drawings()
print('styles',collections.Counter((str(a['color']),str(a['fill']),round(a['width'] or 0,2),a['dashes']) for a in paths).most_common(12))
for i,a in enumerate(paths):
    b=a['rect']
    if (b.width>30 and b.height>20 and b.width<1000 and b.height<650 and len(a['items'])<30) or (a['color'] and a['color'][0]>.8 and a['color'][1]<.2):
        print(i,'box',tuple(round(x,2) for x in b),'n',len(a['items']),'close',a['closePath'],'color',a['color'],'fill',a['fill'],'dash',a['dashes'],'items',a['items'][:5])
