"""Read-only PDF extraction; all outputs exclusive-created and resumable by receipts."""
import argparse, collections, concurrent.futures, datetime, hashlib, json, os, re, sys, traceback
from pathlib import Path
import fitz

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT/'tools'))
from resource_library import source_pdf_root, source_pdf_path
OUT = ROOT / '资源库/90_处理过程与审核/数据清洗-20261009'
CACHE = OUT / '_cache'
VERSION = '0.1.0'
PILOT = [1,2,3,5,8,13,19,29,32,35,43,49,51,71,88,90,239,293,296,353]
def meta():
    return dict(schemaVersion=1, generatedAt=datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=8))).isoformat(), generator={'script':'pipeline.py','version':VERSION})
def current_source_paths(value, key=None):
    """Rebind legacy input locations in memory; retain audit files on disk."""
    if isinstance(value, dict):
        return {k:current_source_paths(v,k) for k,v in value.items()}
    if isinstance(value, list):
        return [current_source_paths(v,key) for v in value]
    if isinstance(value, str):
        normalized=value.replace('\\','/')
        if key=='source_root' and normalized.rstrip('/').endswith('/各门店图纸'):
            return str(source_pdf_root())
        if key in {'path','source_pdf','duplicate_paths'} and ('/各门店图纸/' in normalized or normalized.startswith('各门店图纸/')):
            filename=normalized.rsplit('/',1)[-1]
            if Path(filename).suffix.lower()=='.pdf':return str(source_pdf_path(filename))
            other=ROOT/'资源库/90_处理过程与审核/其他源文件'/filename
            if other.is_file():return str(other)
    return value

def read(p): return current_source_paths(json.loads(Path(p).read_text(encoding='utf-8-sig')))
def write(p, obj):
    p=Path(p); p.parent.mkdir(parents=True,exist_ok=True)
    with p.open('x',encoding='utf-8') as f: json.dump({**meta(),**obj},f,ensure_ascii=False,indent=2,allow_nan=False)
def digest(p):
    with Path(p).open('rb') as f: return hashlib.file_digest(f,'sha256').hexdigest()
def append(obj):
    with (OUT/'progress.jsonl').open('a',encoding='utf-8') as f:
        f.write(json.dumps({**meta(),**obj},ensure_ascii=False)+'\n'); f.flush(); os.fsync(f.fileno())
def inventory():
    dest=OUT/'00_文件清单.json'
    if dest.exists(): return read(dest)
    idx=read(ROOT/'资源库/00_资源索引/门店资源索引.json')['sources']
    byhash=collections.defaultdict(list)
    for r in idx: byhash[r['sha256']].append(r)
    source=source_pdf_root()
    files=sorted(source.rglob('*'),key=lambda p:str(p).casefold()); files=[p for p in files if p.is_file() and p.name not in {'README.md','.gitkeep'}]
    def inspect(p):
        r=dict(path=str(p),filename=p.name,bytes=p.stat().st_size,sha256=digest(p),page_count=None,encrypted=None,damaged=None,error=None)
        try:
            with fitz.open(p) as d: r.update(page_count=len(d),encrypted=bool(d.is_encrypted),damaged=bool(d.is_repaired))
        except Exception as e:r['error']=repr(e);r['damaged']=True
        return r
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as ex: rows=list(ex.map(inspect,files))
    n=0
    for r in rows:
        matches=byhash.get(r['sha256'],[])
        if not matches:n+=1
        r.update(source_id=matches[0]['source_id'] if matches else f'NEW-{n:03}',index_matches=matches,index_status='sha256_verified' if matches else '未入索引',sha256_verified=bool(matches))
        r['duplicate_paths']=[a['path'] for a in rows if a['sha256']==r['sha256'] and a['path']!=r['path']]
    result=dict(files=rows,source_root=str(source),file_count=len(rows),indexed_records=len(idx),unindexed_count=n,missing_index_records=[r for r in idx if not any(a['sha256']==r['sha256'] for a in rows)])
    write(dest,result);print('inventory',len(rows),n,flush=True);return result

PATTERNS=[('plan_layout',r'平面布置|家具布置|软装布置|LAYOUT\s*PLAN|FURNITURE\s*PLAN'),('plan_original',r'原始.{0,4}平面|原建.{0,4}平面|租赁平面|建筑平面|ORIGINAL\s*PLAN'),('plan_other',r'天花|灯具定位|灯具布置|地坪|铺装|地面铺|插座|强弱电|电气|给排水|消防|照明|开关|空调|CEILING|FLOORING|ELECTRICAL'),('elevation',r'立面|剖面|大样|节点|详图|ELEVATION|SECTION|DETAIL'),('material',r'材料表|物料清单|软装清单|材料清单|道具清单|MATERIAL\s*LIST'),('cover_index',r'目录|图纸目录|设计说明|施工说明|CONTENTS'),('render',r'效果图|效果展示|RENDERING'),('photo',r'现场照片|现场实景|现状照片')]
def classify(page,spans,paths,images):
    # A drawing index names many sheet types. Prefer actual title zone and isolate index.
    text='\n'.join(s['text'] for s in spans);compact=re.sub(r'\s+','',text)
    w,h=page.rect.width,page.rect.height
    title=[s for s in spans if (s['bbox'][0]>.77*w or s['bbox'][1]>.78*h) and len(s['text'])<90]
    candidates=[]
    for typ,pat in PATTERNS:
        hits=[s for s in title if re.search(pat,s['text'],re.I)]
        if hits:candidates.append((typ,hits))
    index=bool(re.search('图纸目录|图纸索引|DRAWINGINDEX',compact,re.I))
    image_area=min(1,sum(max(0,i['bbox'][2]-i['bbox'][0])*max(0,i['bbox'][3]-i['bbox'][1]) for i in images)/(w*h))
    if index:typ,conf,hits='cover_index',.98,[]
    elif candidates:typ,hits=candidates[0];conf=.9
    else:
        found=[(typ,[s for s in spans if re.search(pat,s['text'],re.I)]) for typ,pat in PATTERNS]
        found=[x for x in found if x[1]]
        if found:typ,hits=found[0];conf=.68
        elif image_area>.55 and len(paths)<100:typ,conf,hits='other',.3,[]
        else:typ,conf,hits='other',.2,[]
    return dict(type=typ,confidence=conf,title=hits[0]['text'] if hits else None,signals=dict(title_hits=hits,vector_path_count=len(paths),bitmap_area_ratio=round(image_area,4),text_span_count=len(spans),index_detected=index,requires_vision=conf<.8),frames=None)

def scan(row):
    sid=row['source_id'];dest=CACHE/'scans'/f'{sid}.json'
    if dest.exists():
        obj=read(dest)
        if obj['sha256']!=row['sha256']:raise RuntimeError('Resume hash mismatch')
        return obj
    pages=[]
    with fitz.open(row['path']) as doc:
        for i,page in enumerate(doc):
            try:
                spans=[]
                for b in page.get_text('dict',flags=fitz.TEXTFLAGS_DICT & ~fitz.TEXT_PRESERVE_IMAGES)['blocks']:
                    for line in b.get('lines',[]):
                        for s in line['spans']:
                            if s['text'].strip():spans.append(dict(text=s['text'],bbox=list(s['bbox']),size=s['size'],direction=list(line['dir'])))
                paths=page.get_drawings()
                ims=[dict(bbox=list(im['bbox']),width=im['width'],height=im['height'],xref=im.get('xref'),digest_md5=im['digest'].hex()) for im in page.get_image_info(hashes=True,xrefs=True)]
                c=classify(page,spans,paths,ims)
                pages.append(dict(source_id=sid,page=i+1,**c,page_rect=list(page.rect),rotation=page.rotation,text=spans,images=ims))
            except Exception as e:pages.append(dict(source_id=sid,page=i+1,type='other',confidence=0,title=None,signals={'error':repr(e)},frames=None))
    obj=dict(source_id=sid,sha256=row['sha256'],pages=pages);write(dest,obj)
    append(dict(source_id=sid,stage='page_scan',status='done',pages=len(pages),training_eligible=False));print(sid,len(pages),flush=True);return obj
def pilot():
    inv=inventory()
    rows=[r for r in inv['files'] if r['source_id'] in [f'PDF-{n:03}' for n in PILOT]]
    for r in rows:
        obj=scan(r)
        print(r['source_id'],[(p['page'],p['type'],p['title']) for p in obj['pages'] if p['type'].startswith('plan_')],flush=True)
        with fitz.open(r['path']) as doc:
            for p in obj['pages']:
                if p['type']=='plan_layout':
                    dst=CACHE/'pilot-renders'/f"{r['source_id']}-p{p['page']:03}.png";dst.parent.mkdir(parents=True,exist_ok=True)
                    if not dst.exists():
                        page=doc[p['page']-1];pix=page.get_pixmap(matrix=fitz.Matrix(2500/max(page.rect.width,page.rect.height),2500/max(page.rect.width,page.rect.height)),alpha=False)
                        with dst.open('xb') as f:f.write(pix.tobytes('png'))
if __name__=='__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    p=argparse.ArgumentParser();p.add_argument('stage',choices=['inventory','pilot']);args=p.parse_args()
    globals()[args.stage]()
