"""阶段 2：给没有可用文字层的图纸页做图签 OCR，写到 _cache/OCR文字.json。

只处理“无文字或乱码、且缩略图像白底线图”的页（效果图不需要）。
优先复用 10-09 全量续跑的旧 OCR（同一文件、同一引擎 rapidocr）；没有的才新做。
新做时只识别三个小区域：右侧图签、底部图签、顶部大标题。全在本机完成，不上传图纸。
"""

from __future__ import annotations

import json
import re
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import numpy as np
import pymupdf

from common import base_args, load_json, write_json

LEGACY = "资源库/90_处理过程与审核/数据清洗-20261009/_cache/全量续跑-02/ocr"
MIN_CONFIDENCE = 0.8
ENGINE = None


def engine():
    global ENGINE
    if ENGINE is None:
        from rapidocr_onnxruntime import RapidOCR

        ENGINE = RapidOCR(intra_op_num_threads=1, inter_op_num_threads=1, det_limit_side_len=960, max_side_len=3000)
    return ENGINE


def ocr_clip(display_list, rect, scale):
    pix = display_list.get_pixmap(matrix=pymupdf.Matrix(scale, scale), clip=pymupdf.Rect(rect), alpha=False)
    arr = np.frombuffer(pix.samples, np.uint8).reshape(pix.height, pix.width, pix.n)[:, :, :3]
    result, _ = engine()(arr)
    spans = []
    for quad, text, score in result or []:
        ys = [y for _, y in quad]
        spans.append({"text": text, "size": (max(ys) - min(ys)) / scale, "confidence": float(score)})
    return spans


def summarize(spans, source):
    good = [s for s in spans if s["confidence"] >= MIN_CONFIDENCE]
    flat = re.sub(r"\s+", "", "".join(s["text"] for s in good))
    heads = [s["text"].strip() for s in sorted(good, key=lambda s: -s["size"]) if s["text"].strip()][:6]
    return {"text": flat[:2000], "headings": heads, "source": source}


def run(task):
    sid, path, pages, legacy_dir = task
    pymupdf.TOOLS.mupdf_display_errors(False)
    out = {}
    with pymupdf.open(path) as doc:
        for number in pages:
            legacy = Path(legacy_dir) / f"p{number:03}.json" if legacy_dir else None
            if legacy and legacy.exists():
                spans = json.loads(legacy.read_text(encoding="utf-8"))["text"]
                spans = [{"text": s["text"], "size": s.get("size", 1), "confidence": s.get("ocr_confidence", 1.0)} for s in spans]
                out[number] = summarize(spans, "旧OCR")
                continue
            page = doc[number - 1]
            page.remove_rotation()
            w, h = page.rect.width, page.rect.height
            scale = 3000 / max(w, h)
            display_list = page.get_displaylist()  # 复杂 CAD 页只解析一次，三个区域共用
            spans = []
            for rect in ([w * 0.78, h * 0.44, w, h], [0, h * 0.84, w * 0.86, h], [0, 0, w * 0.7, h * 0.14]):
                spans.extend(ocr_clip(display_list, rect, scale))
            out[number] = summarize(spans, "新OCR")
    return sid, out


def needs_ocr(p, thumb):
    text = p["text"][:800]
    normal = sum(1 for ch in text if ch.isascii() or "一" <= ch <= "鿿")
    no_text = p["chars"] < 30 or (len(text) >= 30 and normal / len(text) < 0.6)
    drawing_like = thumb is None or thumb["white"] >= 0.55 or thumb["sat"] < 0.03
    return no_text and drawing_like


def main() -> None:
    parser = base_args(__doc__.splitlines()[0])
    parser.add_argument("--workers", type=int, default=4)
    args = parser.parse_args()
    sources = load_json(args.out / "来源清单.json")
    by_id = {s["source_id"]: s for s in sources["sources"]}
    thumbs = load_json(args.out / "_cache" / "缩略图特征.json")
    tasks = []
    with (args.out / "_cache" / "页面特征.jsonl").open(encoding="utf-8") as handle:
        for line in handle:
            item = json.loads(line)
            sid = item["store_id"]
            pages = [p["page"] for p in item["pages"] if needs_ocr(p, thumbs.get(sid, {}).get(str(p["page"])))]
            if not pages:
                continue
            legacy_dir = args.repo / LEGACY / sid
            receipt = legacy_dir / "receipt.json"
            same_file = receipt.exists() and json.loads(receipt.read_text(encoding="utf-8")).get("sha256") == by_id[sid]["sha256"]
            tasks.append((sid, str(args.repo / by_id[sid]["path"]), pages, str(legacy_dir) if same_file else None))
    # 每完成一家就落盘（_cache/ocr/<store_id>.json），中断后重跑会跳过已完成的店
    partial = args.out / "_cache" / "ocr"
    partial.mkdir(parents=True, exist_ok=True)
    result = {}
    todo = []
    for task in tasks:
        done = partial / f"{task[0]}.json"
        if done.exists():
            result[task[0]] = {int(k): v for k, v in json.loads(done.read_text(encoding="utf-8")).items()}
        else:
            todo.append(task)
    with ProcessPoolExecutor(max_workers=args.workers) as pool:
        for n, (sid, pages) in enumerate(pool.map(run, todo, chunksize=1), 1):
            result[sid] = pages
            write_json(partial / f"{sid}.json", pages)
            print(f"[{n}/{len(todo)}] {sid} {len(pages)} 页", flush=True)
    write_json(args.out / "_cache" / "OCR文字.json", result)
    counts = {"旧OCR": 0, "新OCR": 0}
    for pages in result.values():
        for v in pages.values():
            counts[v["source"]] += 1
    print(f"{len(result)} 家，{sum(counts.values())} 页：{counts}")


if __name__ == "__main__":
    main()
