"""Package audited pilot drafts. Does not authorize or run full batch before its gate.

All artifacts are exclusive-created. Completed stores resume only with verified receipts.
This script deliberately preserves unknown geometry as null and all eligibility as false.
"""
import copy,csv,html,math,re,shutil,itertools,collections
import pymupdf as fitz
from PIL import Image,ImageDraw
from shapely.geometry import Polygon,box
from pipeline import ROOT,OUT,CACHE,read,digest,inventory,meta as oldmeta,PILOT

VERSION='1.0.0'
ANNOTATIONS=ROOT/'资源库/90_处理过程与审核/训练标注'
BASE=CACHE/'pilot-r8'
# These are visual decisions on actual rendered overlays, not inferred dimensions.
BAD={3:[8],5:[6],8:[5],13:[5],32:[2,3],35:[3],49:[6,7,11],239:[5,8,9],293:[6],296:[4,10]}
MERGES={2:[[8,12]],3:[[3,4]],5:[[4,5]],8:[[4,6,9]],32:[[8,9,10]],49:[[2,3,4]],71:[[1,2]],293:[[10,11]]}
BOUNDARY={1:'lease_line',19:'outer_outline',29:'lease_line',32:'outer_outline',35:'display_zone',51:'outer_outline',88:'lease_line',90:'outer_outline',239:'platform_outline',293:'platform_outline',296:'platform_outline'}
# Strict store-level pilot gate: boundary and prop candidates agree before selective nulling.
PASS={1,19,29,32,35,51,88,90}
NOTES={
1:'租赁线与主要桌柜相符；圆柱、凳子及入口线段仍不完整。第2页73㎡与第15页78.9㎡冲突。',
2:'主要桌柜可见，但狭长异形店界未闭合；GO中岛与通用中岛文字指向同一实体。',
3:'屏幕误匹配到洽谈椅；收银台与开箱文字指向同一组合桌；墙界、椅子缺失。',
5:'边界候选跨到图外；收银与开箱重复，屏幕候选错误；培训凳只识别一件，数量不全。',
8:'弧形店界未恢复；多个收银/开箱文字重复；4个凳子仅匹配一件；一个屏幕误匹配墙体。',
13:'包围候选是玻璃内沿，不能作为店界；收银候选误匹配人形模特底座。',
19:'外轮廓与桌柜基本相符；斜向屏幕和电子水牌无可靠包围框，消防设施未完整提取。',
29:'深红色租赁虚线闭合正确；凳子只匹配一件，仓库两组货架未结构化。',
32:'店界与主要桌子相符；两个配件柜标签误匹配中岛桌，收银/开箱重复，椅子未齐。',
35:'已从尼康使用区中分离影石展示区；配件柜误匹配储物开箱桌，另一配件柜未定位。',
43:'平面标题和道具文字大部分转曲；自动提取为零件，不能作为结构化完成。',
49:'配件柜包围框包含柱子；储物柜误匹配桌上产品；屏幕误匹配储物柜，店界未恢复。',
51:'店界及桌体相符；左侧配件柜未定位，LED屏未独立提取；完整固定设施仍待确认。',
71:'只能读取组合收银/开箱桌；两张大桌及展示柜缺失，边界未恢复。',
88:'反向虚线链拼接后租赁轮廓相符；柱子、员工休息室、固定设施尚不完整。',
90:'地台边界和主要道具相符；配件柜未定位，座椅与入口未结构化。',
239:'文件名沈阳、图签深圳冲突；配件柜/屏幕/储物柜候选误匹配柱体组合，城市保持未知。',
293:'地台曲线候选与原图基本相符，曲线离散误差未评估；曲线配件柜未定位，屏幕错配，中英收银长度不一致。',
296:'地台闭合轮廓相符；配件柜与屏幕包围框包含背墙/灯箱，予以置空。',
353:'两张中岛和配件柜可见；专区边界、圆洽谈桌及椅子未提取，屏幕未定位。'}
SCALE_EVIDENCE={
1:[dict(axis='x',label='13037',length_m=13.037,endpoints=[[183.9600067138672,655.3199462890625],[922.9199829101562,655.3199462890625]],path_index=350,endpoint_method='dimension_extension_intersections'),dict(axis='z',label='7713',length_m=7.713,endpoints=[[140.0399932861328,154.67999267578125],[140.0399932861328,591.8399658203125]],path_index=199,endpoint_method='dimension_extension_intersections')],
19:[dict(axis='x',label='4900',length_m=4.9,endpoints=[[364.1399841308594,770.9600219726562],[825.1199951171875,770.9600219726562]],path_index=3680,endpoint_method='dimension_segment'),dict(axis='z',label='6290',length_m=6.29,endpoints=[[308.7599792480469,114.739990234375],[308.7599792480469,706.4000244140625]],path_index=3692,endpoint_method='dimension_segment')],
51:[dict(axis='x',label='6700',length_m=6.7,endpoints=[[175.739990234375,623.9000244140625],[932.219970703125,623.9000244140625]],path_index=503,endpoint_method='dimension_segment'),dict(axis='z',label='2400',length_m=2.4,endpoints=[[973.5599975585938,293.60003662109375],[973.5599975585938,564.5599975585938]],path_index=1352,endpoint_method='dimension_segment')]}

def meta():
    m=oldmeta();m['generator']={'script':'package_pilot.py','version':VERSION};return m
def write(path,data):
    path=Path(path);path.parent.mkdir(parents=True,exist_ok=True)
    with path.open('x',encoding='utf-8') as f:json.dump({**data,**meta()},f,ensure_ascii=False,indent=2,allow_nan=False)
from pathlib import Path
import json,os,sys
def append(row):
    with (OUT/'progress.jsonl').open('a',encoding='utf-8') as f:
        f.write(json.dumps({**meta(),**row},ensure_ascii=False)+'\n');f.flush();os.fsync(f.fileno())
def invalidate(a,reason):
    a['evidence']['rejected_geometry']={k:a.get(k) for k in ['x','z','w','d','pdf_polygon']}
    a['evidence']['rejected_geometry']['pdf_polygon']=a['evidence'].get('pdf_polygon')
    for k in ['x','z','w','d','center_x','center_z']:a[k]=None
    a['evidence']['pdf_polygon']=None;a['evidence']['geometry_status']='unresolved';a['evidence']['rejection_reason']=reason;a['confidence']=.2
def clockwise(points):
    # Positive signed area is clockwise on an x-right/z-down display.
    s=sum(a[0]*b[1]-b[0]*a[1] for a,b in zip(points,points[1:]))
    return points if s>=0 else list(reversed(points))
def nominal(t):
    t=re.split(r'H\s*[:：]',t,flags=re.I)[0]
    m=re.search(r'(\d+(?:\.\d+)?)\s*(米|mm|m)(?![a-z])',t,re.I)
    return float(m[1])/(1000 if m[2].lower()=='mm' else 1) if m else None
def frame_info(num,source):
    # The selected pilot pages were individually inspected; no confirmed multi-frame page.
    return dict(frame_id='frame-1',bbox=source['frame_bbox'],title='平面布置/家具定位候选',method='vision',crop_policy='full_page_evidence',independent_frame_count=1)

def run_store(row):
    sid=row['source_id'];n=int(sid[4:]);src=BASE/sid;store=f'store-{n:04}';dest=ANNOTATIONS/store/'v1'
    receipt=CACHE/'receipts'/f'{sid}.json'
    if receipt.exists():
        r=read(receipt)
        if r['source_sha256']!=row['sha256']:raise RuntimeError('Source changed')
        for name,sha in r['artifacts'].items():
            if digest(dest/name)!=sha:raise RuntimeError('Output receipt mismatch: '+name)
        return read(dest/'review.json')
    if dest.exists():raise FileExistsError('No valid receipt for existing output: '+str(dest))
    dest.mkdir(parents=True)
    source=read(src/'source.json');inp=read(src/'input.json');target=read(src/'target-layout.json');review=read(src/'review.json')
    props=target['items'];raw_count=len(props);rejected=[]
    for a in props:
        ident=int(a['id'][-3:]);a['yaw']=None;a['footprint']=a['evidence'].get('pdf_polygon');a['label_aliases']=[]
        if ident in BAD.get(n,[]):
            rejected.append(a['id']);invalidate(a,'视觉核对：包围框对应其他物体或包含背墙，不能作为该道具占地。');a['footprint']=None
        elif a['x'] is not None:
            a['evidence'].update(geometry_status='visually_aligned_draft',visual_method='vision');a['confidence']=.75
        a['evidence']['nominal_length_m']=nominal(a['label_text'])
        match=re.search(r'H\s*[:：]\s*(\d+(?:\.\d+)?)\s*(mm|米|m)?',a['label_text'],re.I)
        if match:a['h']=float(match[1])/(1 if match[2] in ('m','米') else 1000);a['evidence']['height_text_inline']=match[0]
        # Reject bad nominal sizes inherited from an H: height-as-length match.
        a['asset_candidates']=[c for c in a['asset_candidates'] if not(a['evidence']['nominal_length_m'] and c['basis'].get('asset_nominal_m') and abs(a['evidence']['nominal_length_m']-c['basis']['asset_nominal_m'])/a['evidence']['nominal_length_m']>.15)]
        for c in a['asset_candidates']:c['basis']['nominal_m']=a['evidence']['nominal_length_m'];c['basis']['si_priority']='si_index_label_weak_not_confirmed'
        a['asset_id']=None
    for ids in MERGES.get(n,[]):
        records=[a for a in props if int(a['id'][-3:]) in ids]
        if not records:continue
        primary=records[0]
        for alias in records[1:]:
            primary['label_aliases'].append(dict(id=alias['id'],label_text=alias['label_text'],evidence=alias['evidence']));props.remove(alias)
        primary['evidence']['merge_method']='vision_same_physical_footprint'
        if n!=293 and any('收银' in a['label_text'] for a in records):primary['function']='cashier'
        # Multilingual disagreement must not choose a nominal dimension.
        if n==293:primary['evidence']['nominal_length_m']=None;primary['asset_candidates']=[]
    fixed_rejections=[]
    for key in ['fixed','obstacles']:
        for a in inp.get(key) or []:
            fixed_rejections.append({'layer':key,'id':a['id'],'label_text':a['label_text']})
            invalidate(a,'固定物/障碍物语义或精确范围尚未独立确认，保留文字证据，坐标置空。');a['polygon']=None
    raw_boundary=copy.deepcopy(inp['boundary'])
    if n not in BOUNDARY:inp['boundary']=None
    elif inp['boundary']:
        inp['boundary'].update(kind=BOUNDARY[n],confirmed=False,visual_method='vision',confidence=.8,curve_discretization='cubic_12_segments_where_present; error_not_measured')
        inp['boundary']['points']=clockwise(inp['boundary']['points'])
    boundary_pdf=copy.deepcopy(inp['boundary']);origin=list(Polygon(boundary_pdf['points']).bounds[:2]) if boundary_pdf else None
    checks=copy.deepcopy(SCALE_EVIDENCE.get(n,[]));factor=None
    for c in checks:
        c.update(method='vision',number_unit='mm',length_pdf_points=math.dist(*c['endpoints']),source_page=source['physical_page'],coordinate_space='normalized_pdf_points')
        c['m_per_pdf_point']=c['length_m']/c['length_pdf_points']
    if checks:
        sx,sz=[c['m_per_pdf_point'] for c in checks];factor=(sx+sz)/2;err=abs(sx-sz)/factor
        if err>.02:raise ValueError('Scale cross-check rejected')
        scale=dict(status='verified',method='vision_dimension_numbers_and_vector_endpoints',checks=checks,error=err,error_definition='abs(sx-sz)/mean(sx,sz)',max_error=.02,two_axes_verified=True,m_per_pdf_point=factor,area_used_for_calibration=False)
    else:scale=dict(status='unverified',method=None,checks=None,error=None,two_axes_verified=False,m_per_pdf_point=None,reason='尚未建立两个方向尺寸数字与对应尺寸线端点的可靠关联；不得按图框、图签比例或面积换算。')
    coord=dict(unit='m' if factor else 'pdf_point',origin='boundary_bbox_top_left' if factor else 'normalized_pdf_page_top_left',axes={'x':'right','z':'down','y':'up'},boundary_bbox_origin_pdf=origin,precision_decimals=3 if factor else None,height_unit='m',required_origin_unresolved=origin is None)
    matrix=[factor,0,0,factor,-origin[0]*factor,-origin[1]*factor] if factor else None
    def point(q):return [round((q[0]-origin[0])*factor,3),round((q[1]-origin[1])*factor,3)] if factor else q
    def convert(a):
        a['evidence']['pdf_bbox']=[a['x'],a['z'],a['x']+a['w'],a['z']+a['d']] if a['x'] is not None else None
        if factor and a['x'] is not None:
            a['x'],a['z']=point([a['x'],a['z']]);a['w']=round(a['w']*factor,3);a['d']=round(a['d']*factor,3);a['center_x']=round(a['x']+a['w']/2,3);a['center_z']=round(a['z']+a['d']/2,3)
        if a.get('footprint'):a['footprint']=clockwise([point(q) for q in a['footprint']])
        if a.get('h') is not None:a['h']=round(a['h'],3)
    for a in props:convert(a)
    if inp['boundary']:inp['boundary']['points']=[point(q) for q in inp['boundary']['points']]
    inp.update(coordinates=coord,scale=scale);target.update(coordinates=coord,scale_status=scale['status'],items=props,source_label_count=raw_count,unlabelled_objects_complete=False)
    source.update(normalized_pdf_to_m_matrix=matrix,annotation_status='automatic_draft_with_vision_audit',crop_bbox=source['frame_bbox'],frames=[frame_info(n,source)],reviewer=None,reviewedAt=None,extraction_revision='geometry8.py',visual_decisions_script='package_pilot.py')
    with fitz.open(row['path']) as doc:
        page=doc[source['physical_page']-1];rm=page.rotation_matrix
        source.update(original_page_rotation=page.rotation,page_rotation=0,original_pdf_to_normalized_pdf_matrix=list(rm),pdf_to_m_matrix=list(rm*fitz.Matrix(matrix)) if matrix else None)
    source['title_block']={k:[a for a in source['title_block'] if re.search(pat,a['text'],re.I)] for k,pat in [('drawing_title',r'平面|家具|FURNITURE|LAYOUT'),('project_name',r'店|中心|广场|mall'),('date_evidence',r'20\d\d[.\-/年]'),('drawing_number',r'^(PL|P|PE)[-－]\d')]}
    source['version_date']=None;source['revision_number']=None;source['version_order_reason']='v1仅为所选试点页的临时样本编号；同来源其他候选方案/版本尚未建立关系，不能认定唯一或最早版本。'
    if n==239:
        ev=dict(method='vision',text='深圳百脑汇店',page=source['physical_page'],bbox=[1505.28,609.69,1575.54,622.16],coordinate_space='normalized_pdf_points')
        source['title_block']['visual_project_name']=ev
        review['conflicts'].append(dict(field='store_city',filename='沈阳百脑汇照材专卖店.pdf',extracted_text='深航百脑汇店',vision_text=ev,value=None,resolution=None))
    if n==293:review['conflicts'].append(dict(field='cashier_nominal_length',values_m=[.9,1.8],method='vision',reason='同一物体中文0.9米、英文1.8-Meter，不能自行裁决。',resolution=None))
    # Render only source vector footprints; never generate or repair drawing content.
    with (src/'evidence.png').open('rb') as a,(dest/'evidence.png').open('xb') as b:shutil.copyfileobj(a,b)
    im=Image.open(dest/'evidence.png').convert('RGBA');layer=Image.new('RGBA',im.size);dr=ImageDraw.Draw(layer);px=source['pdf_to_pixel_matrix'][0];w,h=source['frame_bbox'][2:]
    svg=[f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}">', '<metadata>Automatic extraction draft; normalized PDF-point coordinates; see source.json for transforms.</metadata>']
    for key,color in [('walls_columns',(0,150,240,230)),('entrances',(255,0,180,230)),('obstacles',(255,130,0,230)),('fixed',(150,60,200,230)),('props',(0,180,80,230))]:
        svg.append(f'<g id="{key}" fill="none" stroke="rgb({color[0]},{color[1]},{color[2]})" stroke-width="1">')
        if key=='walls_columns' and boundary_pdf:
            pp=boundary_pdf['points'];svg.append('<polyline points="'+' '.join(f'{x},{z}' for x,z in pp)+'"/>');dr.line([(x*px,z*px) for x,z in pp],fill=color,width=4)
        if key=='props':
            for a in props:
                b=a['evidence']['pdf_bbox']
                if b is None:continue
                x,z,x1,z1=b;svg.append(f'<rect id="{a["id"]}" x="{x}" y="{z}" width="{x1-x}" height="{z1-z}"/>');dr.rectangle([x*px,z*px,x1*px,z1*px],outline=color,width=3);dr.text((x*px,z*px),a['id'],fill=color)
        svg.append('</g>')
    svg.append('</svg>')
    with (dest/'geometry.svg').open('x',encoding='utf-8') as f:f.write('\n'.join(svg))
    with (dest/'geometry.png').open('xb') as f:layer.save(f,format='PNG')
    with (dest/'overlay.png').open('xb') as f:Image.alpha_composite(im,layer).convert('RGB').save(f,format='PNG')
    retained=[a for a in props if a['x'] is not None];bp=Polygon(inp['boundary']['points']) if inp['boundary'] else None
    overlap=[];outside=[]
    for a,b in itertools.combinations(retained,2):
        pa=box(a['x'],a['z'],a['x']+a['w'],a['z']+a['d']);pb=box(b['x'],b['z'],b['x']+b['w'],b['z']+b['d']);area=pa.intersection(pb).area
        if area>1e-6:overlap.append(dict(objects=[a['id'],b['id']],intersection_area=round(area,6),area_unit='m2' if factor else 'pdf_point2'))
    if bp:
        for a in retained:
            p=box(a['x'],a['z'],a['x']+a['w'],a['z']+a['d']);area=p.difference(bp).area
            if area>1e-6:outside.append(dict(object_id=a['id'],outside_area=round(area,6),area_unit='m2' if factor else 'pdf_point2',note='包围框测试；曲面道具可能出现矩形过界。'))
    stated=inp['stated_area']['value'];area=bp.area if bp and factor else None
    review.update(auto_status='failed' if not props else 'partial',training_ready_auto=False,scale=scale,boundary=dict(closed=bool(bp),clockwise=bool(bp),kind=BOUNDARY.get(n),area_m2=round(area,3) if area is not None else None,stated_area=stated,area_difference_ratio=abs(area-stated)/stated if area is not None and stated else None,rejected_candidate=raw_boundary if n not in BOUNDARY else None),props=dict(source_label_count=raw_count,item_count=len(props),resolved_geometry_count=len(retained),rejected_geometry_ids=rejected,out_of_bounds=outside if bp else None,overlaps=overlap,count_agreement=None),unrecognized=['入口线段及朝向','完整墙柱和固定设施','未带文字的家具/椅子','图签版本及其他候选布局的归属'],needs_human=[NOTES[n],scale.get('reason') or '标定仅验证图纸内部两方向一致性，仍需人工审核。','入口/墙柱/固定设施/道具数量尚不完整；不得用于训练。','版本未经确认，同店其他来源与候选页尚未归并。'],pilot_gate_pass=n in PASS,visual_check=dict(status='filtered_after_source_overlay_inspection',method='vision',inspected_overlay=str(src/'overlay.png'),inspected_sha256=digest(src/'overlay.png'),final_overlay_status='pending_separate_receipt',notes=NOTES[n]),fixed_obstacle_geometry_withheld=fixed_rejections)
    review['needs_human']=[x for x in review['needs_human'] if x]
    for name,data in [('source.json',source),('input.json',inp),('target-layout.json',target),('review.json',review)]:write(dest/name,data)
    receipt_data=dict(source_id=sid,source_sha256=row['sha256'],auto_status=review['auto_status'],artifacts={p.name:digest(p) for p in dest.iterdir() if p.is_file()},output=str(dest))
    write(receipt,receipt_data);append(dict(source_id=sid,stage='pilot_packaged',status='done',auto_status=review['auto_status'],output=str(dest),receipt=str(receipt),training_eligible=False));print(sid,review['auto_status'],len(retained),'/',len(props),scale['status'],flush=True)
    return review

def main():
    reviews=[]
    for row in inventory()['files']:
        if row['source_id'] in [f'PDF-{n:03}' for n in PILOT]:
            try:reviews.append(run_store(row))
            except FileExistsError:raise
            except Exception as e:append(dict(source_id=row['source_id'],stage='pilot_packaged',status='failed',error=repr(e)));raise
    audit=OUT/'03_试点提取审核.json'
    if not audit.exists():write(audit,dict(scope='20_source_pilot_only',base_revision='geometry8.py',later_experiment='geometry9.py_did_not_resolve_remaining_boundaries',gate=dict(required_rate=.8,numerator=len(PASS),denominator=sum(r['auto_status'] in ('complete','partial') for r in reviews),passed=False,definition='每店边界明确且主要道具自动候选与原图明显相符；不通过删除错误候选提高通过率。'),stores=[dict(source_id=r['source_id'],auto_status=r['auto_status'],gate_pass=r['pilot_gate_pass'],visual_check=r['visual_check']) for r in reviews],full_batch_status='not_started_gate_not_met',training_eligible=False))
if __name__=='__main__':sys.stdout.reconfigure(encoding='utf-8');main()
