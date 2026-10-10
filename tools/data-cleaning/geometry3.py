"""Pilot r3. Vector candidates are drafts, never automatically approved."""
import math, html
from PIL import Image, ImageDraw
from shapely.geometry import LineString, Point, Polygon, box
from shapely.ops import polygonize
import pipeline as p
from pipeline import *
from revision2 import lines
SELECT={1:15,2:10,3:7,5:1,8:16,13:6,19:7,29:18,32:8,35:9,43:11,49:6,51:1,71:7,88:16,90:1,239:1,293:16,296:15,353:6}
FUN=[('unboxing_table',r'开箱|unbox|open a box'),('cashier',r'收银|cashier'),('island_table',r'中岛桌|island table'),('accessory_cabinet',r'配件柜|配件边柜|accessories cabinet'),('side_cabinet',r'边桌|边柜'),('negotiation_table',r'洽谈|接待桌'),('seating',r'椅|凳|沙发'),('storage',r'储物柜|储物架'),('display_stand',r'试飞台|展示台|展台'),('screen',r'广告机|电子水牌|\d+寸.*屏|\d+["”]\s*TV'),('signage',r'立牌')]
def function(t):
    return next((f for f,pat in FUN if re.search(pat,t,re.I)),None)
def nominal(t):
    a=re.search(r'(\d+(?:\.\d+)?)\s*(米|mm|m)(?![a-z])',t,re.I)
    return float(a[1])/(1000 if a[2].lower()=='mm' else 1) if a else None
def segments(path):
    result=[]
    for it in path['items']:
        if it[0]=='l':pts=[tuple(it[1]),tuple(it[2])]
        elif it[0]=='re':
            r=it[1];pts=[(r.x0,r.y0),(r.x1,r.y0),(r.x1,r.y1),(r.x0,r.y1),(r.x0,r.y0)]
        elif it[0]=='qu':pts=[tuple(it[1].ul),tuple(it[1].ur),tuple(it[1].lr),tuple(it[1].ll),tuple(it[1].ul)]
        elif it[0]=='c':
            a,b,c,d=it[1:];pts=[]
            for i in range(13):
                t=i/12;pts.append(tuple((1-t)**3*a[k]+3*(1-t)**2*t*b[k]+3*(1-t)*t*t*c[k]+t**3*d[k] for k in range(2)))
        else:continue
        result.extend(zip(pts,pts[1:]))
    return result
def polygons(paths,w,h):
    seg=[]
    for i,a in enumerate(paths):
        if a['color'] is None or a.get('fill') is not None or a['rect'].x0>w*.88:continue
        for u,v in segments(a):
            u=tuple(round(k,1) for k in u);v=tuple(round(k,1) for k in v)
            if u!=v:seg.append(LineString([u,v]))
    return [a for a in polygonize(seg) if a.is_valid and a.area>20 and a.area<w*h*.65]
def rental(paths,ls):
    if not any('租赁线' in s['text'] for s in ls):return None
    red=[a for a in paths if a['color'] and a['color'][0]>.9 and max(a['color'][1:])<.1]
    seg=[(u,v) for a in red for u,v in segments(a)]
    if not seg:return None
    # Follow source dash order; only bridge sub-3 point gaps of this explicit lease line.
    chains=[];current=[]
    for a,b in seg:
        if current and math.dist(current[-1],a)>3:
            chains.append(current);current=[]
        current.extend([a,b])
    if current:chains.append(current)
    for c in sorted(chains,key=len,reverse=True):
        if len(c)>8 and math.dist(c[0],c[-1])<3:
            poly=Polygon(c).simplify(.2,preserve_topology=True)
            if poly.is_valid and poly.area>1000:return poly
    return None
def candidates(t,assets,si):
    fun=function(t);n=nominal(t);result=[]
    for a in assets:
        if a['material_category']!='软装物料':continue
        name=a['standard_name'];af=function(name)
        if fun!=af or fun is None:continue
        an=nominal(name+' '+a.get('variant',''))
        if n and an and abs(n-an)/n>.15:continue
        # Chairs and generic negotiation tables have no exact catalog correspondence.
        if fun=='seating' and not any(k in t and k in name for k in ['字母凳','培训坐凳','沙发']):continue
        if fun=='negotiation_table':continue
        score=.55+(.2 if n and an else 0)+(.15 if a.get('material_si')==si else 0)
        if '亮脚' in t and '亮脚' in name:score+=.08
        result.append(dict(asset_id=a['asset_id'],score=round(score,2),basis=dict(function=fun,nominal_m=n,asset_nominal_m=an,si_priority='si_index_label' if si else None),web_available=a['asset_id'] in WEB))
    return sorted(result,key=lambda a:-a['score'])[:3]
ASSETS=read(ROOT/'资源库/04_模型库/manifest.json')['assets']
WEB={a['id'] for a in read(ROOT/'demo/src/data/placement-manifest.json')['assets']}
def runone(row,num):
    sid=row['source_id'];dest=CACHE/'pilot-r3'/sid
    if (dest/'review.json').exists():return
    dest.mkdir(parents=True,exist_ok=True)
    raw=read(CACHE/'classified-r2'/f'{sid}.json');pdata=raw['pages'][num-1];ls=pdata['joined_text'];idx=row['index_matches'][0]
    with fitz.open(row['path']) as doc:
        page=doc[num-1];w,h=page.rect.width,page.rect.height;paths=page.get_drawings();polys=polygons(paths,w,h)
        write(dest/'vector-candidates.json',dict(source_id=sid,page=num,polygons=[dict(points=list(a.exterior.coords),area=a.area) for a in polys]))
        props=[];fixed=[];obstacles=[]
        for s in ls:
            t=s['text'];f=function(t)
            isfixed=bool(re.search('灯箱|墙面.*画|LOGO|lightbox',t,re.I)) and not f
            isobstacle=bool(re.search('柱子|结构柱|管井|配电箱|强弱电箱|消防栓|楼梯',t))
            if not (f or isfixed or isobstacle) or len(t)>85:continue
            if s['bbox'][0]>.87*w:continue
            b=s['bbox'];cx=(b[0]+b[2])/2;cy=(b[1]+b[3])/2
            potentials=[]
            for poly in polys:
                x,y,x1,y1=poly.bounds;pw=x1-x;ph=y1-y
                if pw<3 or ph<3 or pw>w*.28 or ph>h*.35 or poly.area<80:continue
                dist=poly.distance(Point(cx,cy))
                if dist>max(25,s['size']*5):continue
                # Rectangular objects are only candidate footprints; label proximity is not proof.
                if poly.area/(pw*ph)<.7:continue
                penalty=dist+(0 if x<=cx<=x1 else 15)+(0 if y>=b[1] or poly.contains(Point(cx,cy)) else 10)
                potentials.append((penalty,poly))
            potentials.sort(key=lambda a:a[0]);poly=potentials[0][1] if potentials else None
            # Multiple close candidates or unlabelled shapes must be reviewed.
            bounds=list(poly.bounds) if poly else None
            near=[a for a in ls if re.search(r'H\s*[:：]\s*\d+',a['text'],re.I) and abs((a['bbox'][0]+a['bbox'][2])/2-cx)<max(8,(b[2]-b[0])*.7) and 0<=a['bbox'][1]-b[1]<s['size']*3]
            hm=re.search(r'H\s*[:：]\s*(\d+(?:\.\d+)?)\s*(mm|米|m)?',near[0]['text'],re.I) if near else None
            rec=dict(id=f'object-{len(props)+len(fixed)+len(obstacles)+1:03}',label_text=t,function=f or 'other',x=bounds[0] if bounds else None,z=bounds[1] if bounds else None,w=bounds[2]-bounds[0] if bounds else None,d=bounds[3]-bounds[1] if bounds else None,h=float(hm[1])/(1 if hm[2] in ['m','米'] else 1000) if hm else None,height_unit='m',rotation=None,center_x=(bounds[0]+bounds[2])/2 if bounds else None,center_z=(bounds[1]+bounds[3])/2 if bounds else None,asset_id=None,asset_candidates=candidates(t,ASSETS,idx.get('si')) if f else [],confidence=.45 if poly else .2,evidence=dict(method='vector_text_proximity',text_bbox=b,nominal_length_m=nominal(t),height_text=near[0] if near else None,pdf_polygon=list(poly.exterior.coords) if poly else None,geometry_status='candidate_unverified'),movable=bool(f))
            (props if f else obstacles if isobstacle else fixed).append(rec)
        boundary=rental(paths,ls);bmethod='explicit_red_lease_line' if boundary else None
        if boundary is None and props:
            centers=[Point(a['x']+a['w']/2,a['z']+a['d']/2) for a in props if a['x'] is not None]
            bounds=[a for a in polys if a.area>w*h*.025 and a.bounds[2]<w*.9 and a.bounds[1]>.05*h and a.bounds[3]<h*.92 and centers and sum(a.covers(c) for c in centers)/len(centers)>.7]
            if bounds:boundary=min(bounds,key=lambda a:a.area);bmethod='enclosing_vector_polygon_candidate'
        issues=['未完成两方向尺寸标定；保留 PDF 点坐标。','道具框为文字邻近矢量候选，尚需视觉确认；未标文字的家具可能遗漏。','入口未建立可靠线段；不能把主通道文字当成入口尺寸。','版本、完整边界、障碍物和固定设施尚需审核。']
        if boundary is None:issues.append('无法从独立闭合矢量或明确租赁线可靠恢复边界。')
        scale=dict(status='unverified',method=None,x_check=None,z_check=None,error=None,unit='pdf_point',pdf_to_m_matrix=None)
        evidence=dest/'evidence.png';factor=2500/max(w,h);pix=page.get_pixmap(matrix=fitz.Matrix(factor,factor),alpha=False)
        with evidence.open('xb') as f:f.write(pix.tobytes('png'))
        origin=list(boundary.bounds[:2]) if boundary else None
        coord=dict(unit='pdf_point',origin='pdf_page_top_left',required_boundary_origin_pdf=origin,axes={'x':'right','z':'down','y':'up'},note='比例和边界未经确认；未转换为网页米制坐标。')
        info={}
        for name,pat in [('stated_area',r'(?:实测面积|实测面积|SITE|AREA|面积)\s*[:：]?\s*(\d+(?:\.\d+)?)\s*(?:m|㎡|平)'),('room_height',r'(?:店铺天花高度|店铺现有吊顶高度)\s*[:：]?\s*(\d+(?:\.\d+)?)\s*(mm|m|米)')]:
            values=[]
            for a in ls:
                m=re.search(pat,a['text'],re.I)
                if m:values.append(dict(value=float(m[1])/(1000 if name=='room_height' and m[2]=='mm' else 1),text=a['text'],bbox=a['bbox']))
            info[name]=dict(value=values[0]['value'] if len({a['value'] for a in values})==1 else None,evidence=values)
        titles=[s for s in ls if s['bbox'][0]>.82*w and len(s['text'])<80]
        conflicts=[]
        if sid=='PDF-239':conflicts.append(dict(field='store_name',filename=idx['name'],title_evidence=[a for a in ls if '深圳' in a['text'] or '沈阳' in a['text']],resolution=None))
        areaev=[]
        for q in raw['pages']:
            for a in q.get('joined_text',[]):
                if re.search('实测面积',a['text']):areaev.append(dict(page=q['page'],text=a['text'],bbox=a['bbox']))
        if len(set(a['text'] for a in areaev))>1:conflicts.append(dict(field='stated_area_candidates',evidence=areaev,resolution=None))
        common=dict(source_id=sid,store_id=f"store-{int(sid[4:]):04}",version_id='v1',version_confirmed=False,training_eligible=False,draft=True)
        write(dest/'source.json',{**common,'source_pdf':row['path'],'sha256':row['sha256'],'physical_page':num,'frame_bbox':list(page.rect),'page_rotation':page.rotation,'render_dpi':factor*72,'pdf_to_pixel_matrix':[factor,0,0,factor,0,0],'pdf_to_m_matrix':None,'title_block':titles,'reviewer':None,'reviewedAt':None,'version_order_reason':'试点临时分组，尚未证实来源内各方案和日期的版本关系。'})
        write(dest/'input.json',{**common,'coordinates':coord,'scale':scale,'boundary':{'points':list(boundary.exterior.coords),'kind':'lease_line' if bmethod=='explicit_red_lease_line' else None,'method':bmethod,'confidence':.85 if bmethod=='explicit_red_lease_line' else .35,'confirmed':False} if boundary else None,'entrances':None,'obstacles':obstacles or None,'fixed':fixed or None,**info,'shop_type':{'value':idx.get('shop_type'),'source':'门店资源索引.json'},'si_index_label':idx.get('si'),'si_evidence':None,'requirements':None,'rules_source':None})
        write(dest/'target-layout.json',{**common,'coordinates':coord,'items':props,'unlabelled_objects_complete':False})
        svg=[f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}">']
        im=Image.open(evidence).convert('RGBA');layer=Image.new('RGBA',im.size);dr=ImageDraw.Draw(layer)
        for name,items,color in [('walls_columns',[],(0,150,240,230)),('entrances',[],(255,0,180,230)),('obstacles',obstacles,(255,130,0,230)),('fixed',fixed,(150,60,200,230)),('props',props,(0,180,80,230))]:
            svg.append(f'<g id="{name}" fill="none" stroke="rgb{color[:3]}" stroke-width="1">')
            if name=='walls_columns' and boundary:
                points=list(boundary.exterior.coords);svg.append('<polyline points="'+' '.join(f'{x},{y}' for x,y in points)+'"/>');dr.line([(x*factor,y*factor) for x,y in points],fill=color,width=4)
            for a in items:
                if a['x'] is None:continue
                x,z,pw,pd=a['x'],a['z'],a['w'],a['d'];svg.append(f'<rect x="{x}" y="{z}" width="{pw}" height="{pd}"/>');dr.rectangle([x*factor,z*factor,(x+pw)*factor,(z+pd)*factor],outline=color,width=3);dr.text((x*factor,z*factor),a['id'],fill=color)
            svg.append('</g>')
        svg.append('</svg>')
        with (dest/'geometry.svg').open('x',encoding='utf-8') as f:f.write('\n'.join(svg))
        with (dest/'geometry.png').open('xb') as f:layer.save(f,format='PNG')
        with (dest/'overlay.png').open('xb') as f:Image.alpha_composite(im,layer).convert('RGB').save(f,format='PNG')
        write(dest/'review.json',{**common,'auto_status':'partial','training_ready_auto':False,'scale':scale,'boundary':dict(closed=boundary is not None,area_pdf_points=boundary.area if boundary else None,area_m2=None,stated_area_difference=None,method=bmethod),'props':dict(label_count=len(props),geometry_candidate_count=sum(a['x'] is not None for a in props),out_of_bounds=None,overlaps=None,count_agreement=None),'unrecognized':['未命名家具','入口线段','墙柱与固定设施完整性','图签日期及修订数字可能转曲'],'conflicts':conflicts,'visual_check':{'status':'pending','method':None},'needs_human':issues})
        append(dict(source_id=sid,stage='pilot_r3_geometry',status='draft_generated',auto_status='partial',output=str(dest),training_eligible=False));print(sid,'polys',len(polys),'props',len(props),'boxes',sum(a['x'] is not None for a in props),'boundary',bmethod,flush=True)
def main():
    for row in inventory()['files']:
        n=int(row['source_id'][4:]) if row['source_id'].startswith('PDF-') else -1
        if n in SELECT:
            try:runone(row,SELECT[n])
            except Exception as e:
                append(dict(source_id=row['source_id'],stage='pilot_r3_geometry',status='failed',error=repr(e),traceback=traceback.format_exc()));print(row['source_id'],traceback.format_exc(),flush=True)
if __name__=='__main__':sys.stdout.reconfigure(encoding='utf-8');main()
