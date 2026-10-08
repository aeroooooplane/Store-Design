from pathlib import Path
import hashlib, json, datetime, zipfile
BASE=Path(__file__).resolve().parents[1]
ROOT=BASE/'素材库/04_assets/incoming/split-20260925-v2'
manifest_path=ROOT/'manifest.json'
m=json.loads(manifest_path.read_text('utf8'))
assert m['status']=='export_complete', 'Batch still running'
assert m['completed']==len(m['assets'])
source_checks=json.loads((ROOT/'source-mesh-bounds.json').read_text('utf8'))
assert source_checks['status']=='complete'
source={r['asset_id']:r for r in source_checks['results']}
native_checks=json.loads((ROOT/'native-verification.json').read_text('utf8'))
assert native_checks['status']=='complete'
native={r['asset_id']:r for r in native_checks['results']}
def gram(transform):
    columns=[transform[i:i+3] for i in [0,4,8]]
    return [sum(x*y for x,y in zip(a,b)) for a in columns for b in columns]
max_gram_error=0.0
for a in m['assets']:
    expected=gram(a['instances'][0]['transform'])
    for instance in a['instances']:
        max_gram_error=max(max_gram_error,max(abs(x-y) for x,y in zip(gram(instance['transform']),expected)))
assert max_gram_error<=1e-6, 'Different scales or shears merged'
plan=json.loads((BASE/'tools/sketchup/exports/split-plan.json').read_text('utf8'))
expected_pids={r['pid'] for r in plan if r['decision']=='export'}
actual_pids=[i['pid'] for a in m['assets'] for i in a['instances']]
assert set(actual_pids)==expected_pids and len(actual_pids)==len(expected_pids), 'Missing or duplicate source instances'
(ROOT/'dedup-validation.json').write_text(json.dumps({'status':'passed','asset_count':len(m['assets']),'instance_count':len(actual_pids),'max_gram_matrix_error':max_gram_error,'source_plan_coverage':'All selected source instances represented exactly once.'},indent=2),encoding='utf8')
results=[]
for a in m['assets']:
    assert a.get('folder'), f"No export: {a['asset_id']}"
    # Windows path comparison is case insensitive; retain portable relative paths.
    a['folder']=str(Path(a['folder']).relative_to(ROOT)).replace('\\','/')
    vp=ROOT/a['asset_id']/'validation.json'
    v=json.loads(vp.read_text('utf8'))
    s=source[a['asset_id']]
    delta=max(abs(x-y) for x,y in zip(v['dae_bounds_m'],s['tight_visible_face_bounds_m']))*1000
    v['source_tight_face_bounds_m']=s['tight_visible_face_bounds_m']
    v['source_mesh_dimension_error_mm']=delta
    v['source_face_counts']=s['counts']
    v['native_sketchup_read_check']=native[a['asset_id']]
    with zipfile.ZipFile(ROOT/a['folder']/'prop.skp') as archive:
        v['native_skp_bad_archive_member']=archive.testzip()
        v['native_skp_archive_entries']=len(archive.infolist())
    instance_path=ROOT/a['folder']/'prop-instance.skp'
    with zipfile.ZipFile(instance_path) as archive:
        v['instance_skp_bad_archive_member']=archive.testzip()
        v['instance_skp_archive_entries']=len(archive.infolist())
    v['instance_skp_bytes']=instance_path.stat().st_size
    v['dimension_comparison_note']='SketchUp entity.bounds can overestimate rotated or nested geometry. Final dimension check uses visible source face vertices through all instance transformations.'
    ok=delta<=1 and v['geometry_instances']>0 and v['skp_bytes']>100 and v['native_skp_bad_archive_member'] is None and v['instance_skp_bad_archive_member'] is None and native[a['asset_id']]['status']=='passed' and not v['missing_textures'] and not v['corrupt_textures']
    v['status']='passed' if ok else 'review_required'
    vp.write_text(json.dumps(v,ensure_ascii=False,indent=2),encoding='utf8')
    a['status']=v['status']
    a['recommended_skp']=a['folder']+'/prop-instance.skp'
    a['instance_skp_note']='Preserves root instance rotation, scale, handedness and material; root translation removed. Nested hierarchy retained. Definition-only original is prop.skp.'
    if native[a['asset_id']].get('precision_wrapper'):
        a['instance_skp_note']+=' An additional transform wrapper preserves near-identity scale that SketchUp otherwise rounds away during save.'
    results.append({'asset_id':a['asset_id'],**v})
summary={'checked':len(results),'passed':sum(v['status']=='passed' for v in results),'review_required':[v for v in results if v['status']!='passed'],'results':results,'scope':'XML解析、DAE实际网格与源模型可见面顶点尺寸比较（1mm容差）、全部贴图引用存在、图片头及容器完整性检查；不等于逐面材质或透明贴图视觉验收'}
(ROOT/'validation-summary.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2),encoding='utf8')
diagnostic_path=ROOT/'visibility-diagnostics.json'
if diagnostic_path.exists():
    diagnostic=json.loads(diagnostic_path.read_text('utf8'))
    diagnostic['resolution']='Visibility was not responsible. Initial DAE bounds included unused position-array entries; validation version 2 uses only vertices referenced by face primitives. See final validation-summary.json.'
    diagnostic_path.write_text(json.dumps(diagnostic,ensure_ascii=False,indent=2),encoding='utf8')
manifest_path.write_text(json.dumps(m,ensure_ascii=False,indent=2),encoding='utf8')
precision_path=ROOT/'asset-37758059/precision-fix.json'
if precision_path.exists() and native.get('asset-37758059',{}).get('status')=='passed':
    precision=json.loads(precision_path.read_text('utf8'));precision['status']='reopened_and_verified'
    precision_path.write_text(json.dumps(precision,ensure_ascii=False,indent=2),encoding='utf8')
src=BASE/'道具模型/影石通用模型.skp'
with src.open('rb') as f: actual=hashlib.file_digest(f,'sha256').hexdigest()
expected=m['source_sha256_before_batch'].lower()
integrity={'source':str(src),'bytes':src.stat().st_size,'sha256_before':expected,'sha256_after':actual,'unchanged':actual==expected,'checked_at':datetime.datetime.now().astimezone().isoformat()}
(ROOT/'source-integrity.json').write_text(json.dumps(integrity,ensure_ascii=False,indent=2),encoding='utf8')
assert integrity['unchanged'], 'Source file hash changed'
print(json.dumps({'checked':len(results),'passed':summary['passed'],'reviews':[v['asset_id'] for v in summary['review_required']],'source_unchanged':integrity['unchanged']},ensure_ascii=False))
