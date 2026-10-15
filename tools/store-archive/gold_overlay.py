"""阶段 3a：把识别草稿（或修正后的 plan）画到原图上，供看图核对。

输出 _cache/gold/<store_id>/overlay.png（不进 Git）：原页按 draft_gold.ts 相同的像素尺寸渲染，
叠加每 100 像素一格的坐标网格、边界（绿）、入口（红）、障碍物（橙）、道具框与编号（蓝）。
用法：python gold_overlay.py [store_id ...] [--plan]   （--plan 画修正后的 plan.json）
"""

from __future__ import annotations

import json
import math
import sys
from pathlib import Path

import pymupdf
from PIL import Image, ImageDraw, ImageFont

from common import base_args, load_json

FONT = "C:/Windows/Fonts/msyh.ttc"


def to_px(point, scale):
    k = 1000 / scale["mmPerPixel"]
    return scale["originPx"][0] + point[0] * k, scale["originPx"][1] + point[1] * k


def item_corners(item, scale):
    angle = math.radians(item["rotation"])
    hw, hd = item["w"] / 2, item["d"] / 2
    pts = []
    for dx, dz in ((-hw, -hd), (hw, -hd), (hw, hd), (-hw, hd)):
        x = item["cx"] + dx * math.cos(angle) - dz * math.sin(angle)
        z = item["cz"] + dx * math.sin(angle) + dz * math.cos(angle)
        pts.append(to_px((x, z), scale))
    return pts


def render(repo: Path, folder: Path, source_path: str, use_plan: bool) -> Path:
    draft = load_json(folder / "draft.json")
    data = load_json(folder / "plan.json") if use_plan and (folder / "plan.json").exists() else draft["draft"]
    scale = data.get("scale") or data.get("calibration_px")
    with pymupdf.open(repo / source_path) as doc:
        page = doc[draft["page"] - 1]
        zoom = draft["image"]["pdfScale"]
        pix = page.get_pixmap(matrix=pymupdf.Matrix(zoom, zoom), alpha=False)
        img = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
    img = Image.blend(img, Image.new("RGB", img.size, "white"), 0.35)
    draw = ImageDraw.Draw(img)
    small = ImageFont.truetype(FONT, 14)
    label_font = ImageFont.truetype(FONT, 16)
    for x in range(0, img.width, 100):
        draw.line([(x, 0), (x, img.height)], fill=(200, 200, 255) if x % 500 else (140, 140, 255), width=1)
        draw.text((x + 2, 2), str(x), fill=(80, 80, 200), font=small)
    for y in range(0, img.height, 100):
        draw.line([(0, y), (img.width, y)], fill=(200, 200, 255) if y % 500 else (140, 140, 255), width=1)
        draw.text((2, y + 2), str(y), fill=(80, 80, 200), font=small)
    space = data.get("space")
    if scale and space:
        poly = [to_px(p, scale) for p in space["boundary"]]
        draw.line(poly + [poly[0]], fill=(0, 170, 0), width=4)
        for e in space.get("entrances", []):
            a, b = to_px(e["a"], scale), to_px(e["b"], scale)
            draw.line([a, b], fill=(230, 0, 0), width=7)
        for o in space.get("obstacles", []):
            pts = [to_px(p, scale) for p in o["polygon"]]
            draw.polygon(pts, outline=(255, 140, 0), width=3)
    items = data.get("items") or data.get("layout", {}).get("items", [])
    if scale:
        for n, item in enumerate(items, 1):
            if item.get("source") == "outside":
                continue
            pts = item_corners(item, scale)
            draw.polygon(pts, outline=(0, 90, 230), width=3)
            cx, cy = to_px((item["cx"], item["cz"]), scale)
            draw.text((cx - 10, cy - 10), f"{n}", fill=(0, 60, 200), font=label_font)
    if scale:
        draw.text((10, img.height - 30), f"比例 {scale['mmPerPixel']:.3f} mm/px，原点 {scale['originPx']}", fill=(0, 0, 0), font=label_font)
    out = folder / ("overlay-plan.png" if use_plan else "overlay.png")
    img.save(out)
    return out


def main() -> None:
    parser = base_args(__doc__.splitlines()[0])
    parser.add_argument("stores", nargs="*")
    parser.add_argument("--plan", action="store_true")
    args = parser.parse_args()
    sources = {s["source_id"]: s["path"] for s in load_json(args.out / "来源清单.json")["sources"]}
    root = args.out / "_cache" / "gold"
    for folder in sorted(root.iterdir()):
        if args.stores and folder.name not in args.stores:
            continue
        print(render(args.repo, folder, sources[folder.name], args.plan))


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
