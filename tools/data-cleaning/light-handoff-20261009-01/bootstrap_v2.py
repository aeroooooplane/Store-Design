"""Prepare a fresh, isolated machine-cache rebuild from a small handoff.
Default: verify package and local code only. --prepare hashes PDFs; no extraction.
No original PDFs, historical outputs, or existing files are overwritten.
"""
import argparse, hashlib, json, os, re, sys
from pathlib import Path
from datetime import datetime, timezone
HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
MANIFEST = HERE / 'bundle-manifest.json'

def read(p):
    return json.loads(Path(p).read_text(encoding='utf-8-sig'))

def digest(p):
    h = hashlib.sha256()
    with Path(p).open('rb') as f:
        for block in iter(lambda: f.read(4 * 1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()

def meta():
    return dict(schemaVersion=1, generatedAt=datetime.now(timezone.utc).isoformat(),
                generator=dict(script='bootstrap_v2.py', version='2.0.0'))

def write_new(p, obj):
    with Path(p).open('x', encoding='utf-8') as f:
        json.dump({**meta(), **obj}, f, ensure_ascii=False, indent=2)
        f.write('\n')

def verify():
    data = read(MANIFEST)
    errors = []
    for base, records in [(HERE, data['payloads']), (ROOT, data['scripts']),
                          (ROOT, data['dependencies'])]:
        for record in records:
            p = base / record['path']
            if not p.is_file() or digest(p) != record['sha256']:
                errors.append(str(p))
    if errors:
        raise RuntimeError('Missing/changed package dependencies: ' + repr(errors))
    gate = read(HERE / 'history/试点验收-r12.json')
    if not gate.get('gate_passed') or gate.get('gate_ratio', 0) < .8:
        raise RuntimeError('Historical pilot method gate missing')
    print('Package and code hashes verified. No cleaning started.', flush=True)
    return data

def bind_sources(source_dir):
    original = read(HERE / 'history/00_同步与文件清单.json')
    source_dir = source_dir.resolve()
    if not source_dir.is_dir():
        raise FileNotFoundError(source_dir)
    paths = [p for p in source_dir.rglob('*') if p.is_file() and
             p.suffix.lower() in {'.pdf', '.xlsx', '.xls', '.csv', '.pptx', '.rar'}]
    by_name = {}
    for p in paths:
        by_name.setdefault(p.name, []).append(p)
    hashes = {}
    def sha(p):
        key = str(p.resolve())
        if key not in hashes:
            hashes[key] = digest(p)
        return hashes[key]
    mapped, missing = [], []
    for index, row in enumerate(original['files'], 1):
        candidates = by_name.get(row['filename'], [])
        match = next((p for p in candidates if p.stat().st_size == row['bytes']
                      and sha(p) == row['sha256']), None)
        if match is None:
            # A renamed file can still be bound by its content, never by appearance.
            match = next((p for p in paths if p.stat().st_size == row['bytes']
                          and sha(p) == row['sha256']), None)
        if match is None:
            missing.append(dict(source_id=row['source_id'], filename=row['filename']))
        else:
            mapped.append({**row, 'path': str(match.resolve()), 'historical_path': row['path'],
                           'training_eligible': False})
        if index % 25 == 0:
            print('SHA256 source verification', index, len(original['files']), flush=True)
    if missing:
        raise RuntimeError('Source SHA256 matches missing; no rebuild created: ' +
                           json.dumps(missing, ensure_ascii=False))
    return original, mapped

def prepare(data, source_dir, name):
    if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_-]{0,63}', name):
        raise ValueError('Run name must use ASCII letters, digits, dash or underscore')
    run = ROOT / '资源库/90_处理过程与审核/数据清洗-20261009'
    target = run / name
    cache = run / '_cache' / name
    mirror = ROOT / 'tools/data-cleaning' / name
    for p in [target, cache, mirror]:
        if p.exists():
            raise FileExistsError('Use a NEW run name; existing directory is immutable: ' + str(p))
    original, rows = bind_sources(source_dir)
    # Source verification finishes before any generated run directories are created.
    target.mkdir(parents=True)
    cache.mkdir(parents=True)
    mirror.mkdir(parents=True)
    transforms = []
    for record in data['scripts']:
        src = ROOT / record['path']
        raw = src.read_bytes()
        transformed = raw.decode('utf-8-sig').replace('全量续跑-02', name).encode('utf-8')
        dst = mirror / src.name
        with dst.open('xb') as f:
            f.write(transformed)
        transforms.append(dict(source=record['path'], source_sha256=record['sha256'],
                               target=str(dst.relative_to(ROOT)),
                               target_sha256=hashlib.sha256(transformed).hexdigest()))
    driver = HERE / 'rebuild_driver_v2.py'
    with (mirror / 'run_rebuild.py').open('xb') as f:
        f.write(driver.read_bytes())
    transforms.append(dict(source=str(driver.relative_to(ROOT)), source_sha256=digest(driver),
                           target=str((mirror / 'run_rebuild.py').relative_to(ROOT)),
                           target_sha256=digest(mirror / 'run_rebuild.py')))
    write_new(target / '00_同步与文件清单.json', dict(
        files=rows, summary=original['summary'], duplicates=original.get('duplicates'),
        historical_manifest_sha256=digest(HERE / 'history/00_同步与文件清单.json'),
        binding_method='full_sha256_and_bytes', source_directory=str(source_dir.resolve()),
        incoming=[], training_eligible=False))
    write_new(target / 'rebuild-config.json', dict(
        run_name=name, bundle=str(HERE.relative_to(ROOT)),
        bundle_manifest_sha256=digest(MANIFEST), transformations=transforms,
        source_manifest_sha256=digest(target / '00_同步与文件清单.json'),
        transformation='UTF-8 exact literal replacement: 全量续跑-02 -> run_name',
        history_policy='reference only; no historical stage receipts restored',
        historical_method_gate=dict(path='history/试点验收-r12.json',
                                    gate_ratio=.8, new_visual_verification_required=True),
        training_eligible=False))
    for sub in ['scans', 'ocr', 'raster', 'handoff-control']:
        (cache / sub).mkdir(parents=True)
    print('Prepared isolated run:', target, flush=True)
    print('No extraction started. Next: python "' + str(mirror / 'run_rebuild.py') + '"', flush=True)
    print('Then explicitly start with --execute --stage all', flush=True)

def main():
    sys.stdout.reconfigure(encoding='utf-8')
    parser = argparse.ArgumentParser()
    parser.add_argument('--prepare', action='store_true')
    parser.add_argument('--source-dir', type=Path,
                        default=ROOT / '资源库/01_各门店原图纸')
    parser.add_argument('--run-name', default='rebuild-20261009-01')
    args = parser.parse_args()
    data = verify()
    if args.prepare:
        prepare(data, args.source_dir, args.run_name)
    return 0

if __name__ == '__main__':
    raise SystemExit(main())
