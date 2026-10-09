"""Conservative source/store/version evidence catalog. No filename dates guessed."""
import argparse,collections,copy,json,re,sys
from pathlib import Path
from sync_sources import OUT,write,meta,sha
from scan_all import read,CACHE as SCANS
from raster_pages import DEST as RASTER
from ocr_pages import BASE as OCR
from classification_v5 import classify

def normalized_name(filename):
 s=Path(filename).stem
 s=re.sub(r'授权体验店|授权专卖店|照材专卖店|照材专区|照材店|专卖店|体验店','',s)
 s=re.sub(r'[（(](?:边厅店?|中岛店?|框架中岛|无框架中岛|迁址|调优)[）)]','',s)
 return re.sub(r'[\s_\-]','',s).casefold()
def observations():
 pages={};dates=collections.defaultdict(list);conflicts=collections.defaultdict(list)
 for path in sorted(OUT.glob('视觉页面复核-*.json')):
  d=read(path)
  for a in d.get('pages',[]):pages[(a['source_id'],a['page'])]={**a,'observation_file':str(path)}
  for a in d.get('date_evidence',[]):dates[a['source_id']].append({**a,'observation_file':str(path)})
  for a in d.get('conflicts',[]):conflicts[a['source_id']].append({**a,'observation_file':str(path)})
 return pages,dates,conflicts
def pages_for(row,visual=None):
 sid=row['source_id'];path=RASTER/sid/'classified.json'
 if not path.exists():path=OCR/sid/'classified.json'
 if not path.exists():path=SCANS/f'{sid}.json'
 if not path.exists():return [],None
 pp=[]
 for raw in read(path)['pages']:
  d=classify(raw);w,h=d['page_rect'][2:];txt=' '.join(s['text'] for s in d['text'])
  if re.search(r'方案汇报|PROPOSAL\s*PRESENTATION|THANKS|谢谢观看',txt,re.I) and d['signals'].get('vector_path_count',0)<50 and d['signals'].get('bitmap_area_ratio',0)<.2:
   d.update(type='cover_index',confidence=.96,title='章节页/封面/结束页')
  # An explicit directory heading outranks incidental drawing names inside its table.
  head=next((s for s in d['joined_text'] if re.sub(r'\s+','',s['text']).upper() in ('图纸目录','图纸清单','DRAWINGINDEX') and (s['bbox'][1]<h*.2 or s['bbox'][0]>.8*w)),None)
  if head:d.update(type='cover_index',confidence=.97,title=head['text'])
  a=(visual or {}).get((sid,d['page']))
  if a:
   d.update(type=a['type'],confidence=.97);d['signals']['visual_observation']=a;d['signals']['requires_vision']=False
   if a.get('frames_count')==1:d['frames']=[dict(frame_id='frame-1',bbox=d['page_rect'],title=d.get('title'),method='vision',boundary='whole_page_evidence',independent_frame_count=1)]
  pp.append(d)
 return pp,path
DATE=re.compile(r'(?<!\d)(20[2][0-6])\s*[.年/\-]\s*(0?[1-9]|1[012])(?:\s*[.月/\-]\s*(0?[1-9]|[12]\d|3[01]))?(?:日)?(?!\d)')
def date_value(t):
 m=DATE.search(t)
 return f'{m[1]}-{int(m[2]):02}'+(f'-{int(m[3]):02}' if m[3] else '') if m else None
def source_evidence(row,pp,vision_dates):
 dates=[];titles=[];units=[]
 for p in pp:
  w,h=p['page_rect'][2:];n=p['page'];spans=p['joined_text']
  full=OCR/'full_plans'/f"{row['source_id']}-p{n:03}.json"
  extra=read(full)['text'] if full.exists() else []
  for s in spans+extra:
   t=s['text'].strip();b=s['bbox'];method='ocr' if 'ocr_confidence' in s else 'pdf_text'
   if len(t)<45 and date_value(t) and (b[0]>.78*w and b[1]>.4*h or p['type']=='cover_index' and b[0]<w*.75 and b[1]>h*.25):
    dates.append(dict(value=date_value(t),text=t,page=n,bbox=b,method=method,context=p['type']))
   if len(t)<80 and b[0]>.78*w and b[1]>.25*h and re.search(r'影石|Insta360',t,re.I) and len(re.sub(r'影石|Insta360|\W','',t,flags=re.I))>2:
    titles.append(dict(text=t,page=n,bbox=b,method=method))
   if len(t)<90 and re.search(r'铺位号|铺位编号|铺号|SHOP\s*(?:NO|NUMBER)',t,re.I):units.append(dict(text=t,page=n,bbox=b,method=method))
 for a in vision_dates:dates.append(dict(value=date_value(a['text']),text=a['text'],pages=a['pages'],method='vision',observation_file=a['observation_file'],revision=a.get('revision')))
 # Exact same evidence can occur in the native and OCR pipelines.
 dates=list({(a.get('page'),tuple(a.get('pages',[])),a['value'],a['text']):a for a in dates}.values())
 values=sorted({a['value'] for a in dates if a['value']})
 return dict(date_evidence=dates,date_values=values,date=values[0] if len(values)==1 else None,title_evidence=titles,shop_unit_evidence=units)
def build():
 manifest=read(OUT/'00_同步与文件清单.json');rows=[r for r in manifest['files'] if r['format']=='pdf'];visual,vd,vc=observations()
 source=[];allpages=[]
 for row in rows:
  sid=row['source_id'];pp,path=pages_for(row,visual);ev=source_evidence(row,pp,vd[sid]);plans=[p for p in pp if p['type']=='plan_layout']
  idx=next((a for a in row['index_matches'] if a['source_id']==sid),row['index_matches'][0] if row['index_matches'] else {})
  source.append(dict(source_id=sid,filename=row['filename'],sha256=row['sha256'],name_key=normalized_name(row['filename']),name_from_index=idx.get('name'),
   city=None,city_status='not_resolved_from_filename',index_status=row['index_status'],si_index_label=idx.get('si'),shop_type=idx.get('shop_type'),
   plan_pages=[p['page'] for p in plans],plan_titles=[dict(page=p['page'],title=p['title']) for p in plans],classification_evidence=str(path) if path else None,
   **ev,conflicts=vc[sid],version_confirmed=False,training_eligible=False))
  for p in pp:
   allpages.append(dict(schemaVersion=1,generatedAt=meta()['generatedAt'],source_id=sid,page=p['page'],type=p['type'],confidence=p['confidence'],title=p['title'],signals=p['signals'],frames=p['frames'],
    frame_detection_status='vision_single_frame' if p['frames'] else 'unverified',page_rect=p['page_rect'],original_rotation=p.get('original_rotation'),
    images=p['images'],text_evidence_file=str(path),training_eligible=False,generator=dict(script='catalog_v2.py',version='1.0.0')))
 # Same content is an alias, never another version or data split.
 parent={r['source_id']:r['source_id'] for r in rows}
 def root(a):
  while parent[a]!=a:a=parent[a]
  return a
 def union(a,b):parent[root(b)]=root(a)
 byhash=collections.defaultdict(list);byname=collections.defaultdict(list)
 for r in source:byhash[r['sha256']].append(r);byname[r['name_key']].append(r)
 for group in list(byhash.values())+list(byname.values()):
  for r in group[1:]:union(group[0]['source_id'],r['source_id'])
 groups=collections.defaultdict(list)
 for r in source:groups[root(r['source_id'])].append(r)
 newids={r['source_id']:419+i for i,r in enumerate(sorted([a for a in rows if a['source_id'].startswith('NEW-')],key=lambda a:a['source_id']))}
 stores=[]
 for group in groups.values():
  number=min([int(r['source_id'][4:]) if r['source_id'].startswith('PDF-') else newids[r['source_id']] for r in group]);sid=f'store-{number:04}'
  distinct=collections.defaultdict(list)
  for r in group:distinct[r['sha256']].append(r)
  bundles=list(distinct.values());bundles.sort(key=lambda a:(a[0]['date'] is None,a[0]['date'] or '',a[0]['source_id']))
  versions=[]
  for i,b in enumerate(bundles,1):
   evidence=[e for a in b for e in a['date_evidence']];values=sorted({e['value'] for e in evidence if e['value']})
   versions.append(dict(version_id=f'v{i}',source_ids=[a['source_id'] for a in b],source_sha256=b[0]['sha256'],
    date=values[0] if len(values)==1 else None,date_evidence=evidence,revision_number=None,version_confirmed=False,
    grouping_status='provisional_source_bundle',source_pages=[dict(source_id=a['source_id'],pages=a['plan_pages']) for a in b],
    version_order_reason='按唯一可读日期排序；缺日期或日期冲突的来源放后，以source_id稳定编号。编号不是修订号。',
    unresolved='同一来源内各布局页的楼层、备选方案、改版关系还需按图框核对；候选页全部保留，不宣称同一实际设计版本。',training_eligible=False))
  stores.append(dict(store_id=sid,split_group=sid,source_ids=[a['source_id'] for a in group],name_keys=sorted({a['name_key'] for a in group}),
   identity_confirmed=False,identity_basis='same_sha256_or_exact_normalized_city_mall_filename',
   identity_caveat='名称相同的迁址/铺型变化暂归同一门店家族；不同铺位可能是不同实体，人工确认前禁止跨训练划分。',
   versions=versions,training_eligible=False,conflicts=[a for r in group for a in r['conflicts']]))
 return dict(sources=source,stores=sorted(stores,key=lambda s:s['store_id']),summary=dict(pdf_files=len(rows),scanned_sources=len({p['source_id'] for p in allpages}),pages=len(allpages),provisional_store_families=len(stores),provisional_source_versions=sum(len(s['versions']) for s in stores))),allpages
def main():
 sys.stdout.reconfigure(encoding='utf-8');ap=argparse.ArgumentParser();ap.add_argument('--snapshot');args=ap.parse_args()
 d,pp=build();dst=OUT/args.snapshot if args.snapshot else OUT;dst.mkdir(exist_ok=True)
 if not args.snapshot:assert d['summary']['scanned_sources']==513 and d['summary']['pages']==16820,'Full source coverage required'
 write(dst/'02_门店与版本.json',{**d,'generator':dict(script='catalog_v2.py',version='1.0.0'),'training_eligible':False})
 with (dst/'01_页面分类.jsonl').open('x',encoding='utf-8') as f:
  for p in pp:f.write(json.dumps(p,ensure_ascii=False,allow_nan=False)+'\n')
 print(json.dumps(d['summary'],ensure_ascii=False),flush=True)
if __name__=='__main__':main()
