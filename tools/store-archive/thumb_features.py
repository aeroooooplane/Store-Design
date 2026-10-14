"""阶段 2：只给需要的页面渲染小缩略图，算白底、彩色、深色像素比例，写到 _cache/缩略图特征.json。

只处理两类页面：大图少字的页（可能是效果图，也可能是图片型平面图）和没有可用文字的页。
平面图大多是白底细线（白底比例高），效果图颜色丰富、几乎没有纯白，用来区分两者。
"""

from __future__ import annotations

import json
import re
from concurrent.futures import ProcessPoolExecutor

import pymupdf

from common import base_args, load_json, write_json

WIDTH = 160


def wanted(p: dict) -> bool:
    text = p["text"][:800]
    normal = sum(1 for ch in text if ch.isascii() or "一" <= ch <= "鿿")
    garbled = len(text) >= 30 and normal / len(text) < 0.6
    return p["chars"] < 30 or garbled or (p["cover"] >= 0.45 and p["max_px"] >= 800_000 and p["chars"] < 600)


def scan(task):
    sid, path, pages = task
    pymupdf.TOOLS.mupdf_display_errors(False)
    out = {}
    with pymupdf.open(path) as doc:
        for number in pages:
            page = doc[number - 1]
            pix = page.get_pixmap(matrix=pymupdf.Matrix(WIDTH / page.rect.width, WIDTH / page.rect.width), colorspace=pymupdf.csRGB, alpha=False)
            data, n = pix.samples, pix.width * pix.height
            white = sat = dark = 0
            for i in range(0, len(data), 3):
                r, g, b = data[i], data[i + 1], data[i + 2]
                if r > 235 and g > 235 and b > 235:
                    white += 1
                if max(r, g, b) - min(r, g, b) > 40:
                    sat += 1
                if r + g + b < 200:
                    dark += 1
            out[number] = {"white": round(white / n, 3), "sat": round(sat / n, 3), "dark": round(dark / n, 3)}
    return sid, out


def main() -> None:
    args = base_args(__doc__.splitlines()[0]).parse_args()
    sources = load_json(args.out / "来源清单.json")
    by_id = {s["source_id"]: s for s in sources["sources"]}
    tasks = []
    with (args.out / "_cache" / "页面特征.jsonl").open(encoding="utf-8") as handle:
        for line in handle:
            item = json.loads(line)
            pages = [p["page"] for p in item["pages"] if wanted(p)]
            if pages:
                tasks.append((item["store_id"], str(args.repo / by_id[item["store_id"]]["path"]), pages))
    result = {}
    with ProcessPoolExecutor(max_workers=6) as pool:
        for sid, pages in pool.map(scan, tasks, chunksize=2):
            result[sid] = pages
    write_json(args.out / "_cache" / "缩略图特征.json", result)
    print(f"{sum(len(v) for v in result.values())} 页缩略图特征")


if __name__ == "__main__":
    main()
