"""Generated-run entry: one source at a time, stages in separate processes.
Default is read-only preflight. This generates drafts, never final visual approval.
"""
import argparse, hashlib, importlib, json, os, subprocess, sys, uuid
from datetime import datetime, timezone
from pathlib import Path
ROOT = Path(__file__).resolve().parents[3]
NAME = Path(__file__).resolve().parent.name
RUN = ROOT / '资源库/90_处理过程与审核/数据清洗-20261009'
OUT = RUN / NAME
CACHE = RUN / '_cache' / NAME
STAGES = ['scan', 'ocr', 'raster', 'geometry', 'recover', 'scales']

def read(p):
    return json.loads(Path(p).read_text(encoding='utf-8-sig'))

def digest(p):
    return hashlib.sha256(Path(p).read_bytes()).hexdigest()

def meta():
    return dict(schemaVersion=1, generatedAt=datetime.now(timezone.utc).isoformat(),
                generator=dict(script='run_rebuild.py', version='3.0.0'))

def preflight():
    config = read(OUT / 'rebuild-config.json')
    if config['run_name'] != NAME:
        raise RuntimeError('Run directory mismatch')
    bundle = ROOT / config['bundle']
    if digest(bundle / 'bundle-manifest-v2.json') != config['bundle_manifest_sha256']:
        raise RuntimeError('Bundle manifest changed')
    for dependency in read(bundle / 'bundle-manifest-v2.json')['dependencies']:
        dep_path = ROOT / dependency['path']
        canonical = dep_path.read_bytes().decode('utf-8').replace('\r\n', '\n').encode('utf-8')
        if digest(dep_path) != dependency['sha256'] and hashlib.sha256(canonical).hexdigest() != dependency.get('sha256_lf'):
            raise RuntimeError('Runtime dependency changed: ' + dependency['path'])
    for r in config['transformations']:
        if digest(ROOT / r['target']) != r['target_sha256']:
            raise RuntimeError('Changed runtime source: ' + r['target'])
    manifest = OUT / '00_同步与文件清单.json'
    if digest(manifest) != config['source_manifest_sha256']:
        raise RuntimeError('Source manifest changed')
    rows = read(manifest)['files']
    for r in rows:
        p = Path(r['path'])
        if not p.is_file() or p.stat().st_size != r['bytes']:
            raise RuntimeError('Source missing or changed length: ' + r['source_id'])
    print('Preflight passed; sources', len(rows), '; drafts require new visual review.', flush=True)
    return [r for r in rows if r['format'] == 'pdf']

def log(record):
    with (OUT / 'progress.jsonl').open('a', encoding='utf-8') as f:
        f.write(json.dumps({**meta(), **record}, ensure_ascii=False) + '\n')
        f.flush()
        os.fsync(f.fileno())

def receipt_exists(path, row):
    if not path.exists():
        return False
    data = read(path)  # Malformed/truncated JSON must never count as completed.
    if data.get('sha256') != row['sha256']:
        raise RuntimeError('Receipt SHA mismatch: ' + str(path))
    if path.parent.name == 'scans' and not isinstance(data.get('pages'), list):
        raise RuntimeError('Invalid scan receipt: ' + str(path))
    return True

def run_stage(stage, rows, attempt, stop):
    audit_failures = []
    def select(rows, done_path, ready_path=None, classified_guard=False):
        jobs = []
        for row in rows:
            try:
                done = done_path(row)
                if receipt_exists(done, row):
                    continue
                if classified_guard and (done.parent / 'classified.json').exists():
                    raise RuntimeError('Interrupted between classified.json and receipt.json; preserve files and use a new revision/run name: ' + str(done.parent))
                if ready_path is None or receipt_exists(ready_path(row), row):
                    jobs.append(row)
            except Exception as error:
                record = dict(stage='rebuild_' + stage, attempt=attempt,
                              source_id=row['source_id'], status='failed',
                              error='State audit: ' + str(error))
                audit_failures.append(record)
                log(record)
                print(json.dumps(record, ensure_ascii=False), flush=True)
        return jobs

    # Imports must be separated by stage process: the historical modules patch globals.
    if stage == 'scan':
        import scan_all as m
        m.CACHE.mkdir(parents=True, exist_ok=True)
        jobs = select(rows, lambda r: m.CACHE / (r['source_id'] + '.json'))
        runner = m.scan
    elif stage == 'ocr':
        import ocr_fast_v4 as wrapper
        m = wrapper.run.base
        m.BASE.mkdir(parents=True, exist_ok=True)
        jobs = select(rows, lambda r: m.BASE / r['source_id'] / 'receipt.json',
                      lambda r: CACHE / 'scans' / (r['source_id'] + '.json'), True)
        runner = m.run
    elif stage == 'raster':
        import raster_pages as m
        m.DEST.mkdir(parents=True, exist_ok=True)
        jobs = select(rows, lambda r: m.DEST / r['source_id'] / 'receipt.json',
                      lambda r: CACHE / 'ocr' / r['source_id'] / 'receipt.json', True)
        runner = m.run
    elif stage in ('geometry', 'recover'):
        wrapper = importlib.import_module('extract_enriched_v4' if stage == 'geometry' else 'extract_final')
        m = wrapper.run.base
        m.DEST.mkdir(parents=True, exist_ok=True)
        if stage == 'recover':
            rows = m.read(OUT / '00_同步与文件清单.json')['files']
        def completed(row):
            candidates = [m.DEST / row['source_id'] / 'receipt.json']
            candidates += list(OUT.glob('平面候选-rebuild-' + stage + '-*/' + row['source_id'] + '/receipt.json'))
            return any(receipt_exists(p, row) for p in candidates)
        jobs = []
        for row in rows:
            try:
                if receipt_exists(CACHE / ('ocr' if stage == 'geometry' else 'raster') / row['source_id'] / 'receipt.json', row) and not completed(row):
                    jobs.append(row)
            except Exception as error:
                record = dict(stage='rebuild_' + stage, attempt=attempt,
                              source_id=row['source_id'], status='failed', error='State audit: ' + str(error))
                audit_failures.append(record)
                log(record)
        def runner(row):
            saved_dest, saved_cache = m.DEST, m.CACHE
            try:
                if (m.DEST / row['source_id']).exists():
                    m.DEST = OUT / ('平面候选-rebuild-' + stage + '-' + attempt)
                    m.CACHE = CACHE / ('geometry-rebuild-' + stage + '-' + attempt)
                    m.DEST.mkdir(parents=True, exist_ok=True)
                return m.run(row)
            finally:
                m.DEST, m.CACHE = saved_dest, saved_cache
    else:
        import propose_scales_all as m
        m.DEST.mkdir(parents=True, exist_ok=True)
        candidates = {}
        # A new recovery draft supersedes a partial earlier draft for scale proposals.
        for p in sorted(OUT.glob('平面候选*/**/draft.json'), key=lambda p: p.stat().st_mtime_ns):
            key = (p.parent.parent.name, p.parent.name)
            existing = m.DEST / (key[0] + '-' + key[1] + '.json')
            if not existing.exists():
                candidates[key] = p
            else:
                try:
                    if read(existing).get('source_sha256') != read(p).get('source_sha256'):
                        raise RuntimeError('Scale receipt source hash mismatch')
                except Exception as error:
                    record = dict(stage='rebuild_' + stage, attempt=attempt, status='failed',
                                  source_id=key[0], error='State audit: ' + str(error))
                    audit_failures.append(record)
                    log(record)
        jobs = list(candidates.values())
        runner = m.run
    failures = len(audit_failures)
    for index, job in enumerate(jobs, 1):
        if stop.exists():
            print('Stopped between sources; saved records remain.', flush=True)
            return 3
        try:
            result = runner(job)
        except Exception as e:
            result = dict(status='failed', source_id=job.get('source_id') if isinstance(job, dict) else str(job), error=str(e))
        if result.get('status') in {'failed', 'partial'} or result.get('errors'):
            failures += 1
        log(dict(stage='rebuild_' + stage, attempt=attempt, **result))
        print(stage, index, len(jobs), json.dumps(result, ensure_ascii=False), flush=True)
    log(dict(stage='rebuild_stage_finished', name=stage, attempt=attempt, jobs=len(jobs), failures=failures))
    return 2 if failures else 0

def main():
    sys.stdout.reconfigure(encoding='utf-8')
    parser = argparse.ArgumentParser()
    parser.add_argument('--execute', action='store_true')
    parser.add_argument('--stage', choices=STAGES + ['all'], default='all')
    parser.add_argument('--attempt')
    args = parser.parse_args()
    rows = preflight()
    if not args.execute:
        return 0
    for d in ['scans', 'ocr', 'raster', 'handoff-control']:
        (CACHE / d).mkdir(parents=True, exist_ok=True)
    attempt = args.attempt or (datetime.now().strftime('%Y%m%d-%H%M%S') + '-' + uuid.uuid4().hex[:8])
    if not all(c.isascii() and (c.isalnum() or c in '-_') for c in attempt):
        raise ValueError('Invalid attempt id')
    stop = CACHE / 'handoff-control' / ('stop-' + attempt + '.flag')
    print('To stop after the current source, create:', stop, flush=True)
    if args.stage != 'all':
        return run_stage(args.stage, rows, attempt, stop)
    outcomes = {}
    for stage in STAGES:
        if stop.exists():
            return 3
        command = [sys.executable, str(Path(__file__).resolve()), '--execute', '--stage', stage, '--attempt', attempt]
        env = dict(os.environ, PYTHONDONTWRITEBYTECODE='1', OMP_NUM_THREADS='1', OPENBLAS_NUM_THREADS='1')
        code = subprocess.call(command, cwd=ROOT, env=env,
                               creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        outcomes[stage] = code
        if code == 3:
            return 3
        # Keep processing other available sources after a failed source/stage.
    log(dict(stage='rebuild_attempt_finished', attempt=attempt, outcomes=outcomes,
             final_acceptance=False, training_eligible=False))
    print('Machine stages ended. Still required: visual checks, corrections, grouping, packaging and QA.', flush=True)
    return 2 if any(outcomes.values()) else 0

if __name__ == '__main__':
    raise SystemExit(main())
