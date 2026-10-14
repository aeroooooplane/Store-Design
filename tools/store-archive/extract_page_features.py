"""阶段 2：逐页提取页面分类用的特征，写到 资源库/09_门店档案/_cache/页面特征.jsonl（缓存，不进 Git）。

每页记录：文字量、去空白后的文字（截断）、大字号标题、图签区里的图号、图片覆盖率和最大图片像素；
如果是“图纸目录”页，再按坐标解析出 图号 → 图名 的条目。读文字层只要几分钟；
真正费时的看图核对只在 classify_pages.py 划出的块边界上做（用户 2026-10-14 建议：同类页面连在一起，不必逐页细看）。
"""

from __future__ import annotations

import json
import re
import statistics
import sys
from concurrent.futures import ProcessPoolExecutor

import pymupdf

from common import base_args, load_json

CODE_RE = re.compile(r"^[A-Z]{1,4}-?\d{1,3}[A-Z]?$")
NOT_CODE = re.compile(r"^(A[0-4]|M\d+|LED\d*|[A-Z]\d{3,})$")
TEXT_LIMIT = 4000


def rows_of(words):
    rows: dict[int, list] = {}
    for w in words:
        rows.setdefault(round((w[1] + w[3]) / 2 / 3), []).append(w)
    return [sorted(v, key=lambda w: w[0]) for _, v in sorted(rows.items())]


def parse_toc(page) -> list[dict]:
    """目录页：同一行里“图号 + 右侧图名”。左右两栏按 x 分开后各自按 y 排序，得到原始顺序。"""
    entries = []
    width = page.rect.width
    for row in rows_of(page.get_text("words")):
        for i, w in enumerate(row):
            if not CODE_RE.match(w[4]) or NOT_CODE.match(w[4]):
                continue
            name = []
            for v in row[i + 1 :]:
                if v[0] - w[2] > 0.22 * width or CODE_RE.match(v[4]):
                    break
                if re.match(r"^(A[0-4]|1:\d+|见图|See|the|Fig|\d{4}[.\-/]\d+[.\-/]\d+|\d+(\.\d+)?)$", v[4]):
                    break
                name.append(v[4])
            entries.append({"code": w[4].replace("-", "-"), "name": "".join(name)[:40], "x": round(w[0]), "y": round(w[1])})
    column_split = width * 0.45
    entries.sort(key=lambda e: (e["x"] > column_split, e["y"]))
    return entries


def headings(page) -> list[str]:
    spans = []
    for block in page.get_text("dict")["blocks"]:
        for line in block.get("lines", []):
            for span in line["spans"]:
                text = span["text"].strip()
                if text:
                    spans.append((span["size"], text))
    if not spans:
        return []
    median = statistics.median(s for s, _ in spans)
    big = sorted((s for s in spans if s[0] >= max(9, 1.6 * median)), key=lambda s: -s[0])
    seen, out = set(), []
    for _, text in big:
        if text not in seen:
            seen.add(text)
            out.append(text[:60])
        if len(out) >= 8:
            break
    return out


def title_codes(page) -> list[str]:
    """图签区（右侧 22% 或底部 18%）里的图号。"""
    w, h = page.rect.width, page.rect.height
    codes = []
    for x0, y0, x1, y1, word, *_ in page.get_text("words"):
        if CODE_RE.match(word) and not NOT_CODE.match(word) and (x0 > 0.78 * w or y0 > 0.82 * h):
            codes.append(word)
    return list(dict.fromkeys(codes))


def scan(task):
    source_id, path = task
    pymupdf.TOOLS.mupdf_display_errors(False)
    pages = []
    with pymupdf.open(path) as doc:
        for page in doc:
            text = page.get_text()
            flat = re.sub(r"\s+", "", text)
            area = page.rect.width * page.rect.height
            cover, max_px = 0.0, 0
            for img in page.get_images(full=True):
                try:
                    cover += sum(r.width * r.height for r in page.get_image_rects(img[0])) / area
                except Exception:
                    pass
                max_px = max(max_px, img[2] * img[3])
            is_toc = ("图纸目录" in flat or "目录" in flat[:400] or "TableofDrawings" in flat or "Chartpapercatalogue" in flat) and len(
                re.findall(r"[A-Z]{1,4}-\d{2}", flat)
            ) >= 6
            pages.append(
                {
                    "page": page.number + 1,
                    "chars": len(flat),
                    "text": flat[:TEXT_LIMIT],
                    "headings": headings(page) if flat else [],
                    "codes": title_codes(page) if flat else [],
                    "cover": round(min(cover, 3.0), 3),
                    "max_px": max_px,
                    "toc": parse_toc(page) if is_toc else None,
                    "landscape": page.rect.width >= page.rect.height,
                }
            )
    return {"store_id": source_id, "pages": pages}


def main() -> None:
    args = base_args(__doc__.splitlines()[0]).parse_args()
    sources = load_json(args.out / "来源清单.json")
    by_id = {s["source_id"]: s for s in sources["sources"]}
    tasks = [(a["archive_source_id"], str(args.repo / by_id[a["archive_source_id"]]["path"])) for a in sources["archives"]]
    out = args.out / "_cache" / "页面特征.jsonl"
    out.parent.mkdir(parents=True, exist_ok=True)
    with ProcessPoolExecutor(max_workers=6) as pool, out.open("w", encoding="utf-8", newline="\n") as handle:
        for result in pool.map(scan, tasks, chunksize=4):
            handle.write(json.dumps(result, ensure_ascii=False) + "\n")
    print(f"已写出 {out}（{len(tasks)} 份）", file=sys.stderr)


if __name__ == "__main__":
    main()
