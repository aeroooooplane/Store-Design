"""阶段 1：生成门店总表、各店 store.json 和 冲突与待确认.csv。

每份档案（主来源 source_id 即 store_id）合并四类证据：
- 飞书台账 2026-10-09（SI / 铺型初值，按“本地文件名”匹配）；
- 飞书快照 2026-09-23（对照，只覆盖最初 418 份）；
- 文件名（括号里的铺型、渠道类型、国内 / 海外）；
- 图纸文字层（extract_text_evidence.py 的缓存）：si 字样为强证据，SI 专属道具 / 材料名为弱证据（只记录，不判冲突）；
  图签铺型字样只取图签店名与本店一致的页（模板页可能是从别的店复制的，见方案 1.7）。

城市、商场、楼层、商场组、关联门店按 2026-10-13 用户答复推迟，字段留 null。
面积只收集候选读数，多个读数在阶段 3 用平面几何校核，不进本阶段冲突清单。
"""

from __future__ import annotations

import csv
import io
import json
import re
import zipfile
import xml.etree.ElementTree as ET
from collections import Counter
from pathlib import Path

from common import SOURCE_DIR, base_args, header, load_json, write_json

LEDGER = f"{SOURCE_DIR}/各门店图纸_SI类型与铺型.xlsx"
SNAPSHOT = "资源库/00_资源索引/历史目录/classification/stores.json"
NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"

T2S = str.maketrans(
    "臺灣漢際島廳遠國東區場廣業號樂華貨層門寶豐興龍鳳陽衛夢匯環聯間億萬莊園關紀時會創義館達廈購誠藝術電腦遊戲廠倉儲運動貿鐵紡邊",
    "台湾汉际岛厅远国东区场广业号乐华货层门宝丰兴龙凤阳卫梦汇环联间亿万庄园关纪时会创义馆达厦购诚艺术电脑游戏厂仓储运动贸铁纺边",
)
NAME_NOISE = re.compile(r"[（(【\[].*?[）)】\]]|授权|体验店|专卖店|照材|旗舰店|边厅|中岛|专区|店中店|一店|二店|项目|改造|装饰图纸|电气图|施工图|平面方案|pop-up|\s|-|—|店", re.I)
OVERSEAS = {
    "港澳台": ["台湾", "臺灣", "台北", "台中", "台南", "高雄", "新竹", "桃园", "香港", "澳门"],
    "海外": ["韩国", "日本", "新加坡", "马来西亚", "菲律宾", "印尼", "泰国", "越南", "迪拜", "美国", "英国", "澳大利亚", "柬埔寨", "缅甸", "蒙古", "沙特", "土耳其", "法国", "德国"],
}
CHANNELS = ["授权体验店", "授权专卖店", "照材专卖店", "照材店", "旗舰店", "直营店", "专卖店", "体验店", "pop-up", "街边店"]
SHOP_LABEL = {"边厅": "边厅店", "中岛": "中岛店", "专区": "专区"}


def norm_name(text: str) -> str:
    return NAME_NOISE.sub("", text.translate(T2S)).lower()


def same_store(title: str, filename: str) -> bool:
    a, b = set(norm_name(title)), set(norm_name(filename))
    return bool(a and b) and len(a & b) / min(len(a), len(b)) >= 0.5


def read_ledger(path: Path) -> dict[str, dict]:
    """读取飞书台账“已下载门店”表：本地文件名 → 行。xlsx 按 OOXML 直接解析（exceljs 打不开该文件）。"""
    with zipfile.ZipFile(path) as z:
        shared = ["".join(t.text or "" for t in si.iter(NS + "t")) for si in ET.fromstring(z.read("xl/sharedStrings.xml")).findall(NS + "si")]
        sheet = ET.fromstring(z.read("xl/worksheets/sheet1.xml"))
    rows = []
    for row in sheet.iter(NS + "row"):
        values = {}
        for cell in row.findall(NS + "c"):
            v = cell.find(NS + "v")
            if cell.get("t") == "inlineStr":
                value = "".join(t.text or "" for t in cell.iter(NS + "t"))
            elif v is None:
                value = None
            else:
                value = shared[int(v.text)] if cell.get("t") == "s" else v.text
            values[re.match(r"[A-Z]+", cell.get("r")).group(0)] = value
        rows.append(values)
    head_at = next(i for i, r in enumerate(rows) if r.get("A") == "项目名称（店铺名称）")
    columns = rows[head_at]
    ledger = {}
    for number, row in enumerate(rows[head_at + 1 :], head_at + 2):
        record = {columns[k]: v for k, v in row.items() if k in columns}
        name = (record.get("本地文件名") or "").strip()
        if name:
            ledger[name] = record | {"_row": number}
    return ledger


def ledger_si(value):
    return {"si1.0": "SI1.0", "si2.0": "SI2.0"}.get((value or "").strip().lower())


def ledger_shop(value):
    value = (value or "").strip()
    if value == "专区 / 边厅":
        return "专区"
    return value if value in SHOP_LABEL else None


def filename_hints(stem: str) -> dict:
    shop, subtype = None, None
    if "边厅改中岛" in stem:
        shop = "中岛"
    else:
        found = [w for w in ("中岛", "边厅", "专区", "半岛") if w in stem]
        if len(found) == 1:
            shop = found[0]
    if "无框架中岛" in stem:
        subtype = "无框架中岛"
    elif "框架中岛" in stem:
        subtype = "框架中岛"
    if shop == "半岛":
        shop, subtype = "边厅", "半岛"
    region = next((r for r, words in OVERSEAS.items() if any(w in stem for w in words)), None)
    if region is None and re.search(r"[가-힣]", stem):  # 韩文店名
        region = "海外"
    channel = next((c for c in CHANNELS if c.lower() in stem.lower()), None)
    project = next((w for w in ("迁址", "换址", "换铺", "扩铺", "扩店", "调优", "改造", "pop-up") if w.lower() in stem.lower()), None)
    return {"shop": shop, "subtype": subtype, "region": region or "中国大陆", "channel": channel, "project_hint": project}


def prescreen_text(row) -> str | None:
    """看图初审的建议（阶段1看图初审.json），写进冲突清单的“建议”列。"""
    if not row:
        return None
    return f"建议 {row['建议取值']}（{row['动作']}；看图：{row['依据']}）"


def pages_text(pages: list[int]) -> str:
    shown = "、".join(str(p) for p in pages[:6])
    return f"第 {shown}{' 等' if len(pages) > 6 else ''} 页"


def describe_si(l_si, snap_si, si_pages, weak_pages, weak_words) -> str:
    parts = [f"飞书10-09：{l_si or '未填写'}", f"飞书09-23：{snap_si or '无记录'}"]
    for k, v in si_pages.items():
        if v:
            parts.append(f"图纸写明 {k}（{pages_text(v)}）")
    for k, v in weak_pages.items():
        if v:
            parts.append(f"{k} 专属道具 / 材料 {'、'.join(sorted(weak_words[k]))}（{pages_text(v)}）")
    return "；".join(parts)


def describe_shop(row, snap_shop, hints, shop_pages) -> str:
    parts = [f"飞书10-09：{(row or {}).get('铺型') or '未填写'}", f"飞书09-23：{snap_shop or '无记录'}"]
    if hints["shop"]:
        parts.append(f"文件名：{hints['shop']}")
    for k, v in shop_pages.items():
        parts.append(f"图签写 {k}（{pages_text(v)}）")
    return "；".join(parts)


def apply_decisions(record: dict, decisions: dict) -> None:
    """用户裁决（阶段1裁决.json）覆盖自动取值，标记为已确认。"""
    for key, name in (("si", "SI"), ("shop_type", "铺型")):
        decided = decisions.get((record["store_id"], name))
        if decided:
            record[key] |= {
                "auto_value": record[key]["value"],
                "value": decided["裁决取值"],
                "source": "用户裁决",
                "confidence": "已确认",
                "confirmed": True,
                "decision": {"题号": decided["题号"], "说明": decided["说明"]},
            }
    pending = any(record[k]["confidence"] == "待定" for k in ("si", "shop_type"))
    if any(record[k]["source"] == "用户裁决" for k in ("si", "shop_type")):
        record["status"]["stage1"] = "待裁决" if pending else "已裁决"


def field(value, source, evidence, confidence, confirmed=False):
    return {"value": value, "source": source, "confidence": confidence, "confirmed": confirmed, "evidence": evidence}


def main() -> None:
    args = base_args(__doc__.splitlines()[0]).parse_args()
    repo: Path = args.repo
    sources = load_json(args.out / "来源清单.json")
    by_id = {s["source_id"]: s for s in sources["sources"]}
    ledger = read_ledger(repo / LEDGER)
    snapshot = {s["id"]: s for s in load_json(repo / SNAPSHOT)}
    evidence = {}
    with (args.out / "_cache" / "文字证据.jsonl").open(encoding="utf-8") as handle:
        for line in handle:
            item = json.loads(line)
            evidence[item["source_id"]] = item["pages"]

    stores, issues = [], []
    prescreen_path = args.out / "阶段1看图初审.json"
    prescreen = {(r["store_id"], r["字段"]): r for r in load_json(prescreen_path)["rows"]} if prescreen_path.exists() else {}
    decisions_path = args.out / "阶段1裁决.json"
    decisions = {(r["store_id"], r["字段"]): r for r in load_json(decisions_path)["rows"]} if decisions_path.exists() else {}

    def issue(store, field_name, problems, current, detail, path):
        """同一家店同一字段的多条问题合并成一行，方便在 Excel 里逐行裁决。"""
        issues.append(
            {
                "编号": f"Q-{len(issues) + 1:03d}",
                "store_id": store["store_id"],
                "门店": store["name"],
                "字段": field_name,
                "问题": "；".join(k for k, _ in problems),
                "当前取值": current,
                "证据": detail,
                "建议": prescreen_text(prescreen.get((store["store_id"], field_name))) or "；".join(dict.fromkeys(v for _, v in problems)),
                "你的裁决": "",
                "备注": "",
                "原图": path,
            }
        )

    for archive in sources["archives"]:
        sid = archive["archive_source_id"]
        primary = by_id[sid]
        stem = Path(primary["filename"]).stem
        hints = filename_hints(stem)
        pages = evidence[sid]
        rows = [ledger.get(name) for name in archive["filenames"]]
        row = next((r for r in rows if r), None)
        snap = snapshot.get(sid)
        snap_si = snap.get("si") if snap else None
        snap_shop = (snap.get("shopType") or "").replace("店", "") if snap else None
        snap_shop = snap_shop if snap_shop in SHOP_LABEL else None
        l_si = ledger_si(row.get("SI类型")) if row else None
        l_shop = ledger_shop(row.get("铺型")) if row else None

        # 图纸证据
        si_pages = {"SI1.0": [], "SI2.0": []}
        weak_pages = {"SI1.0": [], "SI2.0": []}
        weak_words = {"SI1.0": set(), "SI2.0": set()}
        shop_pages: dict[str, list[int]] = {}
        own_titles, other_titles = Counter(), Counter()
        areas: dict[float, list[int]] = {}
        for p in pages:
            for w in p["si_words"]:
                si_pages[w].append(p["page"])
            for k, words in p["exclusive"].items():
                weak_pages[k].append(p["page"])
                weak_words[k].update(words)
            matching = [t for t in p["titles"] if same_store(t, stem)]
            for t in p["titles"]:
                (own_titles if t in matching else other_titles)[t] += 1
            if matching or not p["titles"]:
                for w in p["shop_words"]:
                    shop_pages.setdefault("边厅" if w == "半岛" else w, []).append(p["page"])
            for a in p["areas"]:
                areas.setdefault(a, []).append(p["page"])
        strong = sorted(k for k, v in si_pages.items() if v)
        weak = sorted(k for k, v in weak_pages.items() if v)
        drawing_shop = sorted(shop_pages)

        store = {"store_id": sid, "name": stem}

        # SI
        si_ev = {
            "飞书10-09": {"value": l_si, "row": row.get("_row") if row else None, "raw": row.get("SI类型") if row else None},
            "飞书09-23": {"value": snap_si, "record_id": snap.get("recordId") if snap else None},
            "图纸si字样": {k: v[:10] for k, v in si_pages.items() if v},
            "图纸专属道具": {k: {"pages": weak_pages[k][:10], "words": sorted(weak_words[k])} for k in weak},
        }
        si_value, si_source, si_conf = l_si, "飞书10-09", "中"
        problems = []
        if len(strong) == 2:
            problems.append(("SI：同一份图纸同时出现 si1.0 和 si2.0 字样", "单店不混用，请看原图定 SI"))
        if l_si and snap_si and l_si != snap_si:
            problems.append((f"SI：飞书两份数据不一致（10-09 {l_si}，09-23 {snap_si}）", f"以图纸证据为准；没有证据时取 10-09 的 {l_si}"))
        if l_si and len(strong) == 1 and strong[0] != l_si:
            problems.append((f"SI：飞书为 {l_si}，图纸写明 {strong[0]}", f"建议改为 {strong[0]}"))
        # 弱证据只记录、不判冲突：2026-10-13 看图核对，子母凳、试飞台、徕卡品牌墙、1.6 米配件柜在两套 SI 的店里都出现，
        # 与飞书相反的 8 家看效果图全部是飞书正确（见方案阶段 1 结果）。
        si_note = None
        if l_si and not strong and weak and l_si not in weak:
            si_note = f"图纸里有 {'、'.join(weak)} 常见道具 / 材料（{'、'.join(sorted(w for k in weak for w in weak_words[k]))}），与飞书相反；弱证据不作判定，阶段 4 看效果图复核"
        if not l_si:
            guess = strong[0] if len(strong) == 1 else None
            problems.append(("SI：飞书未填写", f"图纸证据指向 {guess}" if guess else "图纸没有文字证据，阶段 4 用效果图判断"))
            si_value, si_source, si_conf = guess, "图纸" if guess else None, "低"
        if not problems and l_si and (l_si in strong):
            si_conf = "高"
        if problems:
            si_conf = "待定"
        if problems:
            issue(store, "SI", problems, si_value or "待定", describe_si(l_si, snap_si, si_pages, weak_pages, weak_words), primary["path"])

        # 铺型
        shop_ev = {
            "飞书10-09": {"value": l_shop, "raw": row.get("铺型") if row else None},
            "飞书09-23": {"value": snap_shop},
            "文件名": {"value": hints["shop"], "subtype": hints["subtype"]},
            "图签": {k: v[:10] for k, v in shop_pages.items()},
        }
        shop_value, shop_conf = l_shop, "中"
        problems = []
        if row and (row.get("铺型") or "").strip() == "专区 / 边厅":
            problems.append(("铺型：飞书写“专区 / 边厅”", "暂取专区，请确认"))
        if l_shop and snap_shop and l_shop != snap_shop:
            problems.append((f"铺型：飞书两份数据不一致（10-09 {l_shop}，09-23 {snap_shop}）", "请看原图确认"))
        if l_shop and hints["shop"] and hints["shop"] != l_shop:
            problems.append((f"铺型：飞书为 {l_shop}，文件名写 {hints['shop']}", f"文件名通常是设计时的店型，建议改为 {hints['shop']}"))
        if l_shop and drawing_shop and l_shop not in drawing_shop:
            problems.append((f"铺型：飞书为 {l_shop}，图签写 {'、'.join(drawing_shop)}", "请看原图确认"))
        if not l_shop:
            guess = hints["shop"] or (drawing_shop[0] if len(drawing_shop) == 1 else None)
            problems.append(("铺型：飞书未填写", f"文件名 / 图签指向 {guess}" if guess else "没有证据，阶段 3 用平面几何判断"))
            shop_value, shop_conf = guess, "低"
        if not problems and l_shop and (l_shop in drawing_shop or l_shop == hints["shop"]):
            shop_conf = "高"
        if problems:
            shop_conf = "待定"
        if problems:
            issue(store, "铺型", problems, SHOP_LABEL.get(shop_value, "待定"), describe_shop(row, snap_shop, hints, shop_pages), primary["path"])

        hint = None
        if si_value == "SI2.0" and shop_value in ("中岛", "专区"):
            hint = "现阶段专区和中岛主要用 SI1.0（用户 2026-10-13 说明），此店为 SI2.0，审核时留意"

        record = {
            "store_id": sid,
            "name": stem,
            "aliases": {
                "filenames": archive["filenames"],
                "feishu_1009": row.get("项目名称（店铺名称）") if row else None,
                "feishu_0923": snap.get("file") if snap else None,
                "title_names": [t for t, _ in own_titles.most_common(3)],
            },
            "source": {"sha256": archive["sha256"], "page_count": archive["page_count"], "source_ids": archive["source_ids"]},
            "region": field(hints["region"], "文件名", None, "中"),
            "market": "domestic" if hints["region"] == "中国大陆" else "overseas",
            "channel": field(hints["channel"], "文件名", None, "中"),
            "project_hint": hints["project_hint"],
            "feishu": {
                "ledger_1009_row": row.get("_row") if row else None,
                "ledger_1009_note": row.get("备注") if row else None,
                "record_id_0923": snap.get("recordId") if snap else None,
            },
            "si": field(si_value, si_source if si_value else None, si_ev, si_conf) | {"note": si_note},
            "shop_type": field(SHOP_LABEL.get(shop_value), "飞书10-09" if shop_value == l_shop and l_shop else ("文件名 / 图签" if shop_value else None), shop_ev, shop_conf)
            | {"subtype": hints["subtype"]},
            "review_hint": hint,
            "area_m2": {
                "candidates": [{"value": a, "pages": ps[:10]} for a, ps in sorted(areas.items())],
                "adopted": None,
                "status": "多个读数，待阶段 3 几何校核" if len(areas) > 1 else ("单一读数，待阶段 3 几何校核" if areas else "图纸文字层没有面积读数"),
            },
            "title_block": {"other_store_titles": dict(other_titles.most_common(5))},
            "text_layer": {"textless_pages": sum(1 for p in pages if p["chars"] < 30), "pages": len(pages)},
            "deferred": {"city": None, "mall": None, "floor": None, "mall_group": None, "related_stores": None},
            "status": {"stage1": "待裁决" if si_conf == "待定" or shop_conf == "待定" else "自动"},
        }
        apply_decisions(record, decisions)
        store.update(record)
        stores.append(store)

    for item in issues:
        decided = decisions.get((item["store_id"], item["字段"]))
        if decided:
            item["你的裁决"] = decided["裁决取值"]
            item["备注"] = decided["说明"]

    # 输出
    out = args.out
    for s in stores:
        folder = out / f"{s['store_id']}__{s['name']}"
        write_json(folder / "store.json", header("build_stores.py") | s)
    summary = {
        "stores": len(stores),
        "si": dict(Counter(s["si"]["value"] or "待定" for s in stores)),
        "si_confidence": dict(Counter(s["si"]["confidence"] for s in stores)),
        "shop_type": dict(Counter(s["shop_type"]["value"] or "待定" for s in stores)),
        "shop_confidence": dict(Counter(s["shop_type"]["confidence"] for s in stores)),
        "region": dict(Counter(s["region"]["value"] for s in stores)),
        "stage1_status": dict(Counter(s["status"]["stage1"] for s in stores)),
        "issues": len(issues),
        "issue_fields": dict(Counter(i["字段"] for i in issues)),
        "review_hints": sum(1 for s in stores if s["review_hint"]),
        "si_weak_against_feishu": sum(1 for s in stores if s["si"]["note"]),
    }
    table = [
        {
            "store_id": s["store_id"],
            "门店": s["name"],
            "地区": s["region"]["value"],
            "渠道": s["channel"]["value"],
            "项目类型提示": s["project_hint"],
            "SI": s["si"]["value"],
            "SI置信度": s["si"]["confidence"],
            "铺型": s["shop_type"]["value"],
            "铺型子类": s["shop_type"]["subtype"],
            "铺型置信度": s["shop_type"]["confidence"],
            "面积候选": "、".join(str(c["value"]) for c in s["area_m2"]["candidates"]),
            "页数": s["source"]["page_count"],
            "无文字页": s["text_layer"]["textless_pages"],
            "别名": "；".join(s["aliases"]["filenames"][1:]),
            "飞书项目名": s["aliases"]["feishu_1009"],
            "审核提示": s["review_hint"],
            "阶段1状态": s["status"]["stage1"],
        }
        for s in stores
    ]
    write_json(out / "门店总表.json", header("build_stores.py") | {"summary": summary, "stores": table})
    write_csv(out / "门店总表.csv", table)
    write_csv(out / "冲突与待确认.csv", issues)
    print(json.dumps(summary, ensure_ascii=False, indent=1))


def write_csv(path: Path, rows: list[dict]) -> None:
    buffer = io.StringIO()
    writer = csv.DictWriter(buffer, fieldnames=list(rows[0]), lineterminator="\r\n")
    writer.writeheader()
    writer.writerows(rows)
    path.write_text("﻿" + buffer.getvalue(), encoding="utf-8", newline="")  # 带 BOM，Excel 直接打开不乱码


if __name__ == "__main__":
    main()
