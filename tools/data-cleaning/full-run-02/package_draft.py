"""Package evidence-backed draft geometry in the project annotation contract."""
import sys,json,math,copy,re,shutil,itertools,os
from pathlib import Path
from PIL import Image,ImageDraw
from shapely.geometry import Polygon,box
import pymupdf as fitz
from sync_sources import ROOT,OUT,sha,meta
from scan_all import read
from extract_candidates import matches

def write(path,d):
 with Path(path).open('x',encoding='utf-8') as f:json.dump({**d,**meta(), 'generator':dict(script='full-run-02/package_draft.py',version='1.0.0')},f,ensure_ascii=False,indent=2,allow_nan=False)
def cw(points):
 pts=[list(a) for a in points]
 if pts[0]!=pts[-1]:pts.append(pts[0])
 return pts if sum(a[0]*b[1]-b[0]*a[1] for a,b in zip(pts,pts[1:]))>=0 else pts[::-1]
def package(d,row,store,version,dest,context=None):
 context=context or {};dest=Path(dest);receipt=dest/'receipt.json'
 if receipt.exists():
  r=read(receipt)
  for name,h in r['artifacts'].items():assert sha(dest/name)==h,'Receipt mismatch '+str(dest/name)
  return read(dest/'review.json')
 if dest.exists():raise FileExistsError('Never overwrite existing incomplete package '+str(dest))
 dest.mkdir(parents=True)
 src=d.get('source',{});old=read(Path(d['original_annotation'])/'input.json') if d.get('original_annotation') else {}
 idx=next((a for a in row['index_matches'] if a['source_id']==row['source_id']),row['index_matches'][0] if row['index_matches'] else {})
 scale=copy.deepcopy(d['scale']);factor=scale.get('m_per_point') or scale.get('m_per_pdf_point')
 verified=scale.get('status') in ('verified','verified_two_axes') and scale.get('error') is not None and scale['error']<=.02
 scale['two_axes_verified']=bool(verified);factor=factor if verified else None
 boundary=copy.deepcopy(d.get('boundary'));origin=list(Polygon(boundary['points']).bounds[:2]) if boundary else None
 metric=bool(factor and origin);unit='m' if metric else 'pdf_point'
 coords=dict(unit=unit,origin='boundary_bbox_top_left' if metric else 'normalized_pdf_page_top_left',
  boundary_bbox_origin_pdf=origin,axes=dict(x='right',z='down',y='up'),height_unit='m',precision_decimals=3 if metric else None,
  origin_unresolved=origin is None,unit_reason=None if metric else '比例或边界原点尚不可靠，保留原始PDF点坐标。')
 matrix=[factor,0,0,factor,-origin[0]*factor,-origin[1]*factor] if metric else None
 def point(p):return [round((p[0]-origin[0])*factor,3),round((p[1]-origin[1])*factor,3)] if metric else list(p)
 def item(o,movable,ident):
  p=o.get('pdf_polygon') or o.get('evidence',{}).get('pdf_polygon');b=list(Polygon(p).bounds) if p else None
  loc=point(b[:2]) if b else [None,None];ww=round((b[2]-b[0])*factor,3) if metric and b else b[2]-b[0] if b else None;dd=round((b[3]-b[1])*factor,3) if metric and b else b[3]-b[1] if b else None
  label=o.get('label_text');fun=o.get('function') or 'other'
  evidence=copy.deepcopy(o.get('evidence',{}));evidence.update(pdf_polygon=p,pdf_bbox=b,geometry=o.get('geometry'),method=evidence.get('method','vision'))
  return dict(id=ident,label_text=label,label_aliases=o.get('label_aliases',[]),function=fun,x=loc[0],z=loc[1],w=ww,d=dd,
   h=round(o['h'],3) if o.get('h') is not None else None,height_unit='m',rotation=o.get('rotation'),yaw=math.radians(o['rotation']) if o.get('rotation') is not None else None,
   center_x=round(loc[0]+ww/2,3) if b else None,center_z=round(loc[1]+dd/2,3) if b else None,
   footprint=cw([point(a) for a in p]) if p else None,asset_id=None,asset_candidates=(o.get('asset_candidates') or matches(label,fun,idx.get('si'))) if label and movable else [],
   movable=movable,fixed=not movable,confidence=o.get('confidence',.2),evidence=evidence,training_eligible=False)
 common=dict(source_id=row['source_id'],store_id=store,version_id=version,version_confirmed=False,training_eligible=False,draft=True)
 items=[item(o,True,f'object-{i+1:03}') for i,o in enumerate(d.get('items',[]))]
 fixed=[item(o,False,f'fixed-{i+1:03}') for i,o in enumerate(d.get('fixed') or old.get('fixed') or [])]
 obstacles=[item(o,False,f'obstacle-{i+1:03}') for i,o in enumerate(d.get('obstacles') or old.get('obstacles') or [])]
 for o in list(items):
  if o['label_text'] and '硬装' in o['label_text']:
   items.remove(o);o.update(movable=False,fixed=True,asset_candidates=[]);fixed.append(o)
 for o in fixed+obstacles:o['polygon']=o['footprint']
 if boundary:boundary.update(points=cw([point(p) for p in boundary['points']]),confirmed=False)
 entrances=copy.deepcopy(d.get('entrances') or old.get('entrances'))
 inp=dict(**common,coordinates=coords,scale=scale,boundary=boundary,entrances=entrances,obstacles=obstacles or None,fixed=fixed or None,
  stated_area=d.get('stated_area',old.get('stated_area',dict(value=None,evidence=[]))),room_height=d.get('room_height',old.get('room_height',dict(value=None,evidence=[]))),
  si_index_label=idx.get('si'),si_evidence=d.get('si_evidence',old.get('si_evidence')),shop_type=dict(value=idx.get('shop_type'),source='门店资源索引.json' if idx else None),
  requirements=None,rules_source=None)
 target=dict(**common,coordinates=coords,scale_status=scale['status'],items=items,unlabelled_objects_complete=False)
 page=d['page'];source=dict(**common,source_pdf=row['path'],sha256=row['sha256'],physical_page=page,frame_bbox=d.get('frame_bbox',src.get('frame_bbox')),
  crop_bbox=d.get('frame_bbox',src.get('frame_bbox')),render_dpi=d.get('render_dpi',src.get('render_dpi')),pdf_to_m_matrix=None,normalized_pdf_to_m_matrix=matrix,
  title_block=d.get('title_block',src.get('title_block')),version_date=None,revision_number=None,
  version_order_reason=context.get('version_order_reason','临时未确认版本编号，不能认定唯一、最早或已审批版本。'),
  reviewer=None,reviewedAt=None,annotation_status='automatic_draft_with_vision_audit',visual_evidence=d.get('visual_check'),
  provenance=context,frames=context.get('frames'))
 with fitz.open(row['path']) as doc:
  q=doc[page-1];rm=q.rotation_matrix;source.update(original_page_rotation=q.rotation,original_pdf_to_normalized_pdf_matrix=list(rm),page_rotation=0)
  source['pdf_to_m_matrix']=list(rm*fitz.Matrix(matrix)) if matrix else None
  q.remove_rotation();w,h=q.rect.width,q.rect.height
 source['frame_bbox']=source['frame_bbox'] or [0,0,w,h];source['crop_bbox']=source['frame_bbox']
 with Path(d['evidence']).open('rb') as srcfile,(dest/'evidence.png').open('xb') as f:shutil.copyfileobj(srcfile,f)
 im=Image.open(dest/'evidence.png').convert('RGBA');sx,sy=im.width/w,im.height/h
 source['pdf_to_pixel_matrix']=[sx,0,0,sy,0,0]
 layer=Image.new('RGBA',im.size);dr=ImageDraw.Draw(layer);svg=[f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}">','<metadata>Automatic draft. Coordinates: normalized PDF points. See source.json.</metadata>']
 for name,color,rows in [('walls_columns','#008cdd',[]),('entrances','#f000b0',[]),('obstacles','#ea7500',obstacles),('fixed','#a82bcc',fixed),('props','#10862b',items)]:
  svg.append(f'<g id="{name}" fill="none" stroke="{color}" stroke-width="1">')
  pp=[d['boundary']['points']] if name=='walls_columns' and d.get('boundary') else [o['evidence']['pdf_polygon'] for o in rows if o['evidence']['pdf_polygon']]
  for p in pp:
   svg.append('<polyline points="'+' '.join(f'{a},{b}' for a,b in p)+'"/>');dr.line([(a*sx,b*sy) for a,b in p],fill=color,width=4)
  svg.append('</g>')
 svg.append('</svg>')
 with (dest/'geometry.svg').open('x',encoding='utf-8') as f:f.write('\n'.join(svg))
 with (dest/'geometry.png').open('xb') as f:layer.save(f,format='PNG')
 with (dest/'overlay.png').open('xb') as f:Image.alpha_composite(im,layer).convert('RGB').save(f,format='PNG')
 overlap=[];outside=[];located=[o for o in items if o['x'] is not None];bp=Polygon(boundary['points']) if boundary else None
 for a,b in itertools.combinations(located,2):
  pa=box(a['x'],a['z'],a['x']+a['w'],a['z']+a['d']);pb=box(b['x'],b['z'],b['x']+b['w'],b['z']+b['d']);area=pa.intersection(pb).area
  if area>1e-6:overlap.append(dict(objects=[a['id'],b['id']],area=round(area,6),basis='axis_aligned_bounding_boxes'))
 if bp:
  for o in located:
   area=box(o['x'],o['z'],o['x']+o['w'],o['z']+o['d']).difference(bp).area
   if area>1e-6:outside.append(dict(object_id=o['id'],area=round(area,6),basis='axis_aligned_bounding_box'))
 area=bp.area if bp and metric else None;stated=inp['stated_area'].get('value');conflicts=[]
 if row['source_id']=='PDF-239':conflicts.append(dict(field='store_name_city',filename='沈阳百脑汇照材专卖店.pdf',title_text='深航百脑汇店',value=None,reason='文件名与图签冲突；此前深圳的视觉读取已撤回，见原试点review-supplement。'))
 if row['source_id']=='PDF-293':conflicts.append(dict(field='cashier_nominal_length',values_m=[.9,1.8],resolution=None))
 if area and stated and abs(area-stated)/stated>.02:conflicts.append(dict(field='stated_area_vs_boundary',stated=stated,measured=round(area,3),resolution=None))
 needs=d.get('needs_human') or ['入口、墙柱、固定设施与无文字道具尚未完整；不得用于训练。','图签版本、同店跨来源对应关系未经确认。']
 review=dict(**common,auto_status='partial' if items or boundary else 'failed',training_ready_auto=False,scale=scale,
  boundary=dict(closed=bool(bp and bp.is_valid),clockwise=bool(bp),kind=boundary.get('kind') if boundary else None,area_m2=round(area,3) if area else None,
   stated_area=stated,area_difference_ratio=abs(area-stated)/stated if area and stated else None),
  props=dict(item_count=len(items),located_count=len(located),out_of_bounds=outside if bp else None,overlaps=overlap,area_unit='m2' if metric else 'pdf_point2',count_agreement=None),
  circulation=dict(checked=False,reason='入口/完整障碍物尚未确认；未采用未经批准的通道阈值。'),
  unrecognized=['入口朝向与宽度','完整固定设施和墙柱','未标文字道具','版本与多图框归属'],conflicts=conflicts,needs_human=needs,
  visual_check=dict(source_audit=d.get('visual_check'),final_overlay_status='pending',source_overlay=d.get('overlay')))
 for name,obj in [('source.json',source),('input.json',inp),('target-layout.json',target),('review.json',review)]:write(dest/name,obj)
 write(receipt,dict(source_id=row['source_id'],sha256=row['sha256'],artifacts={p.name:sha(p) for p in dest.iterdir() if p.is_file()},auto_status=review['auto_status']))
 return review

def pilot():
 rows={r['source_id']:r for r in read(OUT/'00_同步与文件清单.json')['files']};gate=read(OUT/'试点验收-r12.json')
 for a in gate['rows']:
  d=read(a['draft']);sid=a['source_id'];store=f"store-{int(sid[4:]):04}";dest=OUT/'试点标准标注-r12'/store/'v1'
  d['visual_check']['final_gate_record']=a
  review=package(d,rows[sid],store,'v1',dest,dict(pilot_gate=str(OUT/'试点验收-r12.json'),frames=[dict(frame_id='frame-1',bbox=d['source']['frame_bbox'],method='vision',independent_frame_count=1)]))
  print(sid,review['auto_status'],review['props']['located_count'],flush=True)
if __name__=='__main__':sys.stdout.reconfigure(encoding='utf-8');pilot()
