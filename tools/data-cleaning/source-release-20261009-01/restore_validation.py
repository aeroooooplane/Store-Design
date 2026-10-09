"""Isolated tiny CSV/byte fixtures for restore_sources.py; no actual PDFs used."""
import hashlib
import json
import sys
import types
import zipfile
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
DEST = ROOT / '资源库/90_处理过程与审核/数据清洗-20261009/_cache/source-restore-validation-01'


def meta():
    return dict(schemaVersion=1, generatedAt=datetime.now(timezone.utc).isoformat(),
                generator=dict(script='restore_validation.py', version='1.0.0'))


def digest(data):
    return hashlib.sha256(data).hexdigest()


def write_new(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open('xb') as handle:
        handle.write(data)


def fixture(name, missing=False, extra=False, bad_path=False, wrong_hash=False,
            wrong_archive_hash=False, conflict=False):
    base = DEST / name
    assets, project = base / 'assets', base / 'project'
    assets.mkdir(parents=True)
    project.mkdir()
    file_data = [('资源库/01_各门店原图纸/测试甲.csv', b'key,value\nA,1\n'),
                 ('资源库/01_各门店原图纸/测试乙.csv', b'key,value\nB,2\n')]
    archive_name = 'source-supplement-part-01.zip'
    archive_path = assets / archive_name
    if not missing:
        with zipfile.ZipFile(archive_path, 'x', compression=zipfile.ZIP_STORED) as package:
            for relative, data in file_data:
                package.writestr(relative, data)
            if extra:
                package.writestr('资源库/01_各门店原图纸/额外.csv', b'extra')
        raw = archive_path.read_bytes()
    else:
        raw = b'intentionally missing package'
    rows = [dict(source_id='TEST-%03d' % (i + 1), relative_path=relative,
                 sha256=digest(data), bytes=len(data), archive=archive_name)
            for i, (relative, data) in enumerate(file_data)]
    if bad_path:
        rows[0]['relative_path'] = '../outside.csv'
    if wrong_hash:
        rows[1]['sha256'] = '0' * 64
    manifest = {**meta(), 'files': rows,
        'archives': [dict(name=archive_name, bytes=len(raw),
                          sha256=('0' * 64 if wrong_archive_hash else digest(raw)), files_count=2)],
        'totals': dict(pdf=0, spreadsheets=2, files=2, bytes=sum(len(data) for _, data in file_data))}
    write_new(assets / 'source-supplement-manifest.json',
              (json.dumps(manifest, ensure_ascii=False, indent=2) + '\n').encode('utf-8'))
    if conflict:
        write_new(project / file_data[0][0], b'PREEXISTING-DIFFERENT-DO-NOT-OVERWRITE')
    return assets, project, file_data


def project_files(project):
    return {str(p.relative_to(project)): digest(p.read_bytes())
            for p in project.rglob('*') if p.is_file()}


def main():
    sys.stdout.reconfigure(encoding='utf-8')
    if DEST.exists():
        raise FileExistsError('Validation folder already exists; never overwrite: ' + str(DEST))
    DEST.mkdir(parents=True)
    module = types.ModuleType('restore_sources_isolated')
    module.__file__ = str(HERE / 'restore_sources.py')
    exec(compile((HERE / 'restore_sources.py').read_text(encoding='utf-8'), module.__file__, 'exec'), module.__dict__)
    results = []
    assets, project, data = fixture('happy')
    before = project_files(project)
    check = module.restore(assets, project, False)
    assert check['status'] == 'preflight_passed' and check['missing'] == 2
    assert project_files(project) == before and not list(project.iterdir())
    results.append(dict(test='default_preflight_is_read_only', passed=True))
    first = module.restore(assets, project, True)
    assert first['copied'] == 2 and first['missing'] == 0
    for relative, raw in data:
        assert (project / relative).read_bytes() == raw
    before = project_files(project)
    second = module.restore(assets, project, True)
    assert second['copied'] == 0 and second['existing_identical'] == 2
    assert project_files(project) == before
    results.extend([dict(test='exclusive_hardlink_restore', passed=True, copied=2),
                    dict(test='repeat_skips_identical_without_new_artifacts', passed=True, skipped=2)])
    # No fixture is modified after creation. Every negative case has fresh paths.
    cases = [('different_existing_target', dict(conflict=True)),
             ('missing_archive', dict(missing=True)),
             ('extra_archive_entry', dict(extra=True)),
             ('unsafe_scope_path', dict(bad_path=True)),
             ('entry_sha_mismatch', dict(wrong_hash=True)),
             ('archive_sha_mismatch', dict(wrong_archive_hash=True))]
    for name, options in cases:
        assets, project, _ = fixture(name, **options)
        before = project_files(project)
        error = None
        try:
            module.restore(assets, project, True)
        except (ValueError, FileNotFoundError, zipfile.BadZipFile) as caught:
            error = type(caught).__name__ + ': ' + str(caught)
        assert error is not None, 'Expected refusal: ' + name
        assert project_files(project) == before, 'Source/project writes occurred on refusal: ' + name
        results.append(dict(test=name, passed=True, error=error, project_unchanged=True))
    for unsafe in ['资源库/01_各门店原图纸/../x.csv',
                   '资源库/01_各门店原图纸/CON.csv',
                   '资源库/01_各门店原图纸/x.csv:ads',
                   '资源库\\01_各门店原图纸\\x.csv',
                   '/资源库/01_各门店原图纸/x.csv']:
        try:
            module.path_parts(unsafe)
        except ValueError:
            continue
        raise AssertionError('Unsafe path accepted: ' + unsafe)
    results.append(dict(test='windows_path_hazards_rejected', passed=True, cases=5))
    report = {**meta(), 'status': 'passed', 'checks': results,
              'restore_script_sha256': digest((HERE / 'restore_sources.py').read_bytes()),
              'validation_script_sha256': digest(Path(__file__).read_bytes()),
              'fixture_scope': 'Synthetic tiny CSV bytes only; no actual project PDFs or original files touched.',
              'limitations': ['No real 1.51 GB archives tested here.',
                              'Power loss and concurrent destination mutation were not simulated.',
                              'Hardlink support was verified only on this Windows project filesystem.'],
              'training_eligible': False}
    write_new(DEST / 'validation-report.json',
              (json.dumps(report, ensure_ascii=False, indent=2) + '\n').encode('utf-8'))
    print(json.dumps({**meta(), 'status': 'passed', 'checks': len(results),
                      'report': str(DEST / 'validation-report.json')}, ensure_ascii=False))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
