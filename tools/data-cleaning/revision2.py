"""Revision 2: spatial text joining, title-field classification. Never overwrite r1."""
import pipeline as p
from pipeline import *
def lines(spans):
    result=[]
    for s in sorted(spans,key=lambda s:(round(s['bbox'][1],0),s['bbox'][0])):
        b=s['bbox'];prev=next((a for a in reversed(result) if abs(a['bbox'][1]-b[1])<max(1,s['size']*.18) and abs(a['bbox'][3]-b[3])<max(1,s['size']*.18) and -.5*s['size']<b[0]-a['bbox'][2]<s['size']*1.6 and s['direction']==a['direction']),None)
        if prev:
            prev['text']+=s['text'];prev['bbox']=[min(prev['bbox'][0],b[0]),min(prev['bbox'][1],b[1]),max(prev['bbox'][2],b[2]),max(prev['bbox'][3],b[3])]
        else:result.append(dict(s))
    return result
RULES=[('cover_index',r'^(图纸目录|目录|图纸清单|施工说明|设计说明|.*设计说明[（(一二三123)）]*|DRAWING\s*INDEX|CONTENTS)$'),('plan_layout',r'^(?:.*层)?(?:平面布置图|家具布置图|家具定位图|软装布置图|平面布局图|平面配置图|FURNITURE\s*(?:LAYOUT\s*)?PLAN|FIXTURE\s*FURNISHING\s*PLAN|LAYOUT\s*PLAN)$'),('plan_original',r'^(原始.*平面图|原建.*平面图|租赁平面图|建筑平面图|ORIGINAL\s*PLAN)$'),('elevation',r'^.{0,30}(立面图|剖面图|大样图|详图|节点图)$'),('plan_other',r'^.{0,25}(天花.*图|灯具.*图|照明.*图|铺装图|铺贴图|地坪图|插座.*图|强弱电.*图|电气.*图|给排水.*图|消防.*图|开关.*图|地面.*图|地台.*图|墙体.*图|隔墙.*图)$'),('material',r'^.{0,15}(材料表|材料清单|物料清单|软装清单|道具清单)$'),('render',r'^.{0,10}效果图$'),('photo',r'^.{0,10}(现场照片|现状照片|现场实景)$')]
def classify2(page):
    ls=lines(page.get('text',[]));w,h=page['page_rect'][2:];hits=[]
    for s in ls:
        for typ,pat in RULES:
            if re.search(pat,s['text'].strip(),re.I):
                x,y,_,_=s['bbox'];priority=3 if x>.8*w and y>.5*h else 2 if y>.88*h or y<.12*h else 1
                hits.append((priority,s['size'],typ,s))
    hits.sort(key=lambda a:(a[0],a[1]),reverse=True)
    if hits:_,_,typ,title=hits[0];conf=.95 if hits[0][0]>=2 else .75
    else:typ='other';title=None;conf=.2
    return {**page,'type':typ,'confidence':conf,'title':title['text'] if title else None,'signals':{**page['signals'],'title_hits':[a[3] for a in hits],'requires_vision':conf<.8,'classifier':'revision2'},'joined_text':ls}
def run():
    rows=[r for r in inventory()['files'] if r['source_id'] in [f'PDF-{n:03}' for n in PILOT]]
    for r in rows:
        dest=CACHE/'classified-r2'/f"{r['source_id']}.json"
        if dest.exists():continue
        raw=CACHE/'scans'/f"{r['source_id']}.json"
        if not raw.exists():continue
        obj=read(raw);pages=[classify2(x) for x in obj['pages']];write(dest,dict(source_id=r['source_id'],pages=pages))
        plans=[x for x in pages if x['type']=='plan_layout'];print(r['source_id'],[(x['page'],x['title']) for x in plans],flush=True)
        with fitz.open(r['path']) as doc:
            for a in plans:
                dst=CACHE/'pilot-renders'/f"{r['source_id']}-p{a['page']:03}.png"
                if not dst.exists():
                    page=doc[a['page']-1];scale=2500/max(page.rect.width,page.rect.height);pix=page.get_pixmap(matrix=fitz.Matrix(scale,scale),alpha=False)
                    with dst.open('xb') as f:f.write(pix.tobytes('png'))
if __name__=='__main__':
    sys.stdout.reconfigure(encoding='utf-8');run()
