"""阶段 3a：按原像素（与 draft_gold.ts 相同尺寸）裁出平面区域，叠加 50 像素网格，供读取坐标。

输出 _cache/gold/<store_id>/crop-<x0>-<y0>.png（不进 Git）。坐标标注就是原图像素，可直接写进 edits.json。
用法：python gold_crop.py <store_id> <x0> <y0> <x1> <y1> [--step 50]
"""

from __future__ import annotations

import sys

import pymupdf
from PIL import Image, ImageDraw, ImageFont

from common import base_args, load_json

FONT = "C:/Windows/Fonts/msyh.ttc"


def main() -> None:
    parser = base_args(__doc__.splitlines()[0])
    parser.add_argument("store")
    parser.add_argument("box", nargs=4, type=int)
    parser.add_argument("--step", type=int, default=50)
    args = parser.parse_args()
    folder = args.out / "_cache" / "gold" / args.store
    draft = load_json(folder / "draft.json")
    sources = {s["source_id"]: s["path"] for s in load_json(args.out / "来源清单.json")["sources"]}
    x0, y0, x1, y1 = args.box
    zoom = draft["image"]["pdfScale"]
    with pymupdf.open(args.repo / sources[args.store]) as doc:
        page = doc[draft["page"] - 1]
        clip = pymupdf.Rect(x0 / zoom, y0 / zoom, x1 / zoom, y1 / zoom)
        pix = page.get_pixmap(matrix=pymupdf.Matrix(zoom, zoom), clip=clip, alpha=False)
    img = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
    draw = ImageDraw.Draw(img)
    font = ImageFont.truetype(FONT, 12)
    step = args.step
    for x in range((x0 // step + 1) * step, x1, step):
        major = x % (step * 2) == 0
        draw.line([(x - x0, 0), (x - x0, img.height)], fill=(150, 150, 255) if major else (215, 215, 255), width=1)
        if major:
            draw.text((x - x0 + 2, 2), str(x), fill=(60, 60, 220), font=font)
    for y in range((y0 // step + 1) * step, y1, step):
        major = y % (step * 2) == 0
        draw.line([(0, y - y0), (img.width, y - y0)], fill=(150, 150, 255) if major else (215, 215, 255), width=1)
        if major:
            draw.text((2, y - y0 + 2), str(y), fill=(60, 60, 220), font=font)
    out = folder / f"crop-{x0}-{y0}.png"
    img.save(out)
    print(out, img.size)


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
