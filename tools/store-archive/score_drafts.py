"""阶段 3a：用金标准给工作台本地识别的草稿打分，供识别改进前后对比。

对每家已有 plan.json（金标准）的门店，比较同目录 draft.json（draft_gold.ts 用当前分支的识别代码生成）：
- 失败原因；比例误差（草稿 mm/px ÷ 金标准 − 1）；
- 边界 IoU：两条边界都换回原图像素后按面积比（与比例无关，只看形状和位置）；
- 道具：金标准每件道具在 0.6 m 内找最近的草稿道具（一对一），记位置命中数；有型号的再看 assetId 是否一致。
输出逐店结果和汇总到 _cache/识别打分.json。
用法：先在要评估的分支跑 node tools/store-archive/draft_gold.ts，再 python score_drafts.py [store_id ...]
"""

from __future__ import annotations

import math
import statistics
import sys

import numpy as np
from PIL import Image, ImageDraw

from common import base_args, load_json, write_json

HIT_M = 0.6


def mask(size, points) -> np.ndarray:
    img = Image.new("1", size, 0)
    ImageDraw.Draw(img).polygon(points, fill=1)
    return np.array(img)


def score(plan: dict, draft: dict) -> dict:
    dr = draft["draft"]
    size = (int(draft["image"]["width"]), int(draft["image"]["height"]))
    gc = plan["calibration_px"]
    gk = 1000 / gc["mmPerPixel"]

    def gpx(p):
        return (gc["originPx"][0] + p[0] * gk, gc["originPx"][1] + p[1] * gk)

    out = {"store_id": plan["store_id"], "failure": draft["failure"], "gold_items": len(plan["layout"]["items"]),
           "gold_with_asset": sum(1 for i in plan["layout"]["items"] if i["assetId"])}
    sc = dr.get("scale")
    if not sc or not (dr.get("space") or {}).get("boundary"):
        return out
    dk = 1000 / sc["mmPerPixel"]

    def dpx(p):
        return (sc["originPx"][0] + p[0] * dk, sc["originPx"][1] + p[1] * dk)

    g = mask(size, [gpx(p) for p in plan["space"]["boundary"]])
    d = mask(size, [dpx(p) for p in dr["space"]["boundary"]])
    items = [i for i in dr["items"] if i.get("source") != "outside"]
    used, hit, asset_ok = set(), 0, 0
    for gi in plan["layout"]["items"]:
        gx, gy = gpx((gi["cx"], gi["cz"]))
        best = None
        for n, di in enumerate(items):
            if n in used:
                continue
            x, y = dpx((di["cx"], di["cz"]))
            dist = math.hypot(x - gx, y - gy) * gc["mmPerPixel"] / 1000
            if dist < HIT_M and (best is None or dist < best[0]):
                best = (dist, n, di)
        if best:
            used.add(best[1])
            hit += 1
            asset_ok += bool(gi["assetId"] and best[2].get("assetId") == gi["assetId"])
    return out | {
        "scale_error": round(sc["mmPerPixel"] / gc["mmPerPixel"] - 1, 4),
        "boundary_iou": round(float((g & d).sum() / max((g | d).sum(), 1)), 3),
        "draft_items": len(items), "position_hits": hit, "asset_hits": asset_ok,
    }


def main() -> None:
    parser = base_args(__doc__.splitlines()[0])
    parser.add_argument("stores", nargs="*")
    args = parser.parse_args()
    rows = []
    for folder in sorted((args.out / "_cache" / "gold").iterdir()):
        if (args.stores and folder.name not in args.stores) or not (folder / "plan.json").exists():
            continue
        rows.append(score(load_json(folder / "plan.json"), load_json(folder / "draft.json")))
    done = [r for r in rows if "scale_error" in r]
    summary = {
        "stores": len(rows),
        "failed": len(rows) - len(done),
        "scale_within_1pct": sum(abs(r["scale_error"]) <= 0.01 for r in done),
        "boundary_iou_median": round(statistics.median(r["boundary_iou"] for r in done), 3) if done else None,
        "position_hits": f"{sum(r['position_hits'] for r in done)}/{sum(r['gold_items'] for r in done)}",
        "asset_hits": f"{sum(r['asset_hits'] for r in done)}/{sum(r['gold_with_asset'] for r in done)}",
    }
    for r in rows:
        if "scale_error" in r:
            print(f"{r['store_id']} 比例 {r['scale_error']:+.1%} 边界IoU {r['boundary_iou']:.2f} "
                  f"道具位置 {r['position_hits']}/{r['gold_items']} 型号 {r['asset_hits']}/{r['gold_with_asset']}")
        else:
            print(f"{r['store_id']} 失败：{r['failure']}")
    print("汇总", summary)
    write_json(args.out / "_cache" / "识别打分.json", {"summary": summary, "stores": rows})


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
