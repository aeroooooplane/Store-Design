"""Verify/restore source Release attachments without overwrite; Python stdlib only.
Default is read-only. Never downloads, deletes, overwrites, or starts cleaning.
"""
import argparse
import hashlib
import json
import os
import re
import stat
import sys
import uuid
import zipfile
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath

VERSION = '1.0.0'
MANIFEST_NAME = 'source-supplement-manifest.json'
SOURCE_PREFIX = ('资源库', '01_各门店原图纸')
CACHE_PARTS = ('资源库', '90_处理过程与审核', '数据清洗-20261009', '_cache')
CHUNK = 4 * 1024 * 1024


def metadata():
    return dict(schemaVersion=1, generatedAt=datetime.now(timezone.utc).isoformat(),
                generator=dict(script='restore_sources.py', version=VERSION))


def emit(data):
    print(json.dumps({**metadata(), **data}, ensure_ascii=False), flush=True)


def write_json_new(path, data):
    with path.open('x', encoding='utf-8', newline='\n') as handle:
        json.dump({**metadata(), **data}, handle, ensure_ascii=False, indent=2)
        handle.write('\n')


def sha_file(path):
    hasher = hashlib.sha256()
    with path.open('rb') as handle:
        for block in iter(lambda: handle.read(CHUNK), b''):
            hasher.update(block)
    return hasher.hexdigest()


def fail(message):
    raise ValueError(message)


def check_plain_ancestors(path):
    # Never follow a Windows junction/reparse point or a POSIX symbolic link.
    for item in [*reversed(path.parents), path]:
        try:
            info = item.lstat()
        except FileNotFoundError:
            continue
        attrs = getattr(info, 'st_file_attributes', 0)
        if stat.S_ISLNK(info.st_mode) or attrs & getattr(stat, 'FILE_ATTRIBUTE_REPARSE_POINT', 1024):
            fail('Links/reparse points are not accepted: ' + str(item))


def int_field(value, label, minimum=0):
    if isinstance(value, bool) or not isinstance(value, int) or value < minimum:
        fail('Invalid integer ' + label)
    return value


def validate_sha(value):
    if not isinstance(value, str) or not re.fullmatch(r'[0-9a-f]{64}', value):
        fail('SHA256 must be 64 lowercase hexadecimal characters')


def path_parts(name):
    if not isinstance(name, str) or not name or '\\' in name or ':' in name or '\x00' in name:
        fail('Unsafe relative path: ' + repr(name))
    parts = name.split('/')
    if any(not part or part in {'.', '..'} or part.endswith((' ', '.')) for part in parts):
        fail('Unsafe path components: ' + repr(name))
    if PurePosixPath(name).is_absolute() or tuple(parts[:2]) != SOURCE_PREFIX or len(parts) < 3:
        fail('Path outside source scope: ' + repr(name))
    for part in parts:
        if any(char in part for char in '<>"|?*') or any(ord(char) < 32 for char in part):
            fail('Invalid Windows path component: ' + repr(part))
        stem = part.split('.')[0].upper()
        if stem in {'CON', 'PRN', 'AUX', 'NUL'} or re.fullmatch(r'(COM|LPT)[1-9]', stem):
            fail('Windows device path is forbidden: ' + repr(part))
    if PurePosixPath(name).suffix.lower() not in {'.pdf', '.xlsx', '.xls', '.csv'}:
        fail('Unsupported source extension: ' + name)
    return tuple(parts)


def expected_target(project, record):
    target = project.joinpath(*record['_parts'])
    check_plain_ancestors(target)
    target.resolve(strict=False).relative_to(project)
    return target


def target_state(target, record):
    check_plain_ancestors(target)
    if not target.exists():
        return 'missing'
    if not target.is_file():
        fail('Destination is not a regular file: ' + str(target))
    if target.stat().st_size != record['bytes'] or sha_file(target) != record['sha256']:
        fail('Existing destination differs; refusing all source writes: ' + str(target))
    return 'identical'


def validate_manifest(assets, project):
    check_plain_ancestors(assets)
    check_plain_ancestors(project)
    if not assets.is_dir() or not project.is_dir():
        fail('Both assets-dir and project-root must already be directories')
    manifest_path = assets / MANIFEST_NAME
    check_plain_ancestors(manifest_path)
    document = json.loads(manifest_path.read_text(encoding='utf-8-sig'))
    if document.get('schemaVersion') != 1 or not document.get('generatedAt') or not document.get('generator'):
        fail('Manifest metadata is missing or schemaVersion is unsupported')
    files, archives, totals = document.get('files'), document.get('archives'), document.get('totals')
    if not isinstance(files, list) or not files or not isinstance(archives, list) or not archives:
        fail('Nonempty files and archives lists are required')
    if not isinstance(totals, dict):
        fail('Manifest totals must be an object')
    archive_map = {}
    for archive in archives:
        name = archive.get('name')
        if not isinstance(name, str) or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.-]*\.zip', name):
            fail('Unsafe archive name: ' + repr(name))
        if name.casefold() in {x.casefold() for x in archive_map}:
            fail('Duplicate archive name: ' + name)
        int_field(archive.get('bytes'), 'archive bytes', 1)
        int_field(archive.get('files_count'), 'archive files_count', 1)
        validate_sha(archive.get('sha256'))
        archive_map[name] = archive
    by_archive = {name: [] for name in archive_map}
    seen_paths, seen_ids = set(), set()
    pdfs = sheets = raw_bytes = 0
    for record in files:
        name = record.get('relative_path')
        parts = path_parts(name)
        folded = name.casefold()
        source_id = record.get('source_id')
        if not isinstance(source_id, str) or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_-]*', source_id):
            fail('Unsafe source_id: ' + repr(source_id))
        if folded in seen_paths or source_id.casefold() in seen_ids:
            fail('Duplicate file path or source_id: ' + name)
        seen_paths.add(folded)
        seen_ids.add(source_id.casefold())
        int_field(record.get('bytes'), 'source bytes', 1)
        validate_sha(record.get('sha256'))
        if record.get('archive') not in archive_map:
            fail('File references unknown archive: ' + name)
        record['_parts'] = parts
        by_archive[record['archive']].append(record)
        raw_bytes += record['bytes']
        if PurePosixPath(name).suffix.lower() == '.pdf':
            pdfs += 1
        else:
            sheets += 1
    expected_totals = dict(pdf=pdfs, spreadsheets=sheets, files=len(files), bytes=raw_bytes)
    for key, expected in expected_totals.items():
        if int_field(totals.get(key), 'totals.' + key) != expected:
            fail('Totals mismatch: ' + key)
    for name, archive in archive_map.items():
        if len(by_archive[name]) != archive['files_count']:
            fail('Archive count mismatch: ' + name)
    return document, files, archive_map, by_archive, sha_file(manifest_path)


def validate_archive(assets, archive, records):
    path = assets / archive['name']
    check_plain_ancestors(path)
    if not path.is_file() or path.stat().st_size != archive['bytes'] or sha_file(path) != archive['sha256']:
        fail('Missing or corrupt archive: ' + archive['name'])
    expected = {record['relative_path']: record for record in records}
    with zipfile.ZipFile(path) as package:
        entries = package.infolist()
        names = [entry.filename for entry in entries]
        if len(names) != len(set(name.casefold() for name in names)) or set(names) != set(expected):
            fail('Archive entries differ from manifest: ' + archive['name'])
        for entry in entries:
            path_parts(entry.filename)
            mode = entry.external_attr >> 16
            if entry.is_dir() or stat.S_ISLNK(mode) or (stat.S_IFMT(mode) not in (0, stat.S_IFREG)) or entry.flag_bits & 1:
                fail('Directories, special files, links or encrypted entries are forbidden: ' + entry.filename)
            record = expected[entry.filename]
            if entry.file_size != record['bytes']:
                fail('Uncompressed entry length differs: ' + entry.filename)
            hasher, size = hashlib.sha256(), 0
            with package.open(entry) as source:
                for block in iter(lambda: source.read(CHUNK), b''):
                    size += len(block)
                    if size > record['bytes']:
                        fail('Entry exceeded declared size: ' + entry.filename)
                    hasher.update(block)
            if size != record['bytes'] or hasher.hexdigest() != record['sha256']:
                fail('Entry SHA256 mismatch: ' + entry.filename)


def restore(assets, project, apply=False):
    assets = Path(os.path.abspath(assets))
    project = Path(os.path.abspath(project))
    document, records, archives, by_archive, manifest_sha = validate_manifest(assets, project)
    # ALL package hashes, entry hashes and existing targets are checked before writes.
    for name, archive in archives.items():
        validate_archive(assets, archive, by_archive[name])
    pending, identical = [], []
    for record in records:
        target = expected_target(project, record)
        if target_state(target, record) == 'identical':
            identical.append(record['source_id'])
        else:
            pending.append(record)
    result = dict(status='preflight_passed', applied=False, manifest_sha256=manifest_sha,
                  files=len(records), existing_identical=len(identical), missing=len(pending),
                  copied=0, totals=document['totals'], project_root=str(project),
                  training_eligible=False)
    if not apply:
        return result
    if not pending:
        return {**result, 'status': 'restored', 'applied': True, 'staging_directory': None}
    cache = project.joinpath(*CACHE_PARTS)
    check_plain_ancestors(cache)
    cache.mkdir(parents=True, exist_ok=True)
    staging = cache / ('source-restore-' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ-') + uuid.uuid4().hex)
    staging.mkdir()
    staged = []
    # Stage all missing bytes before any file is linked into the source directory.
    for index, record in enumerate(pending):
        staged_path = staging / ('%04d.bin' % index)
        hasher, size = hashlib.sha256(), 0
        with zipfile.ZipFile(assets / record['archive']) as package:
            with package.open(record['relative_path']) as source, staged_path.open('xb') as target:
                for block in iter(lambda: source.read(CHUNK), b''):
                    size += len(block)
                    if size > record['bytes']:
                        fail('Staging exceeded declared size')
                    hasher.update(block)
                    target.write(block)
                target.flush()
                os.fsync(target.fileno())
        if size != record['bytes'] or hasher.hexdigest() != record['sha256']:
            fail('Staged content SHA mismatch: ' + record['relative_path'])
        staged.append((record, staged_path))
    # Recheck ALL destinations immediately before linking; conflicts cannot overwrite.
    for record in records:
        target_state(expected_target(project, record), record)
    write_json_new(staging / 'staging-manifest.json', dict(
        manifest_sha256=manifest_sha, entries=[dict(source_id=r['source_id'],
        relative_path=r['relative_path'], staged_filename=p.name, sha256=r['sha256'],
        bytes=r['bytes']) for r, p in staged], training_eligible=False))
    copied, race_identical = 0, 0
    for record, staged_path in staged:
        target = expected_target(project, record)
        target.parent.mkdir(parents=True, exist_ok=True)
        check_plain_ancestors(target.parent)
        try:
            # Same filesystem, atomic exclusive creation; no replace/rename fallback.
            os.link(staged_path, target)
            copied += 1
        except FileExistsError:
            target_state(target, record)
            race_identical += 1
        if target_state(target, record) != 'identical':
            fail('Unexpected target state after linking')
    result.update(status='restored', applied=True, copied=copied,
                  existing_identical=len(identical) + race_identical,
                  missing=0, staging_directory=str(staging))
    write_json_new(staging / 'restore-receipt.json', result)
    return result


def main():
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--assets-dir', type=Path, default=Path(__file__).resolve().parent)
    parser.add_argument('--project-root', type=Path, required=True)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    try:
        emit(restore(args.assets_dir, args.project_root, args.apply))
        return 0
    except Exception as error:
        emit(dict(status='failed', applied=False, error=type(error).__name__ + ': ' + str(error),
                  note='No existing file was overwritten. If interrupted during exclusive linking, some verified new files may remain; rerun safely.',
                  training_eligible=False))
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
