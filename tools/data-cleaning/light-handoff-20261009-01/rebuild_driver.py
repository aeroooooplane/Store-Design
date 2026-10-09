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
                generator=dict(script='run_rebuild.py', version='1.0.0'))

def preflight():
    config = read(OUT / 'rebuild-config.json')
    if config['run_name'] != NAME:
        raise RuntimeError('Run directory mismatch')
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

def run_stage(stage, rows, attempt, stop):
    # Imports must be separated by stage process: the historical modules patch globals.
    if stage == 'scan':
        import scan_all as m
        m.CACHE.mkdir(parents=True, exist_ok=True)
        jobs = [r for r in rows if not (m.CACHE / (r['source_id'] + '.json')).exists()]
        runner = m.scan
    elif stage == 'ocr':
        import ocr_fast_v4 as wrapper
        m = wrapper.run.base
        m.BASE.mkdir(parents=True, exist_ok=True)
        jobs = [r for r in rows if (CACHE / 'scans' / (r['source_id'] + '.json')).exists()
                and not (m.BASE / r['source_id'] / 'receipt.json').exists()]
        runner = m.run
    elif stage == 'raster':
        import raster_pages as m
        m.DEST.mkdir(parents=True, exist_ok=True)
        jobs = [r for r in rows if (CACHE / 'ocr' / r['source_id'] / 'receipt.json').exists()
                and not (m.DEST / r['source_id'] / 'receipt.json').exists()]
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
            return any(p.exists() and read(p).get('sha256') == row['sha256'] for p in candidates)
        jobs = [r for r in rows if (CACHE / ('ocr' if stage == 'geometry' else 'raster') / r['source_id'] / 'receipt.json').exists()
                and not completed(r)]
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
            if not (m.DEST / (key[0] + '-' + key[1] + '.json')).exists():
                candidates[key] = p
        jobs = list(candidates.values())
        runner = m.run
    failures = 0
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
