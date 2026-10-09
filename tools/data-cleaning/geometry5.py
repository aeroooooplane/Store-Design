"""r5: normalize PDF /Rotate in memory before extracting any coordinates."""
import geometry3 as g
import geometry4 as r4
from geometry3 import *
from revision2 import lines
REAL_OPEN=fitz.open
REAL_READ=g.read
def normalized_open(*args,**kwargs):
    doc=REAL_OPEN(*args,**kwargs)
    for page in doc:
        if page.rotation:page.remove_rotation()
    return doc
def normalized_read(path):
    obj=REAL_READ(path)
    if 'classified-r2' not in str(path):return obj
    sid=obj['source_id'];row=next(a for a in inventory()['files'] if a['source_id']==sid)
    with normalized_open(row['path']) as doc:
        n=g.SELECT[int(sid[4:])];page=doc[n-1];spans=[]
        for block in page.get_text('dict',flags=fitz.TEXTFLAGS_DICT & ~fitz.TEXT_PRESERVE_IMAGES)['blocks']:
            for line in block.get('lines',[]):
                for s in line['spans']:
                    if s['text'].strip():spans.append(dict(text=s['text'],bbox=list(s['bbox']),size=s['size'],direction=list(line['dir'])))
        obj['pages'][n-1]['joined_text']=lines(spans)
    return obj
class Route:
    def __truediv__(self,other):return r4.original_cache/('pilot-r5' if other=='pilot-r3' else other)
g.CACHE=Route();g.polygons=r4.polygons4;g.read=normalized_read;g.fitz.open=normalized_open
if __name__=='__main__':sys.stdout.reconfigure(encoding='utf-8');g.main()
