"""阶段 0：逐文件核对 全量续跑-02 的本机备份，生成 备份核对.json。

只读比较原件与备份的相对路径、字节数和 SHA256；不修改任何一方。
"""

from __future__ import annotations

import sys
from pathlib import Path

from common import base_args, header, rel, sha256_file, write_json

CLEAN = "资源库/90_处理过程与审核/数据清洗-20261009"
PAIRS = [
    (f"{CLEAN}/全量续跑-02", "全量续跑-02"),
    (f"{CLEAN}/_cache/全量续跑-02", "_cache/全量续跑-02"),
]


def listing(root: Path) -> dict[str, Path]:
    return {p.relative_to(root).as_posix(): p for p in root.rglob("*") if p.is_file()}


def main() -> None:
    parser = base_args(__doc__.splitlines()[0])
    parser.add_argument("--backup", type=Path, default=Path("D:/门店图纸备份/全量续跑-02-20261009"))
    args = parser.parse_args()
    results = []
    ok = True
    for source_rel, backup_rel in PAIRS:
        source, backup = args.repo / source_rel, args.backup / backup_rel
        a, b = listing(source), listing(backup)
        missing = sorted(set(a) - set(b))
        extra = sorted(set(b) - set(a))
        mismatched = [k for k in sorted(set(a) & set(b)) if a[k].stat().st_size != b[k].stat().st_size or sha256_file(a[k]) != sha256_file(b[k])]
        ok &= not (missing or extra or mismatched)
        results.append(
            {
                "source": rel(args.repo, source),
                "backup": backup.as_posix(),
                "files": len(a),
                "bytes": sum(p.stat().st_size for p in a.values()),
                "missing_in_backup": missing[:50],
                "extra_in_backup": extra[:50],
                "hash_mismatch": mismatched[:50],
                "verified": not (missing or extra or mismatched),
            }
        )
    data = header("verify_backup.py") | {
        "note": "备份与原件在同一块物理 SSD（C、D 盘同盘），只防误删、防覆盖，不防硬盘损坏",
        "all_verified": ok,
        "pairs": results,
    }
    out = args.out / "备份核对.json"
    write_json(out, data)
    for r in results:
        print(f"{r['source']}: {r['files']} 个文件, {r['bytes']} 字节, 一致={r['verified']}")
    if not ok:
        sys.exit(1)


if __name__ == "__main__":
    main()
