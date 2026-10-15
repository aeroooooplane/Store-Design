"""阶段 3a：把看图修正记录（_cache/gold/<id>/edits.json，原图像素坐标）换算成金标准 plan.json。

- 比例：edits.scale.checks 里每条尺寸（两端像素 + 图上毫米）各算一次毫米/像素，取平均，记录每条误差；
  两个方向都要有核对，误差超过 1% 的标出来。
- 坐标：以 edits.origin_px 为原点，单位米，x 向右、z 向下（与工作台 SpaceSchema 一致）。
- 道具：box 是图上占地框，facing 是正面朝向（down / left / up / right → rotation 0 / 90 / 180 / 270，
  与工作台“90° 时正面 +Z 转向 −X”一致）。能对上模型库型号的，宽深高用型号尺寸，并记录与图上框的偏差。
- 输出：资源库/09_门店档案/<id>__<店名>/plan.json（进 Git），以及 _cache/gold/<id>/plan.json（供叠加图使用）。
用法：python build_gold.py [store_id ...]
"""

from __future__ import annotations

import json
import re
import sys
from collections import Counter
from pathlib import Path

from common import base_args, header, load_json, write_json

MANIFEST = "资源库/04_模型库/manifest.json"
FACING = {"down": 0, "left": 90, "up": 180, "right": 270}
SYMMETRIC = {"island_table", "display_stand", "seating", "unboxing_table"}
FUNCTION_RULES = [
    (r"收银", "cashier"),
    (r"开箱", "unboxing_table"),
    (r"中岛", "island_table"),
    (r"配件边柜|边桌配件柜", "side_cabinet"),
    (r"配件柜", "accessory_cabinet"),
    (r"储物柜", "storage"),
    (r"展示台|试飞台|展桌", "display_stand"),
    (r"凳|沙发", "seating"),
    (r"广告机|屏|水牌", "screen"),
    (r"LOGO|logo|画面|灯箱|侧招|标识|slogan|slogon|徕卡", "signage"),
]
KEYWORDS = ["中岛桌", "开箱桌", "收银台", "收银桌", "收银边柜", "边桌收银柜", "配件边柜", "边桌配件柜", "边桌储物柜", "储物边柜", "储物柜", "配件柜", "徕卡墙", "试飞台", "展示台", "字母凳", "子母凳", "培训坐凳", "电子水牌", "广告机", "灯箱"]


def function_of(label: str) -> str:
    return next((f for rx, f in FUNCTION_RULES if re.search(rx, label)), "other")


def match_asset(label: str, si: str, assets: list[dict]) -> dict | None:
    """按名称关键词 + 尺寸 / 寸数 + 横竖屏 + SI 在模型库里找型号；找不到返回 None（只记原文）。"""
    keys = [k for k in KEYWORDS if k in label]
    if not keys:
        return None
    size = re.search(r"(\d(?:\.\d)?)\s*[米mM]", label)
    inch = re.search(r"(\d{2})\s*寸", label)
    orient = "横屏" if re.search(r"横向|横版|横屏", label) else ("竖屏" if re.search(r"竖向|竖版|竖屏", label) else None)
    best = None
    for a in assets:
        if a.get("retired"):
            continue
        type_name = a.get("type_name") or ""
        name = f"{type_name}{a.get('standard_name') or ''}{a.get('variant') or ''}"
        if not any(k in name or k.replace("子母", "字母") in name for k in keys):
            continue
        if a.get("si_family") not in (si, "通用", None):
            continue
        if size and size.group(1) + "米" not in name and size.group(1) + "m" not in name and str(int(float(size.group(1)) * 1000)) not in name:
            continue
        if inch and inch.group(1) + "寸" not in name:
            continue
        if orient and orient not in name:
            continue
        score = 1 + (2 if type_name and type_name in label else 0) + (1 if a.get("si_family") == si else 0)
        if not best or score > best[0]:
            best = (score, a)
    return best[1] if best else None


def main() -> None:
    parser = base_args(__doc__.splitlines()[0])
    parser.add_argument("stores", nargs="*")
    args = parser.parse_args()
    assets = load_json(args.repo / MANIFEST)["assets"]
    by_id = {a["asset_id"]: a for a in assets}
    folders = {p.name.split("__")[0]: p for p in args.out.iterdir() if p.is_dir() and "__" in p.name}
    stores = {s["store_id"]: s for s in load_json(args.out / "门店总表.json")["stores"]}
    for gold_dir in sorted((args.out / "_cache" / "gold").iterdir()):
        sid = gold_dir.name
        if args.stores and sid not in args.stores:
            continue
        edits_path = gold_dir / "edits.json"
        if not edits_path.exists():
            continue
        edits = load_json(edits_path)
        draft = load_json(gold_dir / "draft.json")
        si = stores[sid]["SI"]

        checks = []
        for c in edits["scale"]["checks"]:
            px = abs(c["px"][1] - c["px"][0])
            checks.append(c | {"mm_per_px": c["mm"] / px})
        mmpp = sum(c["mm_per_px"] for c in checks) / len(checks)
        for c in checks:
            c["error_pct"] = round((c["mm_per_px"] - mmpp) / mmpp * 100, 2)
            c["mm_per_px"] = round(c["mm_per_px"], 4)
        axes = {c["axis"] for c in checks}
        ox, oz = edits["origin_px"]

        def m(p):
            return [round((p[0] - ox) * mmpp / 1000, 3), round((p[1] - oz) * mmpp / 1000, 3)]

        def box_poly(b):
            return [m((b[0], b[1])), m((b[2], b[1])), m((b[2], b[3])), m((b[0], b[3]))]

        space = {
            "schemaVersion": 1,
            "boundary": [m(p) for p in edits["boundary_px"]],
            "height": edits.get("height_m") or 3.0,
            "entrances": [{"kind": e["kind"], "a": m(e["a"]), "b": m(e["b"])} for e in edits.get("entrances_px", [])],
            "openEdges": [{"a": m(e["a"]), "b": m(e["b"])} for e in edits.get("open_edges_px", [])],
            "obstacles": [
                {"kind": o["kind"], "polygon": box_poly(o["box"]) if "box" in o else [m(p) for p in o["polygon"]], "height": None, "label": o.get("label")}
                for o in edits.get("obstacles_px", [])
            ],
            "calibration": {
                "method": "dimension",
                "reference": "；".join(f"{c['axis']} 向 {c['mm']} mm = {abs(c['px'][1] - c['px'][0])} px" for c in checks),
                "verified": axes >= {"x", "z"} and all(abs(c["error_pct"]) <= 1 for c in checks),
            },
        }
        items = []
        for n, it in enumerate(edits["items"], 1):
            x0, y0, x1, y1 = it["box"]
            rotation = FACING[it.get("facing", "down")]
            along_x = (x1 - x0) * mmpp / 1000
            along_z = (y1 - y0) * mmpp / 1000
            drawn_w, drawn_d = (along_x, along_z) if rotation in (0, 180) else (along_z, along_x)
            func = None
            asset = by_id.get(it["asset"]) if it.get("asset") not in (None, "auto") else (match_asset(it["label"], si, assets) if it.get("asset") == "auto" or "asset" not in it else None)
            note = it.get("note")
            if asset and "组合" in (asset.get("variant") or "") and along_x * along_z < 0.5 * asset["tight_face_bounds_xyz_mm"][0] * asset["tight_face_bounds_xyz_mm"][1] / 1e6:
                # 模型库只有多件组合款（如 4 件培训坐凳），图上是单件：不配型号，按单件计数
                note = "；".join(x for x in (note, f"模型库只有组合款 {asset['asset_id']}（{asset.get('variant')}），按单件记") if x)
                asset = None
            if asset:
                fw, fd, fh = (v / 1000 for v in asset["tight_face_bounds_xyz_mm"])
            func = it.get("function") or function_of(it["label"])
            if asset and func in SYMMETRIC:
                # 没有正面的道具（中岛桌等）：按型号尺寸选与图上一致的方向（0° 或 90°）
                # 只比横向长度：有的型号（开箱桌）尺寸含两侧凳子，进深不能拿来比
                fits0 = abs(along_x - fw)
                fits90 = abs(along_x - fd)
                rotation = 0 if fits0 <= fits90 else 90
                drawn_w, drawn_d = (along_x, along_z) if rotation == 0 else (along_z, along_x)
            w, d = (round(fw, 3), round(fd, 3)) if asset else (round(drawn_w, 3), round(drawn_d, 3))
            h = round(fh, 3) if asset else it.get("h")
            items.append(
                {
                    "ref": f"g{n:02d}",
                    "label": it["label"],
                    "assetId": asset["asset_id"] if asset else None,
                    "function": func,
                    "category": asset["category"] if asset else it.get("category"),
                    "source": it.get("source", "new"),
                    "cx": round(((x0 + x1) / 2 - ox) * mmpp / 1000, 3),
                    "cz": round(((y0 + y1) / 2 - oz) * mmpp / 1000, 3),
                    "w": w,
                    "d": d,
                    "h": h,
                    "rotation": rotation,
                    "drawn_size_m": [round(drawn_w, 3), round(drawn_d, 3)],
                    "size_deviation_m": [round(drawn_w - w, 3), round(drawn_d - d, 3)] if asset else None,
                    "mount": it.get("mount", "floor"),
                    "note": note,
                }
            )
        xs = [p[0] for p in space["boundary"]]
        zs = [p[1] for p in space["boundary"]]
        area = 0.0
        pts = space["boundary"]
        for i in range(len(pts)):
            x1_, z1_ = pts[i]
            x2_, z2_ = pts[(i + 1) % len(pts)]
            area += x1_ * z2_ - x2_ * z1_
        plan = header("build_gold.py") | {
            "store_id": sid,
            "name": stores[sid]["门店"],
            "si": si,
            "shop_type": stores[sid]["铺型"],
            "source": {"page": draft["page"], "image_px": [draft["image"]["width"], draft["image"]["height"]], "pdf_scale": draft["image"]["pdfScale"]},
            "calibration_px": {"mmPerPixel": round(mmpp, 4), "originPx": [ox, oz], "checks": checks},
            "space": space,
            "layout": {"items": items},
            "summary": {
                "boundary_area_m2": round(abs(area) / 2, 2),
                "stated_area_m2": edits.get("stated_area_m2"),
                "outer_size_m": [round(max(xs) - min(xs), 2), round(max(zs) - min(zs), 2)],
                "height_source": edits.get("height_source"),
                "counts_by_function": dict(Counter(i["function"] for i in items)),
                "counts_by_category": dict(Counter(i["category"] or "未映射" for i in items)),
                "matched_assets": sum(1 for i in items if i["assetId"]),
            },
            "review": {"status": "待用户确认", "checked_by": "Claude（看原图逐项修正）", "notes": edits.get("notes", [])},
        }
        write_json(gold_dir / "plan.json", plan)
        write_json(folders[sid] / "plan.json", plan)
        s = plan["summary"]
        print(f"{sid} 比例 {mmpp:.4f} mm/px（{'、'.join(f'{c['axis']}{c['error_pct']:+.2f}%' for c in checks)}）面积 {s['boundary_area_m2']} ㎡（图注 {s['stated_area_m2']}）道具 {len(items)}，对上型号 {s['matched_assets']}")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
