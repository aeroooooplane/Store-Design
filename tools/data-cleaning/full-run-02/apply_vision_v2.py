"""Apply saved visual selections to real PDF vectors; new immutable audit revision."""
import argparse,sys,copy
from pathlib import Path
import pymupdf as fitz
from PIL import Image,ImageDraw
from shapely.geometry import Polygon
from sync_sources import OUT,write,sha
from scan_all import read
from geometry_engine import reconstruct,select,dimension_lines
from network_geometry import network_candidates,snap_trace
from extract_candidates import matches

def main():
 sys.stdout.reconfigure(encoding='utf-8');ap=argparse.ArgumentParser();ap.add_argument('batch');args=ap.parse_args()
 batch=Path(args.batch);data=read(batch)
 for r in data['records']:
  sid,n=r['source_id'],r['page'];dest=OUT/'平面候选-视觉修订-r2'/sid/f'p{n:03}'
  if (dest/'receipt.json').exists():continue
  if dest.exists():raise FileExistsError('Existing partial audit output '+str(dest))
  dest.mkdir(parents=True);raw=OUT/'平面候选-r2'/sid/f'p{n:03}/draft.json';d=read(raw)
  with fitz.open(d['source_pdf']) as doc:
   q=doc[n-1];q.remove_rotation();w,h=q.rect.width,q.rect.height;paths=q.get_drawings()
   import geometry6 as g6
   cands=reconstruct(paths,w,h,[dict(points=list(p.exterior.coords)) for p in g6.polygons6(paths,w,h)]);cands.extend(network_candidates(paths,w,h));canvas=r['canvas']
   def props(seeds):
    out=[]
    for label,fun,roi,height in seeds:
     pdfroi=[v*(w/canvas[0] if j%2==0 else h/canvas[1]) for j,v in enumerate(roi)]
     c,score=select(pdfroi,cands,.65)
     out.append(dict(id=f'object-{len(out)+1:03}',label_text=label,function=fun,h=height,height_unit='m',rotation=None,
      bbox_pdf=c['bounds'] if c else None,pdf_polygon=c['points'] if c else None,geometry=c,
      asset_candidates=matches(label,fun,d.get('si_index_label')),confidence=.75 if c else .2,
      evidence=dict(method='vision',selection_roi_canvas=roi,selection_canvas=canvas,selection_roi_pdf=pdfroi,selection_iou=score),training_eligible=False))
    return out
   if 'replace_items' in r:d['items']=props(r['replace_items'])
   if 'fixed_seeds' in r:d['fixed']=props(r['fixed_seeds'])
   if 'obstacle_seeds' in r:d['obstacles']=props(r['obstacle_seeds'])
   if r.get('boundary_action')=='reject':d['boundary']=None
   elif d['boundary']:d['boundary'].update(kind=r.get('boundary_kind'),method='vision_validated_original_vector',confidence=.8)
   if r.get('boundary_trace'):
    d['boundary'],d['boundary_error']=snap_trace(r['boundary_trace'],paths,canvas,w,h)
   d['scale']=dimension_lines(paths,r.get('dimensions',[]),canvas,w,h)
   d.update(visual_check=dict(method='vision',inspected_overlay=r['inspected_overlay'],inspected_sha256=sha(Path(r['inspected_overlay'])),
      correction_overlay_pending=True,batch_file=str(batch),batch_sha256=sha(batch)),needs_human=r['needs_human'],
      provenance_draft=str(raw),provenance_sha256=sha(raw),version_relation=r.get('version_relation'),auto_status='partial',training_eligible=False)
   im=Image.open(d['evidence']).convert('RGB');dr=ImageDraw.Draw(im);sx,sy=im.width/w,im.height/h
   if d['boundary']:dr.line([(x*sx,y*sy) for x,y in d['boundary']['points']],fill='#008cdd',width=5)
   for layer,color in [('items','#10862b'),('fixed','#a82bcc'),('obstacles','#ea7500')]:
    for o in d.get(layer) or []:
     if o['pdf_polygon']:dr.line([(x*sx,y*sy) for x,y in o['pdf_polygon']],fill=color,width=4)
   for c in d['scale']['checks']:
    if c.get('endpoints_pdf'):dr.line([(x*sx,y*sy) for x,y in c['endpoints_pdf']],fill='#b000cd',width=4)
   output=OUT.parent/'_cache/全量续跑-02'/f'{sid}-p{n:03}-vision-r2.png'
   with output.open('xb') as f:im.save(f,format='PNG')
   d['overlay']=str(output);write(dest/'draft.json',d);write(dest/'receipt.json',dict(draft_sha256=sha(dest/'draft.json'),overlay_sha256=sha(output)))
   print(sid,n,'items',sum(bool(o['pdf_polygon']) for o in d['items']),'/',len(d['items']),'scale',d['scale']['status'],flush=True)
if __name__=='__main__':main()
