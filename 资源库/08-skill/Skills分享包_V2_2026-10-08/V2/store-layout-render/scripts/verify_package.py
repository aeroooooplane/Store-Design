"""Standard Python: verify_package.py /path/to/规则V1; read-only integrity check."""
import json
import sys
from pathlib import Path
from render_core import sha256_file


def main():
    root = Path(sys.argv[1]).resolve()
    manifest = json.loads((root / 'package-manifest.json').read_text(encoding='utf-8'))
    failures = []
    for item in manifest['files']:
        path = (root / item['path']).resolve()
        if not path.is_relative_to(root):
            raise ValueError('Manifest path escapes package')
        if not path.is_file() or path.stat().st_size != item['bytes'] or sha256_file(path) != item['sha256']:
            failures.append(item['path'])
    print(json.dumps({'files': len(manifest['files']), 'failed': failures}, ensure_ascii=False))
    if failures:
        raise SystemExit(1)


if __name__ == '__main__':
    main()
