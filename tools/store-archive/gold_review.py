"""阶段 3a：生成金标准审核页（单个 HTML 文件，图片内嵌，可离线打开）。

每家店：原图叠加核对图（边界绿、入口红、柱与固定物橙、道具蓝）、按 plan.json 画的示意平面图、道具清单、
比例与面积核对；可逐家点“对 / 有错 / 待定”并写备注，最后导出审核结果 JSON。
同时把示意平面图写到 _cache/gold/<id>/schematic.png。
用法：python gold_review.py <输出名> store_id [store_id ...]
"""

from __future__ import annotations

import base64
import html
import io
import json
import math
import sys

from PIL import Image, ImageDraw, ImageFont

from common import base_args, load_json

FONT = "C:/Windows/Fonts/msyh.ttc"
COLORS = {
    "island_table": (60, 120, 220), "unboxing_table": (90, 90, 220), "cashier": (200, 60, 60), "accessory_cabinet": (40, 150, 90),
    "side_cabinet": (60, 170, 120), "display_stand": (150, 90, 200), "screen": (230, 140, 30), "signage": (200, 160, 0),
    "seating": (120, 120, 120), "storage": (100, 100, 60), "other": (90, 90, 90),
}
FUNCTION_LABELS = {"island_table": "中岛桌", "unboxing_table": "开箱桌", "cashier": "收银", "accessory_cabinet": "配件柜", "side_cabinet": "配件边柜",
                   "display_stand": "展示台", "screen": "屏幕", "signage": "灯箱与标识", "seating": "坐凳", "storage": "储物柜", "other": "其他"}
FACING_TEXT = {0: "正面朝下", 90: "正面朝左", 180: "正面朝上", 270: "正面朝右"}
MOUNT_TEXT = {"floor": "落地", "wall": "贴墙", "embedded": "内嵌墙内", "hanging": "吊挂"}


def schematic(plan: dict) -> Image.Image:
    pts = plan["space"]["boundary"]
    xs, zs = [p[0] for p in pts], [p[1] for p in pts]
    w, d = max(xs) - min(xs), max(zs) - min(zs)
    k = min(1100 / max(w, 0.1), 800 / max(d, 0.1))
    pad = 70
    img = Image.new("RGB", (int(w * k) + pad * 2, int(d * k) + pad * 2), "white")
    draw = ImageDraw.Draw(img)
    font = ImageFont.truetype(FONT, 13)
    big = ImageFont.truetype(FONT, 15)

    def px(p):
        return (pad + (p[0] - min(xs)) * k, pad + (p[1] - min(zs)) * k)

    poly = [px(p) for p in pts]
    draw.polygon(poly, fill=(248, 248, 244), outline=(30, 30, 30), width=3)
    for o in plan["space"]["obstacles"]:
        draw.polygon([px(p) for p in o["polygon"]], fill=(210, 210, 210), outline=(120, 120, 120))
    for h in plan.get("hardscape", []):
        draw.polygon([px(p) for p in h["polygon"]], fill=(225, 205, 240), outline=(150, 60, 200))
    for e in plan["space"]["entrances"]:
        draw.line([px(e["a"]), px(e["b"])], fill=(220, 0, 0), width=6)
    for e in plan["space"].get("openEdges", []):
        draw.line([px(e["a"]), px(e["b"])], fill=(240, 150, 150), width=3)
    for n, it in enumerate(plan["layout"]["items"], 1):
        ang = math.radians(it["rotation"])
        corners = []
        for dx, dz in ((-it["w"] / 2, -it["d"] / 2), (it["w"] / 2, -it["d"] / 2), (it["w"] / 2, it["d"] / 2), (-it["w"] / 2, it["d"] / 2)):
            corners.append(px((it["cx"] + dx * math.cos(ang) - dz * math.sin(ang), it["cz"] + dx * math.sin(ang) + dz * math.cos(ang))))
        color = COLORS.get(it["function"], (90, 90, 90))
        draw.polygon(corners, outline=color, width=2, fill=tuple(int(c * 0.25 + 255 * 0.75) for c in color))
        fx, fz = it["cx"] + math.sin(-ang) * 0 + (-math.sin(ang)) * it["d"] / 2 * 0, it["cz"]
        front = px((it["cx"] - math.sin(ang) * it["d"] / 2, it["cz"] + math.cos(ang) * it["d"] / 2))
        draw.ellipse([front[0] - 3, front[1] - 3, front[0] + 3, front[1] + 3], fill=color)
        cx, cy = px((it["cx"], it["cz"]))
        draw.text((cx - 6, cy - 9), str(n), fill=(0, 0, 0), font=big)
    mmw = round(w * 1000)
    mmd = round(d * 1000)
    draw.line([(pad, pad - 30), (pad + w * k, pad - 30)], fill=(0, 0, 0), width=1)
    draw.text((pad + w * k / 2 - 30, pad - 52), f"{mmw} mm", fill=(0, 0, 0), font=big)
    draw.line([(pad - 30, pad), (pad - 30, pad + d * k)], fill=(0, 0, 0), width=1)
    draw.text((4, pad + d * k / 2), f"{mmd}", fill=(0, 0, 0), font=big)
    draw.text((pad, img.height - 24), "红线：入口　浅红：开放边　灰：柱与固定物　紫：硬装包墙　圆点：道具正面", fill=(80, 80, 80), font=font)
    return img


def embed(img: Image.Image, width: int) -> str:
    if img.width > width:
        img = img.resize((width, int(img.height * width / img.width)))
    buf = io.BytesIO()
    img.convert("RGB").save(buf, "JPEG", quality=78)
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()


def plan_crop(folder, plan) -> Image.Image:
    img = Image.open(folder / "overlay-plan.png")
    cal = plan["calibration_px"]
    k = 1000 / cal["mmPerPixel"]
    pts = [(cal["originPx"][0] + p[0] * k, cal["originPx"][1] + p[1] * k) for p in plan["space"]["boundary"]]
    xs, ys = [p[0] for p in pts], [p[1] for p in pts]
    return img.crop((max(0, min(xs) - 120), max(0, min(ys) - 120), min(img.width, max(xs) + 120), min(img.height, max(ys) + 140)))


def main() -> None:
    parser = base_args(__doc__.splitlines()[0])
    parser.add_argument("name")
    parser.add_argument("stores", nargs="+")
    args = parser.parse_args()
    root = args.out / "_cache" / "gold"
    sections = []
    for sid in args.stores:
        folder = root / sid
        plan = load_json(folder / "plan.json")
        sch = schematic(plan)
        sch.save(folder / "schematic.png")
        s = plan["summary"]
        checks = "；".join(f"{c['what']}：{c['error_pct']:+.2f}%" for c in plan["calibration_px"]["checks"])
        rows = "".join(
            f"<tr><td>{n}</td><td>{html.escape(it['label'])}</td><td>{FUNCTION_LABELS.get(it['function'], it['function'])}</td>"
            f"<td>{html.escape(it['assetId'] or '（模型库无对应）')}</td><td>{round(it['w'] * 1000)}×{round(it['d'] * 1000)}</td>"
            f"<td>{FACING_TEXT.get(it['rotation'], str(it['rotation']) + '°')}{'（' + MOUNT_TEXT.get(it.get('mount'), '') + ('，店外门头' if it.get('location') == 'facade' else '') + '）' if it.get('mount') != 'floor' or it.get('location') == 'facade' else ''}</td><td>{html.escape(it.get('note') or '')}</td></tr>"
            for n, it in enumerate(plan["layout"]["items"], 1)
        )
        notes = "".join(f"<li>{html.escape(x)}</li>" for x in plan["review"]["notes"])
        sections.append(f"""
<section id="{sid}">
 <h2>{html.escape(plan['name'])} <small>{sid}｜{plan['si']}｜{plan['shop_type']}｜原图第 {plan['source']['page']} 页</small></h2>
 <p>外包尺寸 {s['outer_size_m'][0]} × {s['outer_size_m'][1]} m；边界面积 {s['boundary_area_m2']} ㎡（图注 {s['stated_area_m2'] or '无'}）；层高 {plan['space']['height']} m（{html.escape(s['height_source'] or '')}）<br>比例核对：{html.escape(checks)}</p>
 <ul>{notes}</ul>
 <div class="pair"><figure><img src="{embed(plan_crop(folder, plan), 1100)}"><figcaption>原图叠加：绿＝边界，红＝入口，橙＝柱与固定物，紫＝硬装包墙，蓝＝道具（编号对应下表）</figcaption></figure>
 <figure><img src="{embed(sch, 900)}"><figcaption>示意平面图（工作台将看到的样子）</figcaption></figure></div>
 <table><tr><th>#</th><th>图上原文</th><th>用途</th><th>模型库型号</th><th>宽×深 mm</th><th>朝向</th><th>备注</th></tr>{rows}</table>
 <div class="verdict" data-id="{sid}"><label><input type="radio" name="v-{sid}" value="对">对</label>
 <label><input type="radio" name="v-{sid}" value="有错">有错</label><label><input type="radio" name="v-{sid}" value="待定">待定</label>
 <input class="note" placeholder="备注：哪里不对（例如：3 号应为 1.2 米配件柜；入口在右侧）" style="width:60%"></div>
</section>""")
    page = f"""<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>金标准审核 {html.escape(args.name)}</title>
<style>body{{font-family:"Microsoft YaHei",sans-serif;margin:24px;color:#222}}section{{border-top:3px solid #888;padding:12px 0 24px}}
.pair{{display:flex;gap:16px;flex-wrap:wrap}}figure{{margin:0;max-width:1100px}}img{{max-width:100%;border:1px solid #ccc}}
table{{border-collapse:collapse;margin-top:8px;font-size:13px}}td,th{{border:1px solid #ccc;padding:3px 6px}}.verdict{{margin-top:10px;font-size:15px}}
small{{color:#666;font-weight:normal}}button{{font-size:16px;padding:6px 16px}}</style>
<h1>金标准审核：{html.escape(args.name)}</h1>
<p>请逐家看“原图叠加”是否把边界、入口、柱子和每件道具标对，再点“对 / 有错 / 待定”，有错就在备注里写哪里不对。全部看完后点最下面的按钮导出结果，把下载的文件交给我（或直接在聊天里按编号说明也可以）。</p>
{''.join(sections)}
<button onclick="exportResult()">导出审核结果</button>
<script>
function exportResult(){{const out=[];document.querySelectorAll('.verdict').forEach(v=>{{const id=v.dataset.id;const r=v.querySelector('input[type=radio]:checked');
out.push({{store_id:id,verdict:r?r.value:null,note:v.querySelector('.note').value}})}});
const blob=new Blob([JSON.stringify({{batch:{json.dumps(args.name)},results:out}},null,1)],{{type:'application/json'}});
const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='金标准审核结果-{args.name}.json';a.click()}}
</script></html>"""
    out = args.out / "_cache" / "审核" / f"金标准审核-{args.name}.html"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(page, encoding="utf-8")
    print(out, round(out.stat().st_size / 1e6, 1), "MB")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
