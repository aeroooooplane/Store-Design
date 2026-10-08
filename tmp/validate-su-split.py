from pathlib import Path
import json, xml.etree.ElementTree as ET, numpy as np
from urllib.parse import unquote
from PIL import Image
# Trusted local SketchUp export contains a 382 MP source texture. Verify PNG
# structure/CRC without allocating a full uncompressed bitmap.
Image.MAX_IMAGE_PIXELS=500_000_000
BASE=Path(__file__).resolve().parents[1]
ROOT=BASE/'资源库/90_处理过程与审核/模型拆分/split-20260925-v2'
def check(folder):
 p=folder/'prop.dae';meta=json.loads((folder/'metadata.json').read_text('utf8'))
 r=ET.parse(p).getroot();ns={'c':r.tag.split('}')[0][1:]};ids={e.get('id'):e for e in r.iter() if e.get('id')}
 unit=float(r.find('c:asset/c:unit',ns).get('meter'));up=r.find('c:asset/c:up_axis',ns).text
 imgs=[unquote(e.text) for e in r.findall('.//c:library_images/c:image/c:init_from',ns)]
 missing=[x for x in imgs if not (folder/x).is_file()]; corrupt=[];large=[]
 for f in imgs:
  if f not in missing:
   try:
    with Image.open(folder/f) as im:
     if im.width*im.height>89_478_485:large.append({'file':f,'width':im.width,'height':im.height,'note':'Header/container integrity verified; full bitmap decode and visual inspection not performed.'})
     im.verify()
   except Exception as e:corrupt.append({'file':f,'error':str(e)})
 verts={}
 for g in r.findall('c:library_geometries/c:geometry',ns):
  arrays=[];position_cache={}
  mesh=g.find('c:mesh',ns)
  if mesh is None:continue
  for primitive in mesh:
   if primitive.tag.split('}')[-1] not in ['triangles','polylist','polygons']:continue
   inputs=primitive.findall('c:input',ns)
   vi=next((i for i in inputs if i.get('semantic')=='VERTEX'),None)
   if vi is None:continue
   vertex=ids[vi.get('source')[1:]]
   pi=next(i for i in vertex.findall('c:input',ns) if i.get('semantic')=='POSITION')
   source_id=pi.get('source')[1:]
   if source_id not in position_cache:
    src=ids[source_id]
    position_cache[source_id]=np.fromstring(src.find('c:float_array',ns).text,sep=' ').reshape(-1,3)
   positions=position_cache[source_id]
   stride=max(int(i.get('offset',0)) for i in inputs)+1
   indices=[np.fromstring(p.text,sep=' ',dtype=np.int64).reshape(-1,stride)[:,int(vi.get('offset',0))] for p in primitive.findall('c:p',ns)]
   if indices:arrays.append(positions[np.unique(np.concatenate(indices))])
  if arrays:verts[g.get('id')]=np.concatenate(arrays)
 lo=np.full(3,np.inf);hi=-lo;instances=0
 def walk(n,t,stack=()):
  nonlocal lo,hi,instances
  if id(n) in stack:raise ValueError('Recursive DAE node')
  for mat in n.findall('c:matrix',ns):t=t@np.fromstring(mat.text,sep=' ').reshape(4,4)
  unexpected=[e.tag for e in n if e.tag.split('}')[-1] in ['translate','rotate','scale','lookat','skew']]
  if unexpected:raise ValueError('Unhandled transforms: '+str(unexpected))
  for ig in n.findall('c:instance_geometry',ns):
   a=verts.get(ig.get('url')[1:])
   if a is None:continue
   a=a@t[:3,:3].T+t[:3,3];lo=np.minimum(lo,a.min(0));hi=np.maximum(hi,a.max(0));instances+=1
  for i in n.findall('c:instance_node',ns):walk(ids[i.get('url')[1:]],t,stack+(id(n),))
  for ch in n.findall('c:node',ns):walk(ch,t,stack+(id(n),))
 scene_id=r.find('c:scene/c:instance_visual_scene',ns).get('url')[1:]
 walk(ids[scene_id],np.eye(4))
 dims=(hi-lo)*unit; delta=np.abs(dims-np.array(meta['world_bounds_m']))
 skp=folder/'prop.skp';skp_ok=skp.is_file() and skp.stat().st_size>100
 ok=instances>0 and np.isfinite(dims).all() and float(delta.max())<=0.001 and not missing and not corrupt and skp_ok
 return {'status':'passed' if ok else 'review_required','dae_bounds_m':dims.tolist(),'sketchup_bounds_m':meta['world_bounds_m'],'max_dimension_error_mm':float(delta.max()*1000),'texture_count':len(imgs),'missing_textures':missing,'corrupt_textures':corrupt,'large_textures':large,'geometry_instances':instances,'unique_meshes':len(verts),'triangles_in_definitions':sum(int(e.get('count',0)) for e in r.findall('.//c:triangles',ns)),'unit_meter':unit,'up_axis':up,'skp_bytes':skp.stat().st_size if skp.exists() else 0,'dae_bytes':p.stat().st_size}
if __name__=='__main__':
 m=json.loads((ROOT/'manifest.json').read_text('utf8'));results=[]
 for asset in m['assets']:
  if not asset.get('folder'):continue
  dest=ROOT/asset['asset_id']/'validation.json'
  try:
   v=json.loads(dest.read_text('utf8')) if dest.exists() else {}
   if v.get('check_version')!=2:
    v=check(ROOT/asset['folder']);v['check_version']=2
  except Exception as e:v={'status':'failed','error':str(e)}
  dest.write_text(json.dumps(v,ensure_ascii=False,indent=2),encoding='utf8')
  results.append({'asset_id':asset['asset_id'],**v})
  print(asset['asset_id'],v['status'],flush=True)
 report={'checked':len(results),'passed':sum(v['status']=='passed' for v in results),'review_required':[v for v in results if v['status']!='passed'],'results':results,'scope':'XML解析、实际网格包围盒、全部贴图引用存在、图片头及容器完整性检查；不等于逐面材质或透明贴图视觉验收'}
 (ROOT/'validation-summary.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf8')
 print({k:v for k,v in report.items() if k!='results'})
