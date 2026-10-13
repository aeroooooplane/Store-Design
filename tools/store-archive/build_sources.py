"""阶段 0：生成 来源清单.json。

- 513 份原图纸逐个计算 SHA256、字节数、页数，核对 Git 跟踪状态；
- 沿用旧编号：PDF-001~418 取自 门店资源索引.json，NEW-006~101 取自 10-09 交接包的同步清单；
- 同内容（同 SHA256）的文件归为一份档案，编号最小的为主来源（用户指定的除外），其余记为别名；
- 登记不建档的来源（5 个 RAR / PPTX、飞书台账）及原因；
- 附旧编号对照：store-XXXX 草稿、S01 等样本号、09-23 飞书 recordId。

任何一项核对不通过就报错退出，不写出半成品。
"""

from __future__ import annotations

import csv
import re
import sys
from collections import defaultdict
from pathlib import Path

import pymupdf

from common import SOURCE_DIR, THIS_REPO, base_args, git_tracked, header, load_json, rel, sha256_file, write_json

INDEX = "资源库/00_资源索引/门店资源索引.json"
HANDOFF = "tools/data-cleaning/light-handoff-20261009-01/history/00_同步与文件清单.json"
FINAL_REVIEW = "资源库/90_处理过程与审核/数据清洗-20261009/00_文件清单_最终复核.json"
OTHER_SOURCES = "资源库/90_处理过程与审核/其他源文件"
STORES_0923 = "资源库/00_资源索引/历史目录/classification/stores.json"
SAMPLE_SET = "资源库/00_资源索引/历史目录/sample-set.csv"
PILOT_DIR = "资源库/90_处理过程与审核/训练标注"
LEDGER_NAME = "各门店图纸_SI类型与铺型.xlsx"

OTHER_REASON = "非 PDF 来源（RAR 内只有电施图 / PPTX），01 里没有这家店的 PDF；按 2026-10-12 用户答复（Q3）不建档"
LEDGER_REASON = "飞书多维表 2026-10-09 导出的下载台账，是 SI / 铺型标签来源，不是图纸；阶段 1 使用"

# 同内容文件中由用户指定的主来源：文件名 → 依据
PRIMARY_OVERRIDES = {
    "广州番禺天河城授权体验店（框架中岛）.pdf": "2026-10-13 用户指定：框架 / 无框架中岛两份内容相同，只保留框架中岛",
}


def fail(message: str) -> None:
    print(f"核对失败：{message}", file=sys.stderr)
    sys.exit(1)


def id_order(source_id: str) -> tuple[int, int]:
    prefix, number = source_id.split("-")
    return (0 if prefix == "PDF" else 1, int(number))


def page_count(path: Path) -> tuple[int | None, str | None]:
    pymupdf.TOOLS.mupdf_display_errors(False)
    try:
        with pymupdf.open(path) as doc:
            return doc.page_count, None
    except Exception as exc:  # 打不开的文件也要登记，而不是中断
        return None, repr(exc)


def main() -> None:
    args = base_args(__doc__.splitlines()[0]).parse_args()
    repo: Path = args.repo
    source_root = repo / SOURCE_DIR

    index = {item["source_file"]: item for item in load_json(repo / INDEX)["sources"]}
    handoff = {item["filename"]: item for item in load_json(repo / HANDOFF)["files"]}
    # 跟踪状态取档案所在的仓库（分支）；主仓库可能正被其他会话切到别的分支
    tracked = git_tracked(THIS_REPO, SOURCE_DIR, OTHER_SOURCES)

    pdfs = sorted(p for p in source_root.iterdir() if p.suffix.lower() == ".pdf")
    sources = []
    for path in pdfs:
        digest = sha256_file(path)
        pages, error = page_count(path)
        known = index.get(path.name)
        if known:
            if known["sha256"] != digest:
                fail(f"{path.name} 的哈希与门店资源索引不一致")
            source_id, id_origin = known["source_id"], "门店资源索引.json"
        else:
            known = handoff.get(path.name)
            if not known or not known["source_id"].startswith("NEW-"):
                fail(f"{path.name} 在门店资源索引和交接包同步清单里都没有编号")
            if known["sha256"] != digest:
                fail(f"{path.name} 的哈希与交接包同步清单不一致")
            source_id, id_origin = known["source_id"], "light-handoff 同步清单"
        sources.append(
            {
                "source_id": source_id,
                "id_origin": id_origin,
                "filename": path.name,
                "path": rel(repo, path),
                "sha256": digest,
                "bytes": path.stat().st_size,
                "page_count": pages,
                "open_error": error,
                "git_tracked": rel(repo, path) in tracked,
            }
        )

    ids = [s["source_id"] for s in sources]
    if len(ids) != len(set(ids)):
        fail("source_id 有重号")
    missing = sorted(set(index) - {s["filename"] for s in sources})
    if missing:
        fail(f"门店资源索引里有 {len(missing)} 份在 01 目录中找不到：{missing[:5]}")

    # 同内容文件归为一份档案
    groups: dict[str, list[dict]] = defaultdict(list)
    for source in sources:
        groups[source["sha256"]].append(source)
    archives = []
    for digest, members in groups.items():
        members.sort(key=lambda s: (s["filename"] not in PRIMARY_OVERRIDES, id_order(s["source_id"])))
        primary = members[0]
        for member in members:
            member["archive_source_id"] = primary["source_id"]
            member["role"] = "primary" if member is primary else "alias"
        archives.append(
            {
                "archive_source_id": primary["source_id"],
                "store_id": None,
                "sha256": digest,
                "bytes": primary["bytes"],
                "page_count": primary["page_count"],
                "filenames": [m["filename"] for m in members],
                "source_ids": [m["source_id"] for m in members],
                "primary_reason": PRIMARY_OVERRIDES.get(primary["filename"], "编号最小" if len(members) > 1 else None),
            }
        )
    archives.sort(key=lambda a: id_order(a["archive_source_id"]))

    # 不建档的来源
    excluded = []
    final_review = {f["source_id"]: f for f in load_json(repo / FINAL_REVIEW)["files"]}
    for source_id in ("NEW-001", "NEW-002", "NEW-003", "NEW-004", "NEW-005"):
        record = final_review[source_id]
        name = Path(record["path"].replace("\\", "/")).name
        path = repo / OTHER_SOURCES / name
        if not path.exists():
            fail(f"{source_id} {name} 不在 {OTHER_SOURCES}")
        if sha256_file(path) != record["sha256"]:
            fail(f"{source_id} {name} 的哈希与 10-09 最终复核清单不一致")
        excluded.append(
            {
                "source_id": source_id,
                "filename": name,
                "path": rel(repo, path),
                "format": record["format"],
                "sha256": record["sha256"],
                "bytes": path.stat().st_size,
                "git_tracked": rel(repo, path) in tracked,
                "reason": OTHER_REASON,
            }
        )
    ledger = source_root / LEDGER_NAME
    ledger_record = handoff.get(LEDGER_NAME)
    if not ledger.exists() or not ledger_record:
        fail("找不到飞书台账或它的 NEW 编号")
    excluded.append(
        {
            "source_id": ledger_record["source_id"],
            "filename": LEDGER_NAME,
            "path": rel(repo, ledger),
            "format": "xlsx",
            "sha256": sha256_file(ledger),
            "bytes": ledger.stat().st_size,
            "git_tracked": rel(repo, ledger) in tracked,
            "reason": LEDGER_REASON,
        }
    )

    # 旧编号对照
    by_name = {s["filename"]: s for s in sources}
    by_id = {s["source_id"]: s for s in sources}
    feishu = {item["id"]: item for item in load_json(repo / STORES_0923)}
    for source in sources:
        old = feishu.get(source["source_id"])
        source["legacy_ids"] = {
            "feishu_0923_record_id": old.get("recordId") if old else None,
            "pilot_store_id": None,
            "sample_id": None,
        }
    with (repo / SAMPLE_SET).open(encoding="utf-8-sig", newline="") as handle:
        for row in csv.DictReader(handle):
            name = Path(row["RelativePath"].replace("\\", "/")).name
            if name in by_name:
                by_name[name]["legacy_ids"]["sample_id"] = row["SampleId"]
    for folder in sorted((repo / PILOT_DIR).glob("store-*")):
        source_json = folder / "v1" / "source.json"
        record = load_json(source_json)
        target = by_id.get(record["source_id"])
        if not target or target["sha256"] != record["sha256"]:
            fail(f"{folder.name} 的来源 {record['source_id']} 与本机文件对不上")
        target["legacy_ids"]["pilot_store_id"] = folder.name

    summary = {
        "pdf_files": len(sources),
        "pdf_pages": sum(s["page_count"] or 0 for s in sources),
        "pdf_bytes": sum(s["bytes"] for s in sources),
        "unreadable_pdfs": sum(1 for s in sources if s["page_count"] is None),
        "unique_sha256": len(groups),
        "archives": len(archives),
        "alias_files": sum(1 for s in sources if s["role"] == "alias"),
        "git_tracked_pdfs": sum(1 for s in sources if s["git_tracked"]),
        "untracked_pdfs": sum(1 for s in sources if not s["git_tracked"]),
        "ids_from_index": sum(1 for s in sources if s["source_id"].startswith("PDF-")),
        "ids_from_handoff": sum(1 for s in sources if s["source_id"].startswith("NEW-")),
        "excluded": len(excluded),
    }
    if summary["archives"] != summary["pdf_files"] - summary["alias_files"]:
        fail("档案数与别名数对不上")

    data = header("build_sources.py") | {
        "summary": summary,
        "rules": {
            "archive": "同 SHA256 的 PDF 归为一份档案；用户指定的主来源优先，其次 PDF- 优先于 NEW-、同类取编号最小者，其余为别名（2026-10-12 用户答复 Q3；番禺 2026-10-13 指定框架中岛）",
            "store_id": "门店编号在阶段 1 写入：沿用主来源的 source_id，不另编号",
            "git_tracked": "按生成本清单的仓库分支计算；2026-10-13 起 513 份全部进 Git",
        },
        "archives": archives,
        "sources": sources,
        "excluded": excluded,
    }
    out = args.out / "来源清单.json"
    write_json(out, data)
    print(f"已写出 {out}")
    for key, value in summary.items():
        print(f"  {key}: {value}")


if __name__ == "__main__":
    main()
