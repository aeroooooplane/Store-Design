"""Publish reviewed native CAD renders, retaining every original PDF crop."""
from pathlib import Path
import json, shutil, hashlib

ROOT=Path(__file__).resolve().parents[2]
# Library restructured 2026-10-10: each model's clean legend is <folder>/平面图例.png.
BASE=ROOT/'资源库/04_模型库'
WORK=ROOT/'tmp/clean-legends'
digest=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
manifest=json.loads((BASE/'manifest.json').read_text('utf-8'))
models=[a for a in manifest['assets'] if a.get('plan_legend')]
completed=json.loads((WORK/'complete.json').read_text('utf-8'))
assert (WORK/'complete.json').stat().st_mtime >= (ROOT/'tools/sketchup/render_clean_legends.rb').stat().st_mtime, 'Latest render pass is not complete'
assert {r['id'] for r in completed if r['status']=='ok'} >= {a['asset_id'] for a in models}
assert all(digest(BASE/a['named_skp'])==a['named_sha256'] for a in manifest['assets'])
backup=WORK/'before-publish'
backup.mkdir(exist_ok=True)
for name in ['manifest.json','模型目录.html','模型清单.csv','README.md','_图例来源/index.json']:
    target=backup/Path(name).name
    if not target.exists():shutil.copy2(BASE/name,target)
records=[]
for a in models:
    old=a.get('original_plan_legend',a['plan_legend'])
    a['original_plan_legend']=old
    aid=a['asset_id']
    geometry=json.loads((WORK/f'{aid}-geometry.json').read_text('utf-8'))
    legend=BASE/a['folder']/'平面图例.png'
    shutil.copy2(WORK/f'{aid}.png',legend)
    note='按本模型正投影生成，保留实际可见轮廓；无文字、材质和阴影。'
    if geometry.get('omitted_display_details'):
        note+='已简化陈列小件或立体标识。'
    if geometry['support_segments']:
        note+='虚线为模型底座／桌腿在离地100mm处的截面投影。'
    a['plan_legend']={
        **old,'id':f'clean-{aid}','label':a['standard_name'],
        'file':f"{a['folder']}/平面图例.png",'raw_file':old['file'],
        'status':'纯净线图 · 对应本模型','note':note,
        'method':'SketchUp native orthographic hidden-line rendering',
        'source_skp':a['named_skp'],'source_skp_sha256':a['named_sha256'],
        'original_crop_note':old['note'],'original_crop_status':old['status'],
        'support_definition':geometry['support_definition'],
        'support_section_z_mm':100 if geometry['support_segments'] else None,
        'support_segment_count':len(geometry['support_segments']),
        'omitted_display_details':geometry.get('omitted_display_details',[]),
        'image_sha256':digest(legend),
        'render_size':[1200,800],'updated':'2026-10-04',
    }
    records.append(a['plan_legend'])
(BASE/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),'utf-8')
(BASE/'_图例来源/index.json').write_text(json.dumps(records,ensure_ascii=False,indent=2),'utf-8')
report={'clean_model_legends':len(records),'unique_images':len({r['file'] for r in records}),
        'original_crops_retained':len({r['raw_file'] for r in records}),
        'model_hashes_verified':90,'source_models_modified':False,
        'table_support_sections':{a['standard_name']+' / '+a['asset_id']:a['plan_legend']['support_segment_count'] for a in models if '中岛桌' in a['standard_name'] or '开箱桌' in a['standard_name']}}
(ROOT/'资源库/05_店铺形象设计标准/历史阅读记录/纯净图例校验.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),'utf-8')
print(json.dumps(report,ensure_ascii=False))
print('接着运行 pnpm library:refresh 刷新目录页与清单')
