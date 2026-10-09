"""Read-only checks plus append-only visual observations, captured after inspection."""
from package_pilot import *
from decimal import Decimal
OBS={1:(78.9,3.77,None),2:(57.8,2.9,None),3:(44.4,None,'2025.10.24'),5:(55.9,None,'2025.10.16'),8:(None,None,'2026.03'),13:(16.2,None,'2025.09'),19:(30.8,None,'2025.10.10'),29:(None,None,None),32:(30.0,None,'2025.08.05'),35:(25.0,3.3,'2025.11'),43:(None,None,None),49:(26.4,2.75,None),51:(16.0,None,'2025-07'),71:(38.0,3.34,'2025.09'),88:(None,None,None),90:(20.1,None,'2024.8.5'),239:(19.1,None,'2024.6.18'),293:(None,None,None),296:(None,None,None),353:(None,None,'2025-4-23')}
def main():
    out=OUT/'08_成果核验.json'
    if out.exists():print('audit exists; not overwritten');return
    errors=[];checks=[];supplements=[]
    for n in PILOT:
        d=ANNOTATIONS/f'store-{n:04}'/'v1';source=read(d/'source.json');inp=read(d/'input.json');lay=read(d/'target-layout.json');rev=read(d/'review.json');visual=read(d/'review-supplement.json')
        area,height,date=OBS[n];record=dict(source_id=f'PDF-{n:03}',store_id=source['store_id'],version_id='v1',training_eligible=False,method='vision',evidence_file='evidence.png',evidence_sha256=digest(d/'evidence.png'),source_page=source['physical_page'],stated_area_m2=area,room_height_m=height,title_date_raw=date,version_confirmed=False,date_order_confirmed=False,region_note='面积/高度位于左下红黑文字区或右侧AREA图签；日期位于右侧DATE图签。',source_city=None)
        if n==239:record.update(title_name_raw='深航百脑汇店',name_conflict=dict(filename='沈阳百脑汇照材专卖店.pdf',user_background='图签深圳',extracted_text='深航百脑汇店',high_resolution_vision='深航百脑汇店',city=None),evidence_title_crop=str(CACHE/'PDF-239-title-crop.png'))
        if n==353:record['prop_dimension_observations']=[dict(object_id=a['id'],text='1800*1000*900mm',nominal_w_m=1.8,nominal_d_m=1.0,h_m=.9,method='vision',text_bbox=a['evidence']['text_bbox'],note='图上三元组按长×宽×高读取；未用它单独换算平面坐标。') for a in lay['items'] if a['function']=='island_table']
        am=rev['boundary']['area_m2'];record['boundary_area_check']=dict(area_m2=am,stated_area_m2=area,difference_ratio=abs(am-area)/area if am is not None and area else None,used_for_scale=False)
        write(d/'vision-observations.json',record);supplements.append(record)
        for obj in [source,inp,lay,rev,visual]:
            if not all(k in obj for k in ['schemaVersion','generatedAt','generator']):errors.append(f'{n}: metadata missing')
            if obj.get('training_eligible') is not False:errors.append(f'{n}: training eligibility not false')
            if obj.get('approved') is True:errors.append(f'{n}: approved true')
        if visual['overlay_sha256']!=digest(d/'overlay.png'):errors.append(f'{n}: overlay changed after visual check')
        if Image.open(d/'evidence.png').size!=Image.open(d/'geometry.png').size or Image.open(d/'evidence.png').size!=Image.open(d/'overlay.png').size:errors.append(f'{n}: raster dimensions disagree')
        if inp['scale']['status']=='verified':
            if not inp['scale']['two_axes_verified'] or inp['scale']['error']>.02:errors.append(f'{n}: invalid scale')
            if inp['coordinates']['unit']!='m':errors.append(f'{n}: unit mismatch')
        elif inp['coordinates']['unit']!='pdf_point':errors.append(f'{n}: unverified coordinates converted')
        if inp['boundary']:
            pts=inp['boundary']['points'];poly=Polygon(pts)
            if pts[0]!=pts[-1] or not poly.is_valid:errors.append(f'{n}: invalid boundary')
            if pts!=clockwise(pts):errors.append(f'{n}: orientation wrong')
        for a in lay['items']:
            if len(a['asset_candidates'])>3:errors.append(f'{n}: too many asset candidates')
            if a['rotation'] not in [None,0,90,180,270]:errors.append(f'{n}: rotation invalid')
            if a['asset_id'] is not None:errors.append(f'{n}: unconfirmed asset assigned')
            if a['x'] is not None and (a['w']<=0 or a['d']<=0):errors.append(f'{n}: nonpositive bounds')
        checks.append(dict(source_id=source['source_id'],source_sha256=source['sha256'],auto_status=rev['auto_status'],unit=inp['coordinates']['unit'],scale=inp['scale']['status'],final_overlay_inspected=True,visual_receipt='review-supplement.json',observation_supplement='vision-observations.json'))
    rows=[json.loads(l) for l in (OUT/'01_页面分类.jsonl').read_text(encoding='utf-8').splitlines()]
    if len({(r['source_id'],r['page']) for r in rows})!=len(rows):errors.append('Duplicate page records')
    expected={r['source_id']:r['page_count'] for r in inventory()['files'] if r['source_id'] in [f'PDF-{n:03}' for n in PILOT]}
    for sid,count in expected.items():
        if {r['page'] for r in rows if r['source_id']==sid}!=set(range(1,count+1)):errors.append(sid+': incomplete pilot page scan')
    integrity=read(OUT/'07_源文件完整性复核.json')
    if integrity['changed_count']!=0:errors.append('Original source files changed')
    write(OUT/'08_视觉补充汇总.json',dict(items=supplements,application_order=['base source/input/target/review JSON','review-supplement.json corrections','vision-observations.json non-null observed fields'],note='补充由实际已打开的20张叠加图及PDF-239图签放大证据读取；与原值冲突时同时保留，不自行裁决。'))
    write(out,dict(status='pass_for_pilot_artifact_integrity_only' if not errors else 'failed',errors=errors,checks=checks,checked_stores=len(checks),checked_page_rows=len(rows),original_file_hashes_checked=integrity['checked_count'],original_files_changed=integrity['changed_count'],full_task_complete=False,pilot_quality_gate_passed=False,training_candidates=0,note='此核验只验证文件/坐标/来源约束，不等于提取完整或达到80%门槛。'))
    print(json.dumps({'errors':errors,'stores':len(checks),'pages':len(rows)},ensure_ascii=False))
    if errors:raise SystemExit(1)
if __name__=='__main__':sys.stdout.reconfigure(encoding='utf-8');main()
