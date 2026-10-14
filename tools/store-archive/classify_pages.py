"""阶段 2：页面分类与选页。读取 extract_page_features.py 的缓存，输出：

- 页面分类.jsonl：每页一行（类型、依据、图号、图名）；
- _cache/页面摘要.json：每家店的页面块、主平面页、效果图页、物料清单页，供 build_stores.py 合并进 store.json。

判定顺序：目录（图签图号对上目录条目）→ 页面大标题 → 图签“图纸名称”→ 图片特征 → 按块补齐。
图纸里同类页面是连在一起的（用户 2026-10-14 指出），前后页同类的未识别页按块补齐，看图核对只抽块边界。
"""

from __future__ import annotations

import json
import re
from collections import Counter

from common import base_args, header, load_json, write_json

LABELS = {
    "cover": "封面",
    "toc": "目录",
    "notes": "说明",
    "material": "材料表",
    "bom": "物料清单",
    "render": "效果图",
    "render_annotated": "效果图（带标注）",
    "reference": "参考图",
    "photo": "现场照片",
    "plan_original": "原始平面",
    "plan_layout": "布置平面",
    "plan_other": "其他平面图",
    "plan_generic": "平面图（类别待定）",
    "elevation": "立面",
    "detail": "大样",
    "electrical": "电气",
    "unknown_no_text": "无文字待看图",
    "unknown": "未识别",
}
# 顺序即优先级：先排除“立面索引”“天花大样”这类容易误判的名字
RULES = [
    ("bom", r"物料清单|物料表"),
    ("material", r"材料表|材料清单|Materiallist|MATERIALLIST"),
    ("toc", r"图纸目录|^目录|TableofDrawings|Chartpapercatalogue|^contents|DRAWINGLIST|DrawingList"),
    ("cover", r"^封面|^Cover|COVER"),
    ("render_annotated", r"立面标注|ELEVATIONANNOTATION|Elevationannotation"),
    ("render", r"效果图|RENDERING|Rendering|PERSPECTIVE|Perspective"),
    ("photo", r"现场图|现场照片|现场实拍|SITEPHOTO"),
    ("electrical", r"电气|配电|插座|照明|强电|弱电|监控|喇叭|点位|Socket|socket|Monitor|POWER|LIGHTING|Weakcurrent|Strongcurrent|Electrical"),
    ("notes", r"说明|NOTES|Notes|GENERALNOTES"),
    ("detail", r"大样|节点|详图|开孔|DETAIL|Detail|[桌柜台凳][平立侧]面图|Tableplan|TABLEPLAN|Tableelevation|[Cc]abinetplan|DisplayTable|[Ii]slandtable|IslandTable|[Ss]idetable"),
    ("plan_original", r"原始平面|原始结构|建筑平面|原建筑|EXISTINGPLAN|Originalfloor|ExistingPlan"),
    ("plan_layout", r"平面布置|家具布置|平面道具|道具图|FIXTUREFURNISHING|FixtureFurnishing|Floorplan|FLOORPLAN|LAYOUTPLANNING|平面方案"),
    ("plan_other", r"定位|砌墙|天花|地面铺|地坪|地面|立面索引|灯具|吊顶|Ceiling|CEILING|REFLECTEDCEIL|COMPREHENSIVE|Flooring|Elevationindex|ELEVATIONINDEX|Walllaying|尺寸图"),
    ("elevation", r"立面|ELEVATION|Elevation|外立面|展厅立面|剖面"),
    # 施工图每张平面都写“PLAN VIEW”，只有它时无法区分布置平面、天花、插座等，先记为类别待定
    ("plan_generic", r"PLANVIEW|平面图$"),
]
COMPILED = [(k, re.compile(p)) for k, p in RULES]
PRIORITY = {k: i for i, (k, _) in enumerate(RULES)}
ANNOTATION_RE = re.compile(r"不锈钢|铝板|铝复合板|色温|地砖|素色砖|软膜|发光字|收边条|钢化玻璃|乳胶漆|微水泥|水磨石|踢脚线|灯箱|Stainless|stainless|Aluminum|aluminum")
ELECTRICAL_RE = re.compile(r"插座|地插|五孔|三孔|强电|弱电|开关|配电箱|网络点|电源点|回路")


def electrical_words(text: str) -> int:
    return len(ELECTRICAL_RE.findall(text))
TITLE_RE = re.compile(r"(?:图纸名称|图名|DrawingTitle|DRAWINGTITLE|Drawingcontent|图纸内容)[:：/]?(?:DrawingTitle|DRAWINGTITLE|图纸名称)?[:：/]?(.{2,16})")
PROP_WORDS = ["中岛桌", "配件柜", "收银", "开箱", "广告机", "水牌", "灯箱", "储物柜", "展示台", "边桌", "徕卡", "试飞台", "凳", "LOGO", "主入口", "主人流"]
FLOOR_RE = re.compile(r"(L\d|LG|B\d|\d+F|[一二三四五]层|\d+层)")


T2S = str.maketrans(
    "圖紙錄電氣說樣佈畫層門樓廳島區場灣臺號樣燈飾牆統結線竣築裝修設計遠東國際購飾紡邊廣業貨陳儲櫃標識",
    "图纸录电气说样布画层门楼厅岛区场湾台号样灯饰墙统结线竣筑装修设计远东国际购饰纺边广业货陈储柜标识",
)


def type_of(name: str | None, allow_toc=False) -> str | None:
    if not name:
        return None
    flat = re.sub(r"[\s_]+", "", name.translate(T2S))
    for key, rx in COMPILED:
        if key == "toc" and not allow_toc:
            continue
        if rx.search(flat):
            return key
    return None


def garbled(page: dict) -> bool:
    """字体没有字符映射时，文字层是生僻符号：常用汉字、拉丁字母、数字所占比例很低。"""
    text = page["text"][:800]
    if len(text) < 30:
        return False
    normal = sum(1 for ch in text if ch.isascii() or "一" <= ch <= "鿿" or ch in "，。：；（）㎡²×")
    return normal / len(text) < 0.6


def with_ocr(p: dict, ocr: dict | None) -> tuple[dict, bool]:
    """没有可用文字层的页，用图签 OCR 的文字代替。"""
    if not ocr or not (p["chars"] < 30 or garbled(p)):
        return p, False
    codes = re.findall(r"[A-Z]{1,4}-\d{1,3}", ocr["text"])
    return p | {"text": ocr["text"], "headings": ocr["headings"], "chars": len(ocr["text"]), "codes": codes}, True


def classify(pages: list[dict], thumbs: dict[int, dict], ocr: dict[int, dict]) -> list[dict]:
    toc = {}
    for p in pages:
        for e in p["toc"] or []:
            if e["name"] and e["code"] not in toc:
                toc[e["code"]] = e["name"]
    out = []
    for p in pages:
        p, used_ocr = with_ocr(p, ocr.get(p["page"]))
        kind, method, code, name = None, None, None, None
        if p["toc"]:
            kind, method, name = "toc", "目录页", "图纸目录"
        if not kind:
            for c in p["codes"]:
                if c in toc and type_of(toc[c]):
                    kind, method, code, name = type_of(toc[c]), "目录", c, toc[c]
                    break
        if not kind:
            # 所有大标题和图签图名一起比较，按规则优先级取类别（“PLAN VIEW + 插座布置图”应判为电气）
            names = [(h, "标题") for h in p["headings"]]
            m = TITLE_RE.search(p["text"])
            if m:
                names.append((m.group(1), "图签图名"))
            hits = [(PRIORITY[t], t, how, n) for n, how in names if (t := type_of(n, allow_toc=True))]
            if hits:
                _, kind, method, name = min(hits)
            flat_heads = re.sub(r"[\s_]+", "", " ".join(p["headings"])).upper()
            if kind in ("plan_layout", "elevation") and "PLANVIEW" in flat_heads and "ELEVATION" in flat_heads:
                kind, method = "detail", "标题（平面+立面，道具三视图）"
        # 方案首页只有标题文字；真正的平面图哪怕文字转成了曲线，也会留下 SCALE / 比例 / PLAN VIEW 等图纸元素
        if (kind == "plan_layout" and p["page"] <= 2 and p["chars"] < 250 and not any(w in p["text"] for w in PROP_WORDS)
                and not re.search(r"SCALE|Scale|比例|PLANVIEW|1:\d", p["text"])):
            kind, method = "cover", "首页方案封面（只有标题文字）"
        if kind in (None, "plan_layout", "plan_other", "plan_original") and electrical_words(p["text"]) >= 6:
            kind, method = "electrical", "电气字样"
        thumb = thumbs.get(p["page"])
        drawing_like = thumb is not None and thumb["white"] >= 0.55
        big_picture = p["cover"] >= 0.45 and p["max_px"] >= 800_000
        if kind == "render" and method == "图片特征":
            kind = None
        if kind in (None, "render") and big_picture and p["chars"] < 600:
            if drawing_like:
                kind, method = None, None  # 图片型图纸（白底线图），不是效果图
            else:
                kind, method = "render", method or "图片特征"
        if kind == "render":
            text = p["text"]
            if re.search(r"REFERENCE|参考图|意向图|MOODBOARD", text, re.I):
                kind, method = "reference", "参考图字样"
            elif p["page"] <= 2 and p["chars"] < 120 and re.search(r"PROPOSAL|PRESENTATION|方案|封面|COVER", text):
                kind, method = "cover", "首页方案封面"
            elif re.search(r"立面标注|ANNOTATION", text, re.I) or len(ANNOTATION_RE.findall(text)) >= 3 or len(re.findall(r"\d{3,5}mm", text)) >= 3:
                # 干净效果图上最多只有“效果图 RENDERING”几个字；材质、色温、尺寸说明多的是“立面标注”
                kind, method = "render_annotated", (method or "") + "+标注文字"
        if kind == "bom" and not re.search(r"数量|QUANTITY|Quantity|QTY", p["text"]):
            kind, method = None, None  # “物料表”只是图签模板里的字段
        if not kind and garbled(p):
            p = p | {"chars": 0}
        if not kind and p["chars"] < 30 and thumb is not None and not drawing_like and thumb["sat"] >= 0.03:
            kind, method = "render", "缩略图色彩"
        if not kind:
            kind, method = ("unknown_no_text", "无文字") if p["chars"] < 30 else ("unknown", None)
        if used_ocr and method:
            method += "（OCR）"
        out.append({"page": p["page"], "type": kind, "method": method, "code": code, "name": name})
    # 按块补齐：前后最近的已识别页类型相同、且中间只隔 1–2 页时，中间的未识别页归入该块
    # （隔太远会把整份施工图误并成一块，2026-10-14 抽检发现）
    known = [i for i, r in enumerate(out) if not r["type"].startswith("unknown")]
    for a, b in zip(known, known[1:]):
        if 1 < b - a <= 3 and out[a]["type"] == out[b]["type"]:
            for i in range(a + 1, b):
                out[i] |= {"type": out[a]["type"], "method": "块推断"}
    if out and out[0]["type"].startswith("unknown") and pages[0]["chars"] < 400:
        out[0] |= {"type": "cover", "method": "首页"}
    return out


def blocks(rows: list[dict]) -> list[dict]:
    result = []
    for r in rows:
        if result and result[-1]["type"] == r["type"] and result[-1]["to"] == r["page"] - 1:
            result[-1]["to"] = r["page"]
        else:
            result.append({"type": r["type"], "label": LABELS[r["type"]], "from": r["page"], "to": r["page"]})
    return result


def pick_main_plan(rows, pages):
    def score(i):
        text = pages[i]["text"]
        props = sum(text.count(w) for w in PROP_WORDS)
        dims = len(re.findall(r"(?<!\d)\d{3,5}(?!\d)", text))
        return props * 2 + min(dims, 60) * 0.5 - electrical_words(text) * 3
    cands = [i for i, r in enumerate(rows) if r["type"] == "plan_layout"]
    note = None
    if not cands:
        # 标准施工图编号：P-01 / PL-01 原始平面，P-02 / PL-02 平面布置图（多份目录核对过）
        coded = [i for i, r in enumerate(rows) if r["type"] == "plan_generic" and any(re.fullmatch(r"PL?-0?2", c) for c in pages[i]["codes"])]
        if coded:
            return rows[coded[0]]["page"], [], "按图号 P-02 / PL-02 推断为平面布置图（标题文字不可读）", []
        cands = [i for i, r in enumerate(rows) if r["type"] == "plan_generic" and sum(pages[i]["text"].count(w) for w in PROP_WORDS) >= 3]
        note = "只有通用“PLAN VIEW”标题，取道具标注最多的一页" if cands else None
    if not cands:
        cands = [i for i, r in enumerate(rows) if r["type"] in ("plan_original", "plan_other") and sum(pages[i]["text"].count(w) for w in PROP_WORDS) >= 3]
        note = "没有“布置平面”页，取道具标注最多的其他平面图" if cands else note
    if not cands:
        no_text = sum(1 for r in rows if r["type"] == "unknown_no_text")
        reason = "整份没有文字层，需看图选页" if no_text == len(rows) else ("有无文字页，需看图确认" if no_text else "没有找到平面布置图")
        return None, [], reason, []
    ranked = sorted(cands, key=lambda i: (-score(i), i))
    floors = sorted({m for i in cands for m in FLOOR_RE.findall(" ".join(pages[i]["headings"]) + (rows[i]["name"] or ""))})
    return rows[ranked[0]]["page"], [rows[i]["page"] for i in ranked[1:6]], note, floors


def main() -> None:
    args = base_args(__doc__.splitlines()[0]).parse_args()
    features = {}
    with (args.out / "_cache" / "页面特征.jsonl").open(encoding="utf-8") as handle:
        for line in handle:
            item = json.loads(line)
            features[item["store_id"]] = item["pages"]
    thumbs = {}
    thumb_path = args.out / "_cache" / "缩略图特征.json"
    if thumb_path.exists():
        thumbs = {sid: {int(k): v for k, v in pages.items()} for sid, pages in load_json(thumb_path).items()}
    ocr_text = {}
    ocr_path = args.out / "_cache" / "OCR文字.json"
    if ocr_path.exists():
        ocr_text = {sid: {int(k): v for k, v in pages.items()} for sid, pages in load_json(ocr_path).items()}
    override_path = args.out / "阶段2看图选页.json"
    overrides = {r["store_id"]: r for r in load_json(override_path)["rows"]} if override_path.exists() else {}
    lines, summary = [], {}
    type_count = Counter()
    for sid, pages in features.items():
        rows = classify(pages, thumbs.get(sid, {}), ocr_text.get(sid, {}))
        type_count.update(r["type"] for r in rows)
        for r in rows:
            lines.append(json.dumps({"store_id": sid} | r | {"label": LABELS[r["type"]]}, ensure_ascii=False))
        main_plan, alternatives, note, floors = pick_main_plan(rows, pages)
        if sid in overrides:  # 阶段2看图选页.json：人工看图的结论优先
            main_plan, note = overrides[sid]["main_plan_page"], overrides[sid]["note"]
        summary[sid] = {
            "blocks": blocks(rows),
            "toc_found": any(p["toc"] for p in pages),
            "main_plan_page": main_plan,
            "plan_alternatives": alternatives,
            "main_plan_note": note,
            "plan_floor_tags": floors,
            "render_pages": [r["page"] for r in rows if r["type"] == "render"],
            "render_annotated_pages": [r["page"] for r in rows if r["type"] == "render_annotated"],
            "bom_pages": [r["page"] for r in rows if r["type"] == "bom"],
            "material_pages": [r["page"] for r in rows if r["type"] == "material"],
            "no_text_pages": sum(1 for r in rows if r["type"] == "unknown_no_text"),
            "unknown_pages": sum(1 for r in rows if r["type"] == "unknown"),
        }
    (args.out / "页面分类.jsonl").write_text("\n".join(lines) + "\n", encoding="utf-8", newline="\n")
    stats = {
        "pages": sum(type_count.values()),
        "by_type": {LABELS[k]: v for k, v in type_count.most_common()},
        "stores": len(summary),
        "with_main_plan": sum(1 for s in summary.values() if s["main_plan_page"]),
        "with_render": sum(1 for s in summary.values() if s["render_pages"]),
        "with_bom": sum(1 for s in summary.values() if s["bom_pages"]),
        "with_toc": sum(1 for s in summary.values() if s["toc_found"]),
        "multi_floor_tags": sum(1 for s in summary.values() if len(s["plan_floor_tags"]) > 1),
    }
    write_json(args.out / "_cache" / "页面摘要.json", header("classify_pages.py") | {"stats": stats, "stores": summary})
    print(json.dumps(stats, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
