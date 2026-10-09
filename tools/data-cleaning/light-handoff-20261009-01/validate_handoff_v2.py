"""Small isolated fixture tests; never opens a real PDF or starts OCR."""
import importlib.util, json, hashlib, sys, types
from pathlib import Path
from datetime import datetime, timezone
HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
sys.stdout.reconfigure(encoding='utf-8')
TEST = ROOT / '资源库/90_处理过程与审核/数据清洗-20261009/_cache/light-handoff-validation-02'
TEST.mkdir(parents=True, exist_ok=False)

def load(name, file):
    spec = importlib.util.spec_from_file_location(name, HERE / file)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod

def put(p, value):
    p.parent.mkdir(parents=True, exist_ok=True)
    with p.open('x', encoding='utf-8') as f:
        json.dump(value, f)

driver = load('test_driver', 'rebuild_driver_v3.py')
driver.OUT = TEST / 'stage-output'; driver.OUT.mkdir()
driver.CACHE = TEST / 'stage-cache'; (driver.CACHE / 'scans').mkdir(parents=True)
rows = [dict(source_id=n, sha256=n) for n in ['good', 'broken', 'new']]
put(driver.CACHE/'scans/good.json', dict(sha256='good', pages=[]))
(driver.CACHE/'scans/broken.json').write_text('{', encoding='utf-8')
seen = []
module = types.ModuleType('scan_all'); module.CACHE=driver.CACHE/'scans'
def fake_scan(row):
    seen.append(row['source_id'])
    return dict(source_id=row['source_id'], status='done')
module.scan=fake_scan; sys.modules['scan_all']=module
result = driver.run_stage('scan', rows, 'fixture', TEST/'never-stop.flag')
assert seen == ['new'] and result == 2, (seen, result)
assert (driver.CACHE/'scans/broken.json').read_text() == '{'
base = types.SimpleNamespace(BASE=driver.CACHE/'ocr', run=lambda r: (_ for _ in ()).throw(AssertionError('should not run')))
wrapper = types.ModuleType('ocr_fast_v4'); wrapper.run=types.SimpleNamespace(base=base)
sys.modules['ocr_fast_v4']=wrapper
put(base.BASE/'good/classified.json', {})
assert driver.run_stage('ocr', rows[:1], 'fixture-ocr', TEST/'never-stop.flag') == 2
assert not (base.BASE/'good/receipt.json').exists()

bootstrap = load('test_bootstrap', 'bootstrap_v3.py')
fake_root=TEST/'project'; fake_here=fake_root/'tools/data-cleaning/light-fixture'
(fake_here/'history').mkdir(parents=True)
bootstrap.ROOT=fake_root; bootstrap.HERE=fake_here
bootstrap.MANIFEST=fake_here/'bundle-manifest.json'
put(bootstrap.MANIFEST, dict(fixture=True))
(fake_here/'rebuild_driver_v3.py').write_bytes((HERE/'rebuild_driver_v3.py').read_bytes())
source_dir=TEST/'sources'; source_dir.mkdir()
source=source_dir/'fixture.csv'; source.write_bytes(b'fixture,value\n1,2\n')
row=dict(source_id='FIXTURE-001', filename=source.name, path='old:/fixture.csv',
         bytes=source.stat().st_size, sha256=bootstrap.digest(source), format='csv')
put(fake_here/'history/00_同步与文件清单.json', dict(files=[row],summary=dict(project_pdfs=0)))
old=fake_root/'tools/data-cleaning/full-run-02'; old.mkdir(parents=True)
script=old/'scan_all.py'; script.write_text("# fixture path 全量续跑-02\n", encoding='utf-8')
data=dict(scripts=[dict(path=str(script.relative_to(fake_root)),sha256=bootstrap.digest(script))])
bootstrap.prepare(data, source_dir, 'fixture-run')
new=fake_root/'tools/data-cleaning/fixture-run/scan_all.py'
assert 'fixture-run' in new.read_text(encoding='utf-8')
assert '全量续跑-02' in script.read_text(encoding='utf-8')
new_out=fake_root/'资源库/90_处理过程与审核/数据清洗-20261009/fixture-run'
assert bootstrap.read(new_out/'00_同步与文件清单.json')['files'][0]['source_id']=='FIXTURE-001'
assert not (new_out/'progress.jsonl').exists()
try:
    bootstrap.prepare(data, source_dir, 'fixture-run')
except FileExistsError:
    pass
else:
    raise AssertionError('existing run overwritten')
source.write_bytes(b'wrong-content\n')
try:
    bootstrap.prepare(data, source_dir, 'fixture-bad-source')
except RuntimeError:
    pass
else:
    raise AssertionError('wrong source accepted')
assert not (new_out.parent/'fixture-bad-source').exists()
print('PASS: corrupt receipt detection; classified-without-receipt detection; fresh output isolation; stable source ID; no-overwrite; SHA mismatch prevents creation. No real PDF/OCR accessed.')
