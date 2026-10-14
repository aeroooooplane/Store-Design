"""阶段 2：读取物料清单页（classify_pages.py 选出的页），按坐标还原表格，写到各店 bom.json 和 物料清单汇总.csv。

表头有“序号 / 具体类型 / 对应尺寸 / 数量 / 备注”五列；按表头各列的横坐标把字归列，
以“序号”列的数字为行锚点。名称映射到模型库五大类（软装道具、信息化物料、品牌标识、非标陈列、环境设施），
并列出型号候选；数量为 0 的模板行也保留。这里只有“清单数量”，平面计数在阶段 3 补上。
"""

from __future__ import annotations

import csv
import io
import json
import re
from collections import Counter, defaultdict
from pathlib import Path

import pymupdf

from common import base_args, header, load_json, write_json

MANIFEST = "资源库/04_模型库/manifest.json"
COLUMNS = {
    "no": r"^(序号|NO\.?|No\.?)$",
    "name": r"^(具体类型|SPECIFIC|名称|物料名称|项目)$",
    "size": r"^(对应尺寸|SIZE|规格|尺寸)$",
    "qty": r"^(数量|QUANTITY|Quantity|QTY)$",
    "remark": r"^(备注|REMARK|Remark)$",
}
CATEGORY_RULES = [
    ("设备（无模型）", r"摄像头|camera|Camera"),
    ("仓储（无模型）", r"货架|Shelf|shelf"),
    ("信息化物料", r"广告机|水牌|灯箱|KV|LED|屏|画面|DigitalSign|Signage|watersign|lightbox"),
    ("品牌标识", r"LOGO|logo|标识|侧招|门头字"),
    ("软装道具", r"收银|开箱|中岛|配件柜|边柜|储物|子母凳|字母凳|坐凳|高脚凳|凳|展示台|展桌|岛台|售后桌|试飞台|徕卡|品牌墙|BrandWall|brandwall|unboxing|Checkout|Counter|storage|Stool|table"),
    ("非标陈列", r"模特|橱窗|放大模型|沙发|挡板|陈列柜|沙盘"),
    ("环境设施", r"射灯|消防"),
]
T2S = str.maketrans("廣告機銀島儲徠墻攝頭邊櫃臺凳", "广告机银岛储徕墙摄头边柜台凳")


def category_of(name: str) -> str:
    name = name.translate(T2S)
    for cat, rx in CATEGORY_RULES:
        if re.search(rx, name):
            return cat
    return "未映射"


def asset_candidates(name: str, assets: list[dict]) -> list[str]:
    name = name.translate(T2S)
    si = "SI2.0" if re.search(r"si\s*2", name, re.I) else ("SI1.0" if re.search(r"si\s*1", name, re.I) else None)
    size = re.search(r"(\d(?:\.\d)?)\s*[mM米]", name)
    core = re.sub(r"si\s*\d\.\d|\d(\.\d)?\s*[mM米]|[（(].*?[)）]|\s", "", name, flags=re.I)
    out = []
    for a in assets:
        if a.get("retired"):
            continue
        label = f"{a.get('type_name') or ''}{a.get('standard_name') or ''}"
        if not core or not any(k in label for k in re.findall(r"广告机|水牌|收银|开箱|中岛桌|配件柜|边柜|储物柜|子母凳|字母凳|坐凳|展示台|试飞台|徕卡|灯箱|LOGO|模特", core)):
            continue
        if size and size.group(1) not in label:
            continue
        if si and a.get("si_family") not in (si, "通用"):
            continue
        out.append(a["asset_id"])
    return out[:3]


def read_table(page) -> list[dict] | None:
    words = page.get_text("words")
    found = defaultdict(list)
    for x0, y0, x1, y1, w, *_ in words:
        for key, rx in COLUMNS.items():
            if re.match(rx, w):
                found[key].append(((x0 + x1) / 2, y1))
    if not found["qty"]:
        return None
    # 只认和“数量”列在同一行（上下 25pt 内）的表头，避免匹配到图签里的“备注 / NO.”
    qx, qy = found["qty"][0]
    heads = {}
    for key, hits in found.items():
        near = [h for h in hits if abs(h[1] - qy) <= 25]
        if near:
            heads[key] = min(near, key=lambda h: abs(h[1] - qy))
    if "no" not in heads or "name" not in heads:
        return None
    top = max(y for _, y in heads.values())
    order = sorted(heads.items(), key=lambda kv: kv[1][0])
    bounds = [(key, (order[i - 1][1][0] + x) / 2 if i else -1e9, (x + order[i + 1][1][0]) / 2 if i + 1 < len(order) else 1e9) for i, (key, (x, _)) in enumerate(order)]

    def column(x):
        return next(key for key, lo, hi in bounds if lo <= x < hi)

    body = [w for w in words if w[1] > top]
    # 行锚点取序号的垂直中心；双语单元格的两行字分布在序号上下，所以行的分界取相邻两个序号的中点
    anchors = sorted({round((w[1] + w[3]) / 2) for w in body if column((w[0] + w[2]) / 2) == "no" and re.fullmatch(r"\d{1,2}", w[4])})
    rows = []
    for i, y in enumerate(anchors):
        lo = (anchors[i - 1] + y) / 2 if i else y - 12
        hi = (y + anchors[i + 1]) / 2 if i + 1 < len(anchors) else y + 12
        cells = defaultdict(list)
        for w in sorted(body, key=lambda w: (w[1], w[0])):
            if lo <= (w[1] + w[3]) / 2 < hi:
                cells[column((w[0] + w[2]) / 2)].append(w[4])
        name = "".join(cells["name"]).strip()
        qty_text = "".join(cells["qty"])
        qty = int(qty_text) if re.fullmatch(r"\d{1,3}", qty_text) else None
        if not name:
            continue
        rows.append({"no": int("".join(cells["no"])) if "".join(cells["no"]).isdigit() else None, "name": name, "size": "".join(cells["size"]) or None, "qty": qty, "qty_text": qty_text or None, "remark": "".join(cells["remark"]) or None})
    return rows


def main() -> None:
    args = base_args(__doc__.splitlines()[0]).parse_args()
    sources = load_json(args.out / "来源清单.json")
    by_id = {s["source_id"]: s for s in sources["sources"]}
    summary = load_json(args.out / "_cache" / "页面摘要.json")["stores"]
    assets = load_json(args.repo / MANIFEST)["assets"]
    folders = {p.name.split("__")[0]: p for p in args.out.iterdir() if p.is_dir() and "__" in p.name}
    table_rows, stats = [], Counter()
    pymupdf.TOOLS.mupdf_display_errors(False)
    for sid, info in summary.items():
        if not info["bom_pages"]:
            continue
        stats["有物料清单页"] += 1
        doc = pymupdf.open(args.repo / by_id[sid]["path"])
        items, pages_read, pages_failed = [], [], []
        for number in info["bom_pages"]:
            rows = read_table(doc[number - 1])
            if rows:
                pages_read.append(number)
                for r in rows:
                    items.append(r | {"page": number, "category": category_of(r["name"]), "si_hint": "SI2.0" if re.search(r"si\s*2", r["name"], re.I) else ("SI1.0" if re.search(r"si\s*1", r["name"], re.I) else None), "asset_candidates": asset_candidates(r["name"], assets)})
            else:
                pages_failed.append(number)
        doc.close()
        if items:
            stats["读出表格"] += 1
        totals = defaultdict(int)
        for it in items:
            if it["qty"]:
                totals[it["category"]] += it["qty"]
        data = header("read_bom.py") | {
            "store_id": sid,
            "source": "物料清单（设计方填写的数量；平面计数在阶段 3 补）",
            "pages_read": pages_read,
            "pages_failed": pages_failed,
            "items": items,
            "totals_by_category": dict(totals),
            "reviewed": False,
        }
        write_json(folders[sid] / "bom.json", data)
        for it in items:
            table_rows.append({"store_id": sid, "门店": folders[sid].name.split("__", 1)[1], "页": it["page"], "序号": it["no"], "名称": it["name"], "规格": it["size"], "数量": it["qty"] if it["qty"] is not None else it["qty_text"], "大类": it["category"], "SI": it["si_hint"], "型号候选": "、".join(it["asset_candidates"]), "备注": it["remark"]})
    buffer = io.StringIO()
    writer = csv.DictWriter(buffer, fieldnames=list(table_rows[0]), lineterminator="\r\n")
    writer.writeheader()
    writer.writerows(table_rows)
    (args.out / "物料清单汇总.csv").write_text("﻿" + buffer.getvalue(), encoding="utf-8", newline="")
    stats["行数"] = len(table_rows)
    stats["数量非空行"] = sum(1 for r in table_rows if isinstance(r["数量"], int))
    stats["未映射行"] = sum(1 for r in table_rows if r["大类"] == "未映射")
    print(json.dumps(dict(stats), ensure_ascii=False))


if __name__ == "__main__":
    main()
