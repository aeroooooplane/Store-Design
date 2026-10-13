"""阶段 1：逐页读取 511 份档案主来源 PDF 的文字层，提取门店标签证据。

每页记录：文字量、图签项目名（“影石-XXX”）、图签铺型字样、si1.0 / si2.0 字样、
只属于某一套 SI 的道具 / 材料名、面积读数、是否物料清单 / 材料表页。
结果写到 资源库/09_门店档案/_cache/文字证据.jsonl（缓存，不进 Git），供 build_stores.py 使用。
"""

from __future__ import annotations

import json
import re
import sys
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import pymupdf

from common import base_args, load_json

# 图签项目名：“影石-上海TPY中心”，也有不带连字符的“影石韩国首尔新村中岛店平面方案”
TITLE_RE = re.compile(r"影石\s*[-－—–]?\s*([^\n|]{2,40})")
SHOP_RE = re.compile(r"(边厅|边廳|邊廳|中岛|中島|专区|專區|半岛|半島)")
SI_RE = re.compile(r"si\s*([12])\s*\.\s*0", re.I)
# 只属于某一套 SI 的道具 / 材料（docs/si-standards-review-20261001.md、模型库 si_family）
EXCLUSIVE = {
    "SI2.0": ["徕卡", "試飛台", "试飞台", "字母凳", "子母凳", "仿水磨石"],
    "SI1.0": ["1.6米配件柜", "1.6m配件柜", "1600配件柜", "1600mm配件柜", "培训坐凳", "培訓坐凳"],
}
AREA_RE = re.compile(r"面积[^0-9\n]{0,12}?(\d{1,4}(?:\.\d{1,2})?)\s*(?:㎡|m²|m2|M2|平方米|平米)")
SHOP_NORMAL = {"边廳": "边厅", "邊廳": "边厅", "中島": "中岛", "專區": "专区", "半島": "半岛"}


def scan(task: tuple[str, str, str]) -> dict:
    source_id, filename, path = task
    pymupdf.TOOLS.mupdf_display_errors(False)
    pages = []
    with pymupdf.open(path) as doc:
        for number, page in enumerate(doc, 1):
            text = page.get_text()
            flat = re.sub(r"\s+", "", text)
            titles = [m.group(1).strip() for m in TITLE_RE.finditer(text)]
            title_shop = sorted({SHOP_NORMAL.get(m, m) for t in titles for m in SHOP_RE.findall(t)})
            bracket_shop = sorted({SHOP_NORMAL.get(m, m) for m in re.findall(r"【\s*(边厅|中岛|专区|半岛)[^】]{0,4}】", text)})
            si = sorted({f"SI{m}.0" for m in SI_RE.findall(text)})
            exclusive = {k: sorted({w for w in words if w in flat}) for k, words in EXCLUSIVE.items()}
            areas = sorted({float(m.group(1)) for m in AREA_RE.finditer(flat)})
            record = {
                "page": number,
                "chars": len(flat),
                "titles": sorted(set(titles)),
                "shop_words": sorted(set(title_shop) | set(bracket_shop)),
                "si_words": si,
                "exclusive": {k: v for k, v in exclusive.items() if v},
                "areas": [a for a in areas if 5 <= a <= 5000],
                "bom": "物料清单" in flat,
                "material": "材料表" in flat,
            }
            pages.append(record)
    return {"source_id": source_id, "filename": filename, "pages": pages}


def main() -> None:
    args = base_args(__doc__.splitlines()[0]).parse_args()
    sources = load_json(args.out / "来源清单.json")
    by_id = {s["source_id"]: s for s in sources["sources"]}
    tasks = [
        (a["archive_source_id"], by_id[a["archive_source_id"]]["filename"], str(args.repo / by_id[a["archive_source_id"]]["path"]))
        for a in sources["archives"]
    ]
    out = args.out / "_cache" / "文字证据.jsonl"
    out.parent.mkdir(parents=True, exist_ok=True)
    with ProcessPoolExecutor(max_workers=6) as pool, out.open("w", encoding="utf-8", newline="\n") as handle:
        for result in pool.map(scan, tasks, chunksize=4):
            handle.write(json.dumps(result, ensure_ascii=False) + "\n")
    print(f"已写出 {out}（{len(tasks)} 份）", file=sys.stderr)


if __name__ == "__main__":
    main()
