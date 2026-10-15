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
import math
import re
import sys
from collections import Counter
from pathlib import Path

from common import base_args, header, load_json, write_json

MANIFEST = "资源库/04_模型库/manifest.json"
FACING_FILE = "资源库/04_模型库/facing.json"
FACING = {"down": 0, "left": 90, "up": 180, "right": 270}
# 型号正面（facing.json，GLB 自身坐标）→ 旋转补偿：与工作台 orientation.ts 的 facingAfter 一致，
# +Z 正面的型号转 rotation 后正面朝 FACING 方向；+X 正面的型号要多转 90°，依此类推
FRONT_OFFSET = {"+Z": 0, "+X": 90, "-Z": 180, "-X": 270}
SYMMETRIC = {"island_table", "display_stand", "seating", "unboxing_table"}
# 开箱桌桌体（型号尺寸含凳子；用户 2026-10-15：碰撞与标注按桌体）：型号坐标下的桌体宽、深与桌体中心 x 偏移（米），
# 由白模量出，与工作台窗口核对一致
UNBOX_BODY = {
    "asset-1788391": (1.8, 1.0, 0.0),
    "asset-41277543": (1.8, 0.8, 0.0),
    "asset-16469753": (1.8, 0.8, 0.0),
    "asset-666964": (0.5, 1.8, -0.284),
}
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


def asset_size(asset):
    return tuple(v / 1000 for v in asset["tight_face_bounds_xyz_mm"])


def box_item(it, asset, func, mmpp, ox, oz, fronts):
    """落地道具：图上占地框 + 正面朝向（下 / 左 / 上 / 右，指道具在店里真实的顾客面）。
    有型号时按 facing.json 的型号正面换算 rotation；没有正面（any）的对称道具按横向长度选 0° 或 90°。
    开箱桌按桌体：w、d 取桌体，框中心即桌体中心，另记型号原点 model_origin_m（凳子在一侧时与桌体中心不同）。"""
    x0, y0, x1, y1 = it["box"]
    facing = FACING[it.get("facing", "down")]
    rotation = facing
    along_x = (x1 - x0) * mmpp / 1000
    along_z = (y1 - y0) * mmpp / 1000
    out = {}
    if asset and "组合" in (asset.get("variant") or "") and along_x * along_z < 0.5 * asset["tight_face_bounds_xyz_mm"][0] * asset["tight_face_bounds_xyz_mm"][1] / 1e6:
        out["drop_asset"] = True
        asset = None
    body = UNBOX_BODY.get(asset["asset_id"]) if asset else None
    front = fronts.get(asset["asset_id"], {}).get("front") if asset else None
    if asset:
        fw, fd, fh = asset_size(asset)
        bw, bd = body[:2] if body else (fw, fd)
        if front in FRONT_OFFSET:
            rotation = (facing + FRONT_OFFSET[front]) % 360
        elif func in SYMMETRIC or front == "any":
            # 没有正面的道具：只比横向长度选 0° 或 90°
            rotation = 0 if abs(along_x - bw) <= abs(along_x - bd) else 90
            facing = None
    drawn_w, drawn_d = (along_x, along_z) if rotation in (0, 180) else (along_z, along_x)
    if body:
        w, d, h = bw, bd, round(fh, 3)
        out["body_only"] = True
        if body[2]:
            a = math.radians(rotation)
            out["model_origin_m"] = [round(((x0 + x1) / 2 - ox) * mmpp / 1000 - body[2] * math.cos(a), 3),
                                     round(((y0 + y1) / 2 - oz) * mmpp / 1000 - body[2] * math.sin(a), 3)]
    elif asset:
        w, d, h = round(fw, 3), round(fd, 3), round(fh, 3)
    else:
        w, d, h = round(drawn_w, 3), round(drawn_d, 3), it.get("h")
    return out | {
        "cx": round(((x0 + x1) / 2 - ox) * mmpp / 1000, 3),
        "cz": round(((y0 + y1) / 2 - oz) * mmpp / 1000, 3),
        "w": w, "d": d, "h": h, "rotation": rotation, "facing": facing,
        "drawn_size_m": [round(drawn_w, 3), round(drawn_d, 3)],
        "size_deviation_m": [round(drawn_w - w, 3), round(drawn_d - d, 3)] if asset else None,
    }


DIRS = {"down": (0, 1), "up": (0, -1), "left": (-1, 0), "right": (1, 0)}


def wall_item(it, asset, mmpp, ox, oz, fronts):
    """沿墙道具：on_wall.a→b 是它在墙面线上占的那一段（原图像素），front 是正面的大致方向。
    内嵌（mount=embedded）：正面落在墙面线上，机身在墙内；贴墙 / 落地靠墙：机身在墙面线前方；
    门头（location=facade）：front 朝店外，机身在边界外。任意角度的斜墙按真实角度记。"""
    (ax, ay), (bx, by) = it["on_wall"]["a"], it["on_wall"]["b"]
    length = math.hypot(bx - ax, by - ay)
    tx, ty = (bx - ax) / length, (by - ay) / length
    want = DIRS[it["on_wall"]["front"]]
    normals = [(-ty, tx), (ty, -tx)]
    fx, fy = max(normals, key=lambda n: n[0] * want[0] + n[1] * want[1])
    facing = round(math.degrees(math.atan2(-fx, fy)) % 360, 1)
    front = fronts.get(asset["asset_id"], {}).get("front") if asset else None
    rotation = round((facing + FRONT_OFFSET.get(front, 0)) % 360, 1)
    if asset:
        w, d, h = (round(v, 3) for v in asset_size(asset))
    else:
        w, d, h = round(length * mmpp / 1000, 3), it.get("d_mm", 50) / 1000, it.get("h")
    sign = -1 if it.get("mount") == "embedded" else 1
    mx, my = (ax + bx) / 2, (ay + by) / 2
    cx = (mx - ox) * mmpp / 1000 + sign * fx * d / 2
    cz = (my - oz) * mmpp / 1000 + sign * fy * d / 2
    return {
        "cx": round(cx, 3), "cz": round(cz, 3), "w": w, "d": d, "h": h, "rotation": rotation, "facing": facing,
        "drawn_size_m": [round(length * mmpp / 1000, 3), None],
        "size_deviation_m": [round(length * mmpp / 1000 - w, 3), None] if asset else None,
        "wall_segment_m": [[round((ax - ox) * mmpp / 1000, 3), round((ay - oz) * mmpp / 1000, 3)], [round((bx - ox) * mmpp / 1000, 3), round((by - oz) * mmpp / 1000, 3)]],
    }


def main() -> None:
    parser = base_args(__doc__.splitlines()[0])
    parser.add_argument("stores", nargs="*")
    args = parser.parse_args()
    assets = load_json(args.repo / MANIFEST)["assets"]
    by_id = {a["asset_id"]: a for a in assets}
    fronts = load_json(args.repo / FACING_FILE)["assets"]
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
            asset = by_id.get(it["asset"]) if it.get("asset") not in (None, "auto") else (match_asset(it["label"], si, assets) if it.get("asset") == "auto" or "asset" not in it else None)
            note = it.get("note")
            func = it.get("function") or function_of(it["label"])
            mount = {"hanging": "ceiling"}.get(it.get("mount", "floor"), it.get("mount", "floor"))
            location = it.get("location", "interior")
            if "on_wall" in it:
                item = wall_item(it, asset, mmpp, ox, oz, fronts)
            else:
                item = box_item(it, asset, func, mmpp, ox, oz, fronts)
            if item.pop("drop_asset", False):
                note = "；".join(x for x in (note, f"模型库只有组合款 {asset['asset_id']}（{asset.get('variant')}），按单件记") if x)
                asset = None
            if item.pop("body_only", False):
                note = "；".join(x for x in (note, "型号尺寸含凳子；碰撞与尺寸标注按桌体") if x)
            items.append(
                {
                    "ref": f"g{n:02d}",
                    "label": it["label"],
                    "assetId": asset["asset_id"] if asset else None,
                    "function": func,
                    "category": asset["category"] if asset else it.get("category"),
                    "source": it.get("source", "new"),
                    **item,
                    "mount": mount,  # floor / wall / embedded / ceiling，与工作台 #90 一致
                    "elevation": it.get("elevation_mm") / 1000 if it.get("elevation_mm") is not None else None,  # 离地高度（米），平面图读不出时为 null
                    "location": location,
                    # 内嵌和贴墙的信息化物料、画面：三维只在墙面贴一张画面，不做实体
                    "render_as": "wall_image" if mount in ("embedded", "wall") and func in ("screen", "signage") else "model",
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
            # 硬装（设计新做的空心包墙、隔墙等）：门店边界仍按原有实墙，包墙另记一层
            "hardscape": [
                {"kind": h["kind"], "polygon": box_poly(h["box"]) if "box" in h else [m(p) for p in h["polygon"]], "label": h.get("label")}
                for h in edits.get("hardscape_px", [])
            ],
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
