"""Prepare an additive PDF inventory outside the shared resource directory."""
from __future__ import annotations

import argparse
import copy
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path


def read(path):
    return json.loads(path.read_text(encoding='utf-8-sig'))


def digest(path):
    value = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            value.update(block)
    return value.hexdigest()


def prepare(baseline, inventory, now):
    result = copy.deepcopy(baseline)
    by_name = {s['filename']: s for s in result['sources']}
    current = {s['filename']: s for s in inventory}
    if len(current) != len(inventory):
        raise ValueError('Duplicate source filenames')
    if set(by_name) - set(current):
        raise ValueError('Existing indexed PDF is missing')
    for name, source in by_name.items():
        if source['sha256'].lower() != current[name]['sha256'].lower():
            raise ValueError('Existing source content changed: ' + name)
    next_id = max(int(s['source_id'].split('-')[1]) for s in result['sources'] if s['source_id'].startswith('NEW-')) + 1
    archives = {a['sha256'].lower(): a for a in result['archives']}
    added = []
    for name in sorted(set(current) - set(by_name)):
        item = current[name]
        sid = f'NEW-{next_id:03d}'
        next_id += 1
        archive = archives.get(item['sha256'])
        source = dict(item, source_id=sid, id_origin='incremental-source-inventory',
                      git_tracked=False, archive_source_id=archive['archive_source_id'] if archive else sid,
                      role='alias' if archive else 'primary',
                      legacy_ids={'feishu_0923_record_id': None, 'pilot_store_id': None, 'sample_id': None})
        if archive:
            archive['filenames'].append(name)
            archive['source_ids'].append(sid)
        else:
            archive = {'archive_source_id': sid, 'store_id': None, 'sha256': item['sha256'],
                       'bytes': item['bytes'], 'page_count': item['page_count'],
                       'filenames': [name], 'source_ids': [sid], 'primary_reason': None}
            archives[item['sha256']] = archive
            result['archives'].append(archive)
        result['sources'].append(source)
        added.append({'source_id': sid, 'filename': name, 'path': item['path'],
                      'sha256': item['sha256'], 'archive_source_id': source['archive_source_id'],
                      'store_id': archive.get('store_id'), 'status': 'pending-store-identity-and-page-classification'})
    for source in result['sources']:
        source['git_tracked'] = False
    summary = result['summary']
    summary.update(pdf_files=len(inventory), pdf_pages=sum(s['page_count'] for s in inventory),
                   pdf_bytes=sum(s['bytes'] for s in inventory), unreadable_pdfs=0,
                   unique_sha256=len(archives), archives=len(result['archives']),
                   alias_files=len(inventory)-len(archives), git_tracked_pdfs=0,
                   untracked_pdfs=len(inventory))
    summary['ids_from_incremental_inventory'] = sum(s.get('id_origin') == 'incremental-source-inventory' for s in result['sources'])
    result['generatedAt'] = now
    result['generator'] = {'script': 'tools/store-archive/sync_source_inventory.py', 'version': '1.0.0'}
    result['rules']['git_tracked'] = '原图纸由OneDrive发布，当前PDF均不在代码Git中跟踪；历史来源身份字段继续保留'
    return result, added


def main():
    import pymupdf
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--resources', type=Path, required=True)
    parser.add_argument('--repo', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--expected-count', type=int, required=True)
    args = parser.parse_args()
    resources, out = args.resources.resolve(), args.out.resolve()
    import subprocess
    entries = subprocess.check_output(['git', '-C', str(args.repo), 'worktree', 'list', '--porcelain'], text=True, encoding='utf-8')
    roots = [resources] + [Path(line[9:]).resolve() for line in entries.splitlines() if line.startswith('worktree ')]
    if out.exists() or any(out.is_relative_to(root) for root in roots):
        raise ValueError('Output must be new and outside resources and all worktrees')
    archive = resources / '09_门店档案'
    baseline_path = archive / '来源清单.json'
    stores_path = archive / '门店总表.json'
    now = datetime.now(timezone.utc).isoformat(timespec='seconds')
    inventory = []
    for path in sorted((resources / '01_各门店原图纸').glob('*.pdf')):
        with pymupdf.open(path) as pdf:
            if pdf.needs_pass or pdf.page_count == 0:
                raise ValueError('Unreadable or empty PDF: ' + path.name)
            pages = pdf.page_count
        inventory.append({'filename': path.name, 'path': '资源库/' + path.relative_to(resources).as_posix(),
                          'sha256': digest(path), 'bytes': path.stat().st_size,
                          'page_count': pages, 'open_error': None})
    if len(inventory) != args.expected_count:
        raise ValueError('PDF count differs from the confirmed publication scope')
    manifest, added = prepare(read(baseline_path), inventory, now)
    stores = read(stores_path)
    existing_pending = {r['source_id']: r for r in stores.get('pending_source_registrations', [])}
    existing_pending.update({r['source_id']: r for r in added})
    stores['pending_source_registrations'] = list(existing_pending.values())
    stores['source_inventory'] = {'pdf_files': len(inventory), 'unique_contents': manifest['summary']['unique_sha256'],
                                'registered_stores': len(stores['stores']), 'pending_sources': len(existing_pending),
                                'updatedAt': now}
    baseline_hashes = {str(baseline_path.relative_to(resources)): digest(baseline_path),
                       str(stores_path.relative_to(resources)): digest(stores_path),
                       '01_各门店原图纸/README.md': digest(resources / '01_各门店原图纸/README.md')}
    out.mkdir(parents=True)
    for name, value in [('来源清单.json', manifest), ('门店总表.json', stores),
                        ('increment-report.json', {'generatedAt': now, 'baselineHashes': baseline_hashes,
                                                  'summary': manifest['summary'], 'added': added,
                                                  'registeredStores': len(stores['stores'])})]:
        (out / name).write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    summary = manifest['summary']
    (out / 'README.md').write_text(
        f'# 各门店原图纸\n\n当前共有 {summary["pdf_files"]} 份原始 PDF，共 {summary["pdf_pages"]} 页，'
        f'{summary["unique_sha256"]} 份不同内容。另有飞书历史台账 `各门店图纸_SI类型与铺型.xlsx`。\n\n'
        '编号、哈希、页数和别名见[来源清单](../09_门店档案/来源清单.json)。'
        f'已建门店档案 {len(stores["stores"])} 家，新增来源的门店身份与主平面分类见门店总表的 pending_source_registrations。\n\n'
        '[旧门店资源索引](../00_资源索引/门店资源索引.json)覆盖最初418份。原始PDF由OneDrive同步，'
        '增量登记沿用历史来源编号及人工裁决。统计时间 ' + now + '。\n', encoding='utf-8')
    print(json.dumps({'summary': summary, 'added': len(added), 'out': str(out)}, ensure_ascii=False))


if __name__ == '__main__':
    main()
