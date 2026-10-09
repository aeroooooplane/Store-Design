"""Build and render a single fixed 3D scene from plan + original SKP assets."""
import hashlib
from array import array
import json
import math
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[4]/'scripts'))
from render_core import validate_scale
import bpy
from mathutils import Vector, Matrix
from mathutils.geometry import tessellate_polygon

BASE=Path(__file__).resolve().parents[1]
WORK=BASE/'tmp/xian_skp'
OUT=BASE/'outputs/xian_si10_v3'
OUT.mkdir(parents=True,exist_ok=True)
SPEC=json.loads((BASE/'store_effect_poc/xian_si10_scene_v2.json').read_text(encoding='utf-8'))
ARGS=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
scene=bpy.context.scene
scene.unit_settings.system='METRIC'

def from_plan(point):
    """PDF: x right, y down. World: x right, y up. Never mirror mesh assets."""
    return (point[0],-point[1],point[2])
scene.unit_settings.length_unit='METERS'

def material(name, color, rough=.45, metallic=0, emission=0):
    mat=bpy.data.materials.new(name)
    mat.diffuse_color=(*color,1)
    mat.use_nodes=True
    bsdf=mat.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value=(*color,1)
    bsdf.inputs['Roughness'].default_value=rough
    bsdf.inputs['Metallic'].default_value=metallic
    if emission:
        bsdf.inputs['Emission Color'].default_value=(*color,1)
        bsdf.inputs['Emission Strength'].default_value=emission
    return mat

wall=material('SI1.0 | 银灰墙面',(.49,.51,.52),.6)
ceiling_mat=material('SI1.0 | 保留白色天花',(.76,.77,.76),.82)
metal=material('SI1.0 | 门楣拉丝银灰金属',(.44,.47,.49),.33,.7)
black=material('轨道及灯具黑色',(.018,.021,.024),.43,.3)
white_light=material('灯具发光面',(.95,.94,.90),.3,0,3)
clay=material('白模材质 | 仅覆盖材质不改变几何',(.67,.68,.68),.7)
ground=material('公区中性地面',(.47,.48,.48),.6)
floor_mat=material('SI1.0 | 灰色地面',(.32,.34,.34),.55)
# Dimensioned 300 x 600 mm tile pattern; finish remains a stated SI1.0 assumption.
nodes=floor_mat.node_tree.nodes
links=floor_mat.node_tree.links
texcoord=nodes.new('ShaderNodeTexCoord')
brick=nodes.new('ShaderNodeTexBrick')
brick.inputs['Color1'].default_value=(.25,.27,.28,1)
brick.inputs['Color2'].default_value=(.30,.32,.33,1)
brick.inputs['Mortar'].default_value=(.18,.19,.20,1)
brick.inputs['Scale'].default_value=1
brick.inputs['Mortar Size'].default_value=.0012
brick.inputs['Brick Width'].default_value=.6
brick.inputs['Row Height'].default_value=.3
brick.offset=0
links.new(texcoord.outputs['Object'],brick.inputs['Vector'])
links.new(brick.outputs['Color'],nodes.get('Principled BSDF').inputs['Base Color'])
noise=nodes.new('ShaderNodeTexNoise')
noise.inputs['Scale'].default_value=220
links.new(texcoord.outputs['Object'],noise.inputs['Vector'])
bump=nodes.new('ShaderNodeBump')
bump.inputs['Strength'].default_value=.12
bump.inputs['Distance'].default_value=.001
links.new(noise.outputs['Fac'],bump.inputs['Height'])
links.new(bump.outputs['Normal'],nodes.get('Principled BSDF').inputs['Normal'])

def box(name,center,size,mat,bevel=0):
    bpy.ops.mesh.primitive_cube_add(size=1,location=from_plan(center))
    obj=bpy.context.object
    obj.name=name
    obj.dimensions=size
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    obj.data.materials.append(mat)
    if bevel:
        mod=obj.modifiers.new('微倒角','BEVEL')
        mod.width=bevel
        mod.segments=2
    return obj

def prism(name,points,z0,z1,mat):
    points=[(x,-y) for x,y in reversed(points)]
    n=len(points)
    vertices=[(x,y,z) for z in (z0,z1) for x,y in points]
    vectors=[Vector((x,y,0)) for x,y in points]
    triangles=tessellate_polygon([vectors])
    lookup={tuple(v):i for i,v in enumerate(vectors)}
    tris=[[v if isinstance(v,int) else lookup[tuple(v)] for v in tri] for tri in triangles]
    faces=[list(reversed(t)) for t in tris]+[[i+n for i in t] for t in tris]
    faces += [[i,(i+1)%n,(i+1)%n+n,i+n] for i in range(n)]
    mesh=bpy.data.meshes.new(name)
    mesh.from_pydata(vertices,[],faces)
    mesh.update()
    obj=bpy.data.objects.new(name,mesh)
    scene.collection.objects.link(obj)
    obj.data.materials.append(mat)
    return obj

def area(name,location,target,power,size,color=(1,.96,.9)):
    data=bpy.data.lights.new(name,'AREA')
    data.energy=power
    data.shape='DISK'
    data.size=size
    data.color=color
    obj=bpy.data.objects.new(name,data)
    scene.collection.objects.link(obj)
    obj.location=from_plan(location)
    obj.rotation_euler=(Vector(from_plan(target))-obj.location).to_track_quat('-Z','Y').to_euler()
    return obj

def camera(name,position,target,lens,ortho=None):
    data=bpy.data.cameras.new(name)
    obj=bpy.data.objects.new(name,data)
    scene.collection.objects.link(obj)
    obj.location=from_plan(position)
    obj.rotation_euler=(Vector(from_plan(target))-obj.location).to_track_quat('-Z','Y').to_euler()
    data.lens=lens
    data.clip_start=.02
    data.clip_end=250
    if ortho:
        data.type='ORTHO'
        data.ortho_scale=ortho
    return obj

def outline(inset=0):
    w=4.85-inset
    r=2-inset
    x=2.85
    pts=[(inset,inset),(x,inset)]
    pts += [(x+r*math.cos(a),2+r*math.sin(a)) for a in [(-math.pi/2)+i*(math.pi/2)/48 for i in range(1,49)]]
    pts.append((w,6.79))
    pts += [(x+r*math.cos(a),6.79+r*math.sin(a)) for a in [i*(math.pi/2)/48 for i in range(1,49)]]
    pts.append((inset,8.79-inset))
    return pts

floor=prism('租赁区地面 | 圆角R2000',outline(),-.045,0,floor_mat)
box('公区地面',(3,4.4,-.08),(28,30,.065),ground)
# User confirmed the adjoining shop is openly connected: no physical left wall.
prism('中部员工休息室及柱体外包墙',SPEC['core']['wall_outline'],0,3.494,wall)
prism('原建筑柱体',SPEC['core']['structural_column'],0,3.494,wall)
box('员工休息室门洞上梁',(2.46,2.997,2.797),(.12,.60,1.394),wall)
box('员工休息室门扇',(2.48,2.997,1.05),(.035,.58,2.1),wall,.005)
box('门把手',(2.445,3.20,1.05),(.04,.015,.14),metal,.004)
ceiling=prism('保留天花 | 标高3494',outline(),3.494,3.56,ceiling_mat)
fascia_path=outline(-.001)  # 1 mm visual separation prevents coplanar overlap with the core wall.
inner_path=outline(.2)
# Smooth ring follows the same sampled circular contour as the plan.
ring=fascia_path+list(reversed(inner_path))
prism('金属门楣 | 底3097 高403',ring,3.097,3.5,metal)

# Lighting layout is explicitly an assumption; light mounting level follows plan.
for x in (.6,1.8):
    box('轨道灯 | H3200',(x,4.4,3.2),(.028,8.05,.025),black)
    for y in (.65,2.0,3.45,4.9,6.35,7.95):
        box('轨道射灯灯体',(x,y,3.12),(.07,.13,.16),black,.012)
        box('射灯发光面',(x,y,3.036),(.055,.10,.007),white_light)
        area('射灯布光',(x,y,3.025),(x,y,0),45,.16)
for y in (.65,7.92):
    box('右侧轨道灯',(3.35,y,3.2),(1.2,.028,.025),black)
    for x in (2.9,3.4,3.9):
        curve_y=2.0 if y<2 else 6.79
        assert (x-2.85)**2+(y-curve_y)**2 < 1.8**2, 'Lamp outside inner fascia arc'
        box('右侧射灯灯体',(x,y,3.12),(.07,.13,.16),black,.012)
        area('右侧射灯布光',(x,y,3.02),(x,y,.7),40,.15)
for location,target,power,size in [((2,-2,3.8),(2,2,1),450,4),((8,4,4),(3,4,1.3),550,5),((2,11,3.8),(2,7,1.0),450,4)]:
    area('公区环境补光',location,target,power,size,(.93,.96,1))

asset_reports=[]
def load_asset(placement):
    key=placement['asset']
    source=WORK/'assets'/(key+'.blend')
    if not source.exists():
        raise FileNotFoundError('Missing original asset '+str(source))
    with bpy.data.libraries.load(str(source),link=False) as (src,dst):
        dst.collections=['ASSET_'+key]
    coll=dst.collections[0]
    obj=bpy.data.objects.new(placement['id'],None)
    obj.instance_type='COLLECTION'
    obj.instance_collection=coll
    scene.collection.objects.link(obj)
    lo=Vector(coll['bounds_min'])
    hi=Vector(coll['bounds_max'])
    pivot=Vector(((lo.x+hi.x)/2,(lo.y+hi.y)/2,lo.z))
    # Orientation + translation only, unless a uniform logo scale is explicitly given.
    rot=Matrix.Identity(4)
    rotations=placement.get('rotations',[])
    # Preserve each asset's handedness and readable text. Convert its front heading,
    # rather than reflecting its geometry with a negative scale.
    if key=='accessory_1600':
        rotations=[('Z',-sum(d for axis,d in rotations if axis=='Z'))]
    elif key not in ('lightbox_artwork','portrait_artwork'):
        assert all(axis=='Z' for axis,d in rotations)
        rotations=[('Z',180-sum(d for axis,d in rotations if axis=='Z'))]
    for axis,degrees in rotations:
        rot=Matrix.Rotation(math.radians(degrees),4,axis) @ rot
    scale=placement.get('uniform_scale',1)
    validate_scale(key,scale)
    rs=rot @ Matrix.Scale(scale,4)
    corners=[rs @ Vector((x,y,z)) for x in (lo.x,hi.x) for y in (lo.y,hi.y) for z in (lo.z,hi.z)]
    rlo=Vector([min(v[i] for v in corners) for i in range(3)])
    rhi=Vector([max(v[i] for v in corners) for i in range(3)])
    pivot=Vector(((rlo.x+rhi.x)/2,(rlo.y+rhi.y)/2,rlo.z))
    obj.matrix_world=Matrix.Translation(Vector(from_plan(placement['location']))) @ Matrix.Translation(-pivot) @ rs
    obj['source_asset']=str(source)
    obj['asset_transform_policy']='rigid furniture; explicitly declared uniform signage scale'
    obj['plan_fixture']=placement['id']
    asset_reports.append({'id':placement['id'],'asset':key,'native_dimensions':list(hi-lo),'placed_dimensions':list(rhi-rlo),'transform':list(sum((list(row) for row in obj.matrix_world),[]))})
    return obj

if '--shell-only' not in ARGS:
    mapping=json.loads((WORK/'asset_placement.json').read_text(encoding='utf-8'))
    for item in mapping['placements']:
        load_asset(item)
    box('东侧灯箱边框 | W1700 H3000',(4.825,4.89,1.5),(.055,1.7,3.0),metal)
    box('配电间检修门 | 高度待立面确认',(4.851,2.94,1.05),(.012,.58,2.1),wall,.004)
    box('开箱垫',(4.10,1.197,.902),(.7,.35,.004),floor_mat,.008)

# Adapt shading parameters using original material names; mesh shape, color maps and UVs stay intact.
for mat in bpy.data.materials:
    if not mat.use_nodes:
        continue
    shader=next((n for n in mat.node_tree.nodes if n.type=='BSDF_PRINCIPLED'),None)
    if not shader:
        continue
    name=mat.name.lower()
    if any(w in name for w in ['不锈钢','金属','银色桌腿','steel','aluminium','aluminum']):
        shader.inputs['Metallic'].default_value=.65
        shader.inputs['Roughness'].default_value=.34
    if any(w in name for w in ['烤漆','桌面材质','人造石']):
        shader.inputs['Roughness'].default_value=.4
    if any(w in name for w in ['玻璃','translucent glass','磨砂亚克力']):
        shader.inputs['Transmission Weight'].default_value=.65
        shader.inputs['Roughness'].default_value=.25
    if any(w in name for w in ['画面','屏幕','发光','emissive']):
        base=shader.inputs['Base Color']
        if base.is_linked:
            mat.node_tree.links.new(base.links[0].from_socket,shader.inputs['Emission Color'])
        else:
            shader.inputs['Emission Color'].default_value=base.default_value
        shader.inputs['Emission Strength'].default_value=.55 if '画面' in name or '屏幕' in name else 1.0

cameras=[
    camera('01_storefront',(8,15.79,4.1),(2.2,5.49,1.6),35),
    camera('02_entry_overview',(2.0,10.59,1.72),(1.8,4.29,1.42),22),
    camera('03_main_aisle',(-7,4.4,3.0),(1.9,4.4,1.1),26),
    camera('04_core_displays',(-2.5,11.7,2.65),(1.8,6.2,1.0),28),
    camera('05_cashier',(-3.2,-4.5,2.7),(1.95,2.7,1.0),28),
    camera('06_feature_wall',(-6.8,0.0,3.0),(1.5,4.3,1.1),25),
    camera('07_front_relationship',(2.425,15.5,2.7),(2.425,5.2,1.15),30),
    camera('08_back_relationship',(2.425,-6.5,2.7),(2.425,3.5,1.15),30),
    camera('09_right_relationship',(11.8,4.4,3.0),(2.8,4.4,1.1),26)
]
top=camera('11_plan_check',(2.425,4.395,16),(2.425,4.395,0),35,15.0)
overview=camera('10_spatial_overview',(-9,14,11),(2.2,4.3,.8),42)
scene.render.engine='CYCLES'
scene.cycles.device='CPU'
scene.cycles.samples=24 if '--preview' in ARGS else 64
scene.cycles.use_denoising=True
scene.cycles.max_bounces=6
scene.cycles.diffuse_bounces=3
scene.cycles.glossy_bounces=3
scene.render.resolution_x=1200 if '--preview' in ARGS else 1800
scene.render.resolution_y=800 if '--preview' in ARGS else 1200
scene.render.resolution_percentage=100
scene.render.image_settings.file_format='PNG'
scene.render.film_transparent=False
scene.view_settings.view_transform='AgX'
scene.view_settings.look='AgX - Medium High Contrast'
scene.view_settings.exposure=-.25
scene.world.use_nodes=True
scene.world.node_tree.nodes['Background'].inputs['Color'].default_value=(.7,.75,.83,1)
scene.world.node_tree.nodes['Background'].inputs['Strength'].default_value=.45

def signatures():
    geos=[]
    for obj in sorted(bpy.data.objects,key=lambda o:o.name):
        if obj.type=='MESH' or obj.instance_type=='COLLECTION':
            geos.append((obj.name,obj.type,obj.data.name if obj.data else obj.instance_collection.name,obj.hide_render,[round(v,7) for row in obj.matrix_world for v in row]))
    vertices_hash=hashlib.sha256()
    for mesh in sorted(bpy.data.meshes,key=lambda m:m.name):
        coordinates=array('f',[0.0])*(len(mesh.vertices)*3)
        indices=array('i',[0])*len(mesh.loops)
        mesh.vertices.foreach_get('co',coordinates)
        mesh.loops.foreach_get('vertex_index',indices)
        vertices_hash.update(mesh.name.encode())
        vertices_hash.update(coordinates.tobytes())
        vertices_hash.update(indices.tobytes())
    cams=[(c.name,[round(v,7) for row in c.matrix_world for v in row],c.data.lens) for c in cameras]
    digest=lambda v:hashlib.sha256(json.dumps(v,sort_keys=True).encode()).hexdigest()
    active=scene.camera
    active_state=(active.name,[round(v,7) for row in active.matrix_world for v in row],active.data.type,active.data.lens,active.data.ortho_scale)
    return {'mesh_transforms_sha256':digest(geos),'geometry_sha256':vertices_hash.hexdigest(),'camera_sha256':digest(cams),'active_camera_sha256':digest(active_state),'objects':len(geos)}

bpy.context.view_layer.update()
scene.camera=cameras[0]
scene['render_policy']='One scene, fixed cameras, material override only. No image generation.'
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'西安赛高_SI1.0_原模型复原场景.blend'))
validation={'source_plan':SPEC['source_plan'],'source_assets':SPEC['source_assets'],'assets':asset_reports,'assumptions':SPEC['assumptions'],'asset_notes':mapping['notes'] if '--shell-only' not in ARGS else [],'left_boundary':SPEC['left_boundary'],'coordinate_convention':'PDF X right Y down -> world X right Y up: (x,-y,z). Assets retain positive scale; front headings converted.','primary_view_plan_side':'图纸右下侧，GO/X中岛端','passes':[]}
selected=cameras
if '--resume-from' in ARGS:
    start=int(ARGS[ARGS.index('--resume-from')+1])-1
    checkpoint=json.loads((WORK/'completed_views_checkpoint.json').read_text(encoding='utf-8'))
    for cam in cameras[:start]:
        recorded=checkpoint['cameras'][cam.name]
        assert recorded=={'matrix':[round(x,7) for row in cam.matrix_world for x in row],'lens':cam.data.lens}, 'Retained camera was changed'
    current=signatures()
    for p in checkpoint['passes']:
        assert p['geometry_sha256']==current['geometry_sha256']
        assert p['mesh_transforms_sha256']==current['mesh_transforms_sha256']
    for path,expected in checkpoint['image_hashes'].items():
        assert hashlib.sha256((OUT/path).read_bytes()).hexdigest()==expected, 'Retained image was changed'
    validation['passes']=checkpoint['passes']
    validation['retained_views']='Completed views retained after verifying unchanged camera matrices, geometry and image hashes; remaining views follow the latest user framing request.'
    selected=cameras[start:]
if '--one' in ARGS:
    selected=[cameras[int(ARGS[ARGS.index('--one')+1])-1]]
if '--build-only' not in ARGS:
    for cam in selected:
        scene.camera=cam
        for mode in ('material','white'):
            scene.cycles.samples=(24 if '--preview' in ARGS else 64) if mode=='material' else 16
            scene.view_layers[0].material_override=clay if mode=='white' else None
            folder=OUT/mode
            folder.mkdir(exist_ok=True)
            scene.render.filepath=str(folder/(cam.name+'.png'))
            validation['passes'].append({'camera':cam.name,'mode':mode,**signatures()})
            print('RENDER_START',cam.name,mode,flush=True)
            bpy.ops.render.render(write_still=True)
            (OUT/'validation.json').write_text(json.dumps(validation,ensure_ascii=False,indent=2),encoding='utf-8')
    scene.view_layers[0].material_override=None
    ceiling.hide_render=True
    for obj in bpy.data.objects:
        if obj.name.startswith('金属门楣') or obj.name.startswith('轨道') or obj.name.startswith('右侧轨道') or obj.name.startswith('射灯') or obj.name.startswith('右侧射灯') or ('fascia' in obj.name):
            obj.hide_render=True
    scene.cycles.samples=24
    for cam in (() if '--skip-overview' in ARGS else (top,overview)):
        scene.camera=cam
        scene.view_layers[0].material_override=None
        scene.render.filepath=str(OUT/(cam.name+'.png'))
        bpy.ops.render.render(write_still=True)
        if cam==overview:
            auxiliary_signature=signatures()
            validation['auxiliary_passes']=[{'camera':cam.name,'mode':'material',**auxiliary_signature}]
            scene.view_layers[0].material_override=clay
            scene.cycles.samples=16
            scene.render.filepath=str(OUT/'white'/(cam.name+'.png'))
            bpy.ops.render.render(write_still=True)
            validation['auxiliary_passes'].append({'camera':cam.name,'mode':'white',**signatures()})
            scene.view_layers[0].material_override=None
            (OUT/'validation.json').write_text(json.dumps(validation,ensure_ascii=False,indent=2),encoding='utf-8')
else:
    (OUT/'validation.json').write_text(json.dumps(validation,ensure_ascii=False,indent=2),encoding='utf-8')
print('SCENE_READY',str(OUT),flush=True)
