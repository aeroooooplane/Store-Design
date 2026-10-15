"""One local entry point: check, parse, preview, render, supplement, status."""
import argparse
import importlib.util
import json
import shutil
import subprocess
import sys
import time
import uuid
from pathlib import Path
from render_queue import atomic_json, select_views

ROOT = Path(__file__).resolve().parents[1]


def finish_check(directory, result):
    atomic_json(Path(directory) / 'progress.json', {**result, 'updated_at': time.time()})
    return result


def status(directory):
    path = Path(directory) / 'progress.json'
    if not path.exists():
        return {'state': 'not_started'}
    record = json.loads(path.read_text(encoding='utf-8'))
    if record.get('state') in ('running', 'initializing'):
        record['elapsed_seconds'] = round(time.time() - record['started_at'], 1)
        if record.get('current'):
            record['current']['elapsed_seconds'] = round(time.time() - record['current']['started_at'], 1)
        controller = Path(directory) / 'controller.json'
        if controller.exists():
            heartbeat = json.loads(controller.read_text(encoding='utf-8')).get('heartbeat', 0)
            record['controller_heartbeat_age_seconds'] = round(time.time() - heartbeat, 1)
            record['check_process_if_stale'] = time.time() - heartbeat > 60
        else:
            record['check_process_if_stale'] = time.time() - record.get('updated_at', 0) > 60
            record['heartbeat_available'] = False
    record.pop('passes', None)
    return record


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['check', 'parse', 'preview', 'render', 'supplement', 'status'])
    parser.add_argument('--job', default=str(ROOT / 'assets/xian/job.json'))
    parser.add_argument('--out', required=True)
    parser.add_argument('--blender', default=shutil.which('blender'))
    parser.add_argument('--source')
    parser.add_argument('--pages', default='1')
    parser.add_argument('--views')
    parser.add_argument('--profile', choices=['draft', 'final'])
    parser.add_argument('--mode', choices=['both', 'material', 'white'], default='both')
    parser.add_argument('--recover-incomplete', action='store_true')
    parser.add_argument('--threads', type=int, default=4)
    args = parser.parse_args()
    directory = Path(args.out).resolve()
    if args.action == 'status':
        return status(directory)
    if args.action == 'parse':
        if not args.source:
            parser.error('parse requires --source PDF')
        from pdf_cache import extract
        result = extract(args.source, directory / 'pdf-cache', [int(n) for n in args.pages.split(',')])
        atomic_json(directory / 'parse-last-run.json', result)
        return result
    if not args.blender or not Path(args.blender).is_file():
        raise ValueError('Provide --blender with the Blender 4.5 executable path')
    if args.threads < 1:
        raise ValueError('threads must be positive')
    if args.action == 'preview' and importlib.util.find_spec('PIL') is None:
        raise ValueError('Preview contact sheet needs Pillow in this Python runtime')
    if args.action == 'supplement' and not args.views:
        parser.error('supplement requires --views; it never defaults to all')
    job_path = Path(args.job).resolve()
    job = json.loads(job_path.read_text(encoding='utf-8-sig'))
    selection = args.views or ('@preview' if args.action == 'preview' else 'all')
    views = select_views(job, selection)
    profile = args.profile or ('draft' if args.action in ['check', 'preview'] else 'final')
    command = [args.blender, '--background', '--factory-startup', '--disable-autoexec',
               '--threads', str(args.threads), '--python-exit-code', '1', '--python',
               str(ROOT / 'scripts/render_scene.py'), '--', '--job', str(job_path), '--out', str(directory),
               '--profile', profile, '--views', selection, '--mode', args.mode]
    if args.recover_incomplete:
        command.append('--recover-incomplete')
    if args.action == 'check':
        command.append('--check-only')
    directory.mkdir(parents=True, exist_ok=True)
    log = directory / ('blender-' + time.strftime('%Y%m%d-%H%M%S') + '-' + uuid.uuid4().hex[:6] + '.log')
    with log.open('w', encoding='utf-8') as stream:
        process = subprocess.Popen(command, stdout=stream, stderr=subprocess.STDOUT)
        try:
            while process.poll() is None:
                atomic_json(directory / 'controller.json', {'pid': process.pid, 'heartbeat': time.time(), 'log': log.name})
                time.sleep(.5)
        except KeyboardInterrupt:
            process.terminate()
            process.wait()
            raise
    if process.returncode:
        raise RuntimeError('Blender stopped with code ' + str(process.returncode) + '; inspect ' + str(log))
    if args.action == 'check':
        return finish_check(directory, {'state': 'check_passed', 'selected_views': len(views), 'log': str(log),
                'python_pdfplumber': importlib.util.find_spec('pdfplumber') is not None,
                'python_pillow': importlib.util.find_spec('PIL') is not None})
    result = json.loads((directory / 'last-run.json').read_text(encoding='utf-8'))
    if args.action == 'preview':
        from contact_sheet import make_sheet
        labeled = [{**v, 'label': job.get('view_labels', {}).get(v['id'], v['id'])} for v in views]
        result['contact_sheet'] = make_sheet(directory, labeled)
        atomic_json(directory / 'preview-report.json', result)
    result.pop('passes', None)
    result['log'] = str(log)
    return result


if __name__ == '__main__':
    try:
        print(json.dumps(main(), ensure_ascii=False))
    except Exception as error:
        print(json.dumps({'state': 'failed', 'error': str(error)}, ensure_ascii=False), file=sys.stderr)
        raise SystemExit(1)
