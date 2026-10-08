"""Remove only byte-verified duplicate SI1 review decks; recover from the original ZIP."""
from pathlib import Path
import argparse, hashlib, json, zipfile

ROOT = Path(__file__).resolve().parents[1]
TEMP = ROOT / 'tmp/si-standards-review'
ARCHIVE = ROOT / '设计标准/SI1.0手册文件修改版2.zip'
REPORT = ROOT / 'output/maintenance/verified-duplicate-cleanup.json'
sha = lambda data: hashlib.sha256(data).hexdigest()
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--apply', action='store_true')
parser.add_argument('--restore', action='store_true')
args = parser.parse_args()
assert not (args.apply and args.restore)

with zipfile.ZipFile(ARCHIVE) as archive:
    if args.restore:
        report = json.loads(REPORT.read_text('utf-8'))
        for entry in report['files']:
            target = (ROOT / entry['path']).resolve()
            assert target.parent == TEMP.resolve() and target.name in [f'SI1-part{i}.pptx' for i in range(1, 6)]
            data = archive.read(entry['archive_member'])
            assert sha(data) == entry['sha256']
            if target.exists():
                assert sha(target.read_bytes()) == entry['sha256'], 'Refusing to overwrite changed file'
            else:
                target.write_bytes(data)
        print('Restored 5 verified review decks; source archive unchanged.')
    else:
        entries = [entry for entry in archive.infolist() if entry.filename.lower().endswith('.pptx')]
        files = []
        for i in range(1, 6):
            target = (TEMP / f'SI1-part{i}.pptx').resolve()
            assert target.parent == TEMP.resolve() and target.is_relative_to(ROOT.resolve())
            if not target.exists():
                continue
            data = target.read_bytes()
            matches = [entry for entry in entries if entry.file_size == len(data) and sha(archive.read(entry)) == sha(data)]
            assert len(matches) == 1, f'No unique archive match: {target}'
            files.append({'path': target.relative_to(ROOT).as_posix(), 'bytes': len(data), 'sha256': sha(data), 'archive_member': matches[0].filename})
        report = {'date': '2026-10-04', 'source_archive': ARCHIVE.relative_to(ROOT).as_posix(), 'source_archive_sha256': sha(ARCHIVE.read_bytes()), 'files': files, 'removed_bytes': 0, 'restore': 'python tools/cleanup-review-copies.py --restore'}
        if args.apply and files:
            REPORT.parent.mkdir(parents=True, exist_ok=True)
            # Persist recovery information before unlinking any verified duplicate.
            REPORT.write_text(json.dumps(report, ensure_ascii=False, indent=2), 'utf-8')
            for entry in files:
                target = (ROOT / entry['path']).resolve()
                assert target.parent == TEMP.resolve() and target.is_relative_to(ROOT.resolve())
                assert sha(target.read_bytes()) == entry['sha256']
                target.unlink()
                report['removed_bytes'] += entry['bytes']
                REPORT.write_text(json.dumps(report, ensure_ascii=False, indent=2), 'utf-8')
        print(json.dumps({'mode': 'apply' if args.apply else 'preview', 'verified_duplicates': len(files), 'MiB': round(sum(entry['bytes'] for entry in files) / 1024**2, 2), 'removed_bytes': report['removed_bytes']}, ensure_ascii=False))
