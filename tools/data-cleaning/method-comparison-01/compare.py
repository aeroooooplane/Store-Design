"""Frozen, vision-assisted method experiment. Creates new files only."""
import argparse
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[3]
RUN = ROOT / '资源库/90_处理过程与审核/数据清洗-20261009'
ANN = ROOT / '资源库/90_处理过程与审核/训练标注'
META = dict(schemaVersion=1, generatedAt=datetime.now(timezone.utc).isoformat(),
            generator=dict(script='method-comparison-01/compare.py', version='1.0.0'))

# Visual selection windows on displayed evidence; never used as measured geometry.
# Each row: observed label (null for unlabelled objects), function, ROI, height m.
CASES = {
 43: dict(canvas=[1888,1334], boundary=[482,360,1196,974], items=[
 ['1.8米边桌收银台','cashier',[674,561,831,612],.9],
 ['2.4米场景配件柜','accessory_cabinet',[896,385,935,594],2.4],
 ['1.8米开箱桌','unboxing_table',[1022,457,1088,612],.9],
 ['1.8米中岛桌','island_table',[591,719,661,874],.9],
 ['1.8米中岛桌','island_table',[805,719,875,874],.9],
 ['1.8米中岛桌','island_table',[1017,719,1088,874],.9],
 ['75寸广告机(横向)','screen',[743,360,915,378],None],
 ['75寸广告机(竖向)','screen',[843,594,935,613],None]],
 note='仅比较8件主要有名道具；电子水牌、开箱桌旁座椅、橱窗展示、固定设施另待完整标注。'),
 51: dict(canvas=[1888,1334],boundary=[278,465,1478,894],items=[
 ['1.55米配件柜','accessory_cabinet',[278,502,556,590],1.3],
 ['1.55米配件柜','accessory_cabinet',[1200,502,1478,590],1.3],
 ['边桌收银','cashier',[556,502,878,590],.9],
 ['开箱桌','unboxing_table',[878,502,1200,590],.9],
 ['1.8米中岛','island_table',[294,716,615,894],.9],
 ['1.8米中岛','island_table',[830,716,1151,894],.9],
 ['电子水牌','signage',[1365,818,1463,880],None]],
 note='比较7件主要道具；背墙LED屏及固定设施未纳入。原试点的双轴比例证据保留在原标注，本实验不重复作尺度认证。'),
 239: dict(canvas=[1888,1335],boundary=[361,374,1305,898],items=[
 ['H1300mm储物柜','storage',[376,389,630,494],1.3],
 ['边桌(收银、开箱)+储物柜','cashier',[668,389,955,469],None],
 ['边桌储物柜','storage',[955,389,1242,469],None],
 ['电子水牌','signage',[1249,389,1304,476],None],
 ['75寸广告机','screen',[606,502,631,766],None],
 ['配件柜','accessory_cabinet',[408,699,606,773],None],
 ['1.8米中岛桌','island_table',[788,611,947,898],None],
 ['1.8米中岛桌','island_table',[1114,611,1273,898],None]],
 note='比较8件主要道具；柱三面灯箱不是家具，柱净尺寸未知；店名冲突沿用原review-supplement，不在本实验裁决。'),
 293: dict(canvas=[1888,1334],boundary=[482,417,1195,872],items=[
 ['1.8米中岛桌','island_table',[743,590,863,859],.9],
 ['1.8米中岛桌','island_table',[1000,590,1118,859],.9],
 ['0.9米收银边柜 / 1.8-Meter Cashier Counter','cashier',[531,725,605,859],.9],
 ['定制配件柜','accessory_cabinet',[486,593,552,728],1.05],
 ['定制配件柜','accessory_cabinet',[529,489,697,620],1.05],
 ['定制配件柜','accessory_cabinet',[681,420,807,526],1.05],
 ['43寸显示屏','screen',None,None]],
 note='7件主要道具中显示屏未可靠定位；现金柜中英文长度冲突，名义长度不得采用。弧形柜框不代表矩形家具。'),
 353: dict(canvas=[1888,1334],boundary=None,items=[
 ['配件柜','accessory_cabinet',[1097,412,1324,471],None],
 ['80寸显示屏','screen',[730,443,1039,471],None],
 ['中岛1800*1000*900mm','island_table',[671,665,926,807],.9],
 ['中岛1800*1000*900mm','island_table',[1084,665,1339,807],.9],
 [None,'negotiation_table',[437,689,531,780],None],
 [None,'seating',[390,640,471,715],None],
 [None,'seating',[499,640,582,715],None],
 [None,'seating',[390,746,475,823],None],
 [None,'seating',[499,746,582,823],None]],
 note='比较9件可见物体；无文字的圆桌、四椅依据图形语义记录，标签为null。开放专区租赁边界未确认，不强行选框。')
}

def read(p):
    return json.loads(p.read_text(encoding='utf-8'))

def write(p, d):
    with p.open('x',encoding='utf-8') as f:
        json.dump({**META,**d},f,ensure_ascii=False,indent=2)

def digest(p):
    return hashlib.sha256(p.read_bytes()).hexdigest()

def bbox(points):
    if not points: return None
    return [min(p[0] for p in points),min(p[1] for p in points),
            max(p[0] for p in points),max(p[1] for p in points)]

def iou(a,b):
    if not a or not b: return 0.
    inter=max(0,min(a[2],b[2])-max(a[0],b[0]))*max(0,min(a[3],b[3])-max(a[1],b[1]))
    union=(a[2]-a[0])*(a[3]-a[1])+(b[2]-b[0])*(b[3]-b[1])-inter
    return inter/union if union else 0.

def convert(r,canvas,frame):
    return None if r is None else [r[j]*(frame[2 if j%2==0 else 3]/canvas[j%2]) for j in range(4)]

def select(roi,polys,used):
    if roi is None: return None,0.,None
    ranked=sorted(((iou(roi,bbox(p['points'])),i) for i,p in enumerate(polys) if i not in used),reverse=True)
    score,idx=ranked[0] if ranked else (0.,None)
    if score<.65: return None,score,idx
    used.add(idx)
    return polys[idx]['points'],score,idx

def render(evidence,frame,objects,boundary,path,color):
    im=Image.open(evidence).convert('RGB'); draw=ImageDraw.Draw(im)
    sx,sy=im.width/frame[2],im.height/frame[3]
    def pts(ps): return [(x*sx,y*sy) for x,y in ps]
    if boundary: draw.line(pts(boundary), fill='#00aabb',width=5)
    for item in objects:
        p=item.get('polygon')
        if not p: continue
        b=bbox(p); draw.line(pts(p+[p[0]]),fill=color,width=4)
        xy=(int(b[0]*sx),int(b[1]*sy));draw.rectangle([xy,(xy[0]+30,xy[1]+17)],fill='white')
        draw.text(xy,str(item['id']),fill=color)
    with path.open('xb') as f: im.save(f,format='PNG')

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--run-name',default='方法对比-01');args=ap.parse_args()
    if Path(args.run_name).name!=args.run_name: raise ValueError('run-name必须为一个目录名')
    out=RUN/args.run_name;cache=RUN/'_cache'/args.run_name
    if out.exists() or cache.exists(): raise FileExistsError('同名输出已存在；请指定新的 --run-name，不覆盖')
    out.mkdir();cache.mkdir()
    write(out/'vision-selections.json',dict(method='vision',cases=CASES,
          note='由本轮原图视觉阅读给出的选择窗口，不是独立人工真值，也不是米制测量。'))
    results=[]
    for n,case in CASES.items():
        sid=f'PDF-{n:03d}';base=RUN/'_cache/pilot-r8'/sid;ann=ANN/f'store-{n:04d}/v1'
        dest=out/sid;dest.mkdir();source=read(ann/'source.json');frame=source['frame_bbox']
        pc=base/'vector-candidates.json';polys=read(pc)['polygons'];old=read(base/'target-layout.json')
        oldin=read(base/'input.json');objects=[];used=set()
        for j,(label,func,roi,h) in enumerate(case['items'],1):
            r=convert(roi,case['canvas'],frame);p,score,idx=select(r,polys,used)
            objects.append(dict(id=j,label_text=label,function=func,h=h,height_unit='m',rotation=None,
                asset_candidates=[],polygon=p,bbox_pdf=bbox(p),selection_roi_pdf=r,
                candidate_index=idx if p else None,best_candidate_index=idx,selection_iou=score,
                evidence=dict(method='vision_then_vector_selection',vision_roi_canvas=roi),
                geometry_status='candidate_needs_visual_audit' if p else 'unresolved'))
        br=convert(case['boundary'],case['canvas'],frame);boundary,bs,bi=select(br,polys,set())
        olds=[dict(id=i+1,polygon=o.get('evidence',{}).get('pdf_polygon'),function=o['function']) for i,o in enumerate(old['items'])]
        # One-to-one spatial recovery, independent of name/category. Not precision or dimensional accuracy.
        candidates=sorted([(iou(o['selection_roi_pdf'],bbox(a['polygon'])),i,j) for i,o in enumerate(objects) for j,a in enumerate(olds)],reverse=True)
        seen_ref=set();seen_pred=set();matched=[]
        for s,i,j in candidates:
            if s>=.65 and i not in seen_ref and j not in seen_pred:
                seen_ref.add(i);seen_pred.add(j);matched.append(dict(reference_id=i+1,baseline_id=j+1,iou=s))
        aimg=cache/f'{sid}-A.png';bimg=cache/f'{sid}-B.png'
        ob=oldin.get('boundary');ob=ob.get('points') if isinstance(ob,dict) else None
        render(ann/'evidence.png',frame,olds,ob,aimg,'#dc2626')
        render(ann/'evidence.png',frame,objects,boundary,bimg,'#138a36')
        result=dict(source_id=sid,physical_page=source['physical_page'],draft=True,training_eligible=False,
          version_confirmed=False,auto_status='partial',coordinates=dict(unit='pdf_point',origin='page_top_left'),
          scope_note=case['note'],reference_objects=len(objects),reference_localizable=sum(o['selection_roi_pdf'] is not None for o in objects),
          baseline_geometry_records=sum(bool(o['polygon']) for o in olds),baseline_spatial_matches=len(matched),
          assisted_vector_matches=sum(bool(o['polygon']) for o in objects),baseline_matches=matched,
          boundary_candidate=dict(points=boundary,selection_iou=bs,candidate_index=bi,kind=None),
          items=objects,scale=dict(status='not_reassessed',metric_conversion=None),
          source_evidence=dict(source_json=str(ann/'source.json'),evidence_png=str(ann/'evidence.png'),
              source_sha256=source['sha256'],candidate_cache=str(pc),candidate_sha256=digest(pc),
              baseline_sha256=digest(base/'target-layout.json')),
          overlays=dict(A=str(aimg),B=str(bimg)),
          limitations=['五张为有目的问题样本，不代表全部418家。','选择窗口参与方法B，空间匹配分数不是独立测试准确率。',
              '未执行完整门店标注、版本分组、尺度重认证或资产匹配。','边界及物体轮廓仍需逐一视觉审查。'])
        write(dest/'comparison.json',result)
        results.append({k:result[k] for k in ('source_id','reference_objects','reference_localizable','baseline_geometry_records','baseline_spatial_matches','assisted_vector_matches','overlays')})
        with (out/'progress.jsonl').open('a',encoding='utf-8') as f:
            f.write(json.dumps({**META,'source_id':sid,'stage':'extracted_pending_visual_audit'},ensure_ascii=False)+'\n')
    write(out/'summary.json',dict(cases=results,training_eligible=False,status='pending_visual_audit'))
    print(json.dumps(results,ensure_ascii=False,indent=2))

if __name__=='__main__': main()
