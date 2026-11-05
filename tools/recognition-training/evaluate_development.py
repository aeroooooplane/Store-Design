"""冻结候选后对固定48家只做评估；不含训练或自动调参入口。"""

import argparse
import json
import shutil
import time
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw
from dataset import (
    load,
    save,
    sha,
    need,
    validate,
    within,
    check_isolation,
    polygon_check,
)
from train import letterbox
from outline_mask import clean_outline, components
from drawing_input import normalize_polarity


def score(pred, target):
    pred, target = pred.astype(bool), target.astype(bool)
    hit = int((pred & target).sum())
    union = int((pred | target).sum())
    return {
        "iou": hit / max(1, union),
        "falsePositivePixels": int((pred & ~target).sum()),
        "falseNegativePixels": int((~pred & target).sum()),
        "referencePixels": int(target.sum()),
        "predictionPixels": int(pred.sum()),
    }


def restore(mask, transform):
    w, h = transform["size"]
    left, top = transform["offset"]
    crop = Image.fromarray(mask[top : top + h, left : left + w].astype(np.uint8) * 255)
    return (
        np.array(crop.resize(tuple(transform["sourceSize"]), Image.Resampling.NEAREST))
        > 0
    )


def main(a):
    import onnxruntime as ort

    data, bundle, out = Path(a.training_data), Path(a.bundle), Path(a.out)
    freeze = load(a.freeze)
    need(not out.exists(), "输出已存在，禁止覆盖既有复评")
    need(sha(a.freeze) == a.freeze_sha256, "冻结方案改变")
    if freeze.get("normalizePolarity"):
        need(
            sha(Path(__file__).parent / "drawing_input.py")
            == freeze["preprocessSha256"],
            "预处理代码改变",
        )
    need(sha(Path(__file__)) == freeze["evaluatorSha256"], "评估代码改变")
    need(
        sha(Path(__file__).parent / "outline_mask.py") == freeze["postprocessSha256"],
        "后处理代码改变",
    )
    m = validate(data)
    need(
        sha(data / "manifest.json") == freeze["trainingDataManifestSha256"],
        "训练集版本不一致",
    )
    devindex = load(data / "identity-only/development-index.json")
    accindex = load(data / "identity-only/acceptance-index.json")
    reference = bundle / "入口复评参照.json"
    need(sha(reference) == freeze["referenceSha256"], "复评参考版本改变")
    annotations = load(reference)["annotations"]
    need(
        len(annotations) == 48 and len({r["store_id"] for r in annotations}) == 48,
        "必须完整保留48家",
    )
    need(
        {r["store_id"] for r in annotations}
        == {r["store_id"] for r in devindex["stores"]},
        "开发集身份不匹配冻结名单",
    )
    check_isolation(m["samples"], devindex["stores"] + accindex["stores"])
    dev_by_id = {r["store_id"]: r for r in devindex["stores"]}
    for row in annotations:
        need(
            row["sourceSha256"] in dev_by_id[row["store_id"]]["sourceSha256s"],
            "开发原PDF身份改变",
        )
        need(
            sha(within(bundle, row["image"]["path"])) == row["image"]["sha256"],
            "开发输入图像改变",
        )
    sessions = {}
    for name in ["baseline", "candidate"]:
        model = freeze[name]
        need(sha(model["onnx"]) == model["sha256"], "模型权重改变")
        options = ort.SessionOptions()
        options.intra_op_num_threads = 4
        sessions[name] = ort.InferenceSession(
            model["onnx"], options, providers=["CPUExecutionProvider"]
        )
    out.mkdir(parents=True)
    (out / "images").mkdir()
    (out / "predictions").mkdir()
    shutil.copy2(a.freeze, out / "frozen-candidate.json")
    shutil.copy2(reference, out / "reference.json")
    for name in [
        "evaluate_development.py",
        "outline_mask.py",
        "drawing_input.py",
        "train.py",
    ]:
        shutil.copy2(Path(__file__).parent / name, out / ("source-" + name))
    rows = []
    for row in annotations:
        id = row["store_id"]
        im = Image.open(within(bundle, row["image"]["path"])).convert("RGB")
        need(
            list(im.size) == [row["image"]["width"], row["image"]["height"]],
            "开发输入尺寸不符",
        )
        pts = [
            p
            for i, p in enumerate(row["boundary"])
            if i == 0 or p != row["boundary"][i - 1]
        ]
        if len(pts) > 1 and pts[0] == pts[-1]:
            pts.pop()
        errors = []
        try:
            polygon_check(pts, list(im.size))
        except ValueError as e:
            errors.append(str(e))
        target = Image.new("L", im.size)
        if not errors:
            ImageDraw.Draw(target).polygon([tuple(p) for p in pts], fill=255)
        target = np.array(target) > 0
        gray, inverted = (
            normalize_polarity(im)
            if freeze.get("normalizePolarity")
            else (im.convert("L"), False)
        )
        x, transform = letterbox(gray, freeze["side"])
        x = (1 - x)[None, None]
        result = {
            "store_id": id,
            "referenceStatus": row["status"],
            "polarityInverted": inverted,
            "pageType": row.get("pageType"),
            "geometry": row.get("geometry"),
            "sourceSha256": row["sourceSha256"],
            "imageSha256": row["image"]["sha256"],
            "referenceErrors": errors,
            "metrics": {},
        }
        refview = im.copy().convert("RGBA")
        overlay = Image.new("RGBA", im.size)
        if not errors:
            ImageDraw.Draw(overlay).polygon(
                [tuple(p) for p in pts], fill=(255, 210, 0, 60)
            )
        refview = Image.alpha_composite(refview, overlay).convert("RGB")
        refview.thumbnail((1000, 1000))
        refview.save(out / "images" / f"{id}-reference.jpg")
        rawview = im.copy()
        rawview.thumbnail((1000, 1000))
        rawview.save(out / "images" / f"{id}-original.jpg")
        for name, session in sessions.items():
            start = time.perf_counter()
            z = session.run(None, {"image": x})[0][0, 0]
            elapsed = time.perf_counter() - start
            need(np.isfinite(z).all(), "模型输出非有限值")
            raw = z >= 0
            clean = clean_outline(raw)
            result[name + "InferenceSeconds"] = elapsed
            for kind, mask in [("raw", raw), ("clean", clean)]:
                key = name + "-" + kind
                pred = restore(mask, transform)
                result["metrics"][key] = (
                    score(pred, target)
                    if not errors
                    else {"iou": 0, "unscorable": True}
                )
                result["metrics"][key]["components256"] = len(components(mask))
                Image.fromarray(mask.astype(np.uint8) * 255).save(
                    out / "predictions" / f"{id}-{key}.png"
                )
                # 按同一像素坐标叠图，不平移或按参考裁切预测。
                rgb = np.array(im)
                rgb[target] = (
                    rgb[target] * 0.6 + np.array([255, 200, 0]) * 0.4
                ).astype(np.uint8)
                rgb[pred] = (rgb[pred] * 0.6 + np.array([0, 190, 170]) * 0.4).astype(
                    np.uint8
                )
                view = Image.fromarray(rgb)
                view.thumbnail((1000, 1000))
                view.save(out / "images" / f"{id}-{key}.jpg")
        rows.append(result)
        print(
            id,
            round(result["metrics"]["baseline-raw"]["iou"], 4),
            round(result["metrics"]["candidate-clean"]["iou"], 4),
            flush=True,
        )
    summary = {
        "stores": 48,
        "scorable": sum(not r["referenceErrors"] for r in rows),
        "metrics": {},
        "frozenBeforeScoring": True,
        "developmentInformedPreprocessing": bool(
            freeze.get("developmentInformedPreprocessing")
        ),
        "trainingOnDevelopment": False,
        "acceptance45GeometryOrScoresRead": False,
        "entranceScaleOrFurnitureEvaluated": False,
        "productionReady": False,
        "metric": "原图像素栅格IoU；按原审核多边形填充，不做对齐；无效参考记0并列出，不从48分母删除。",
    }
    for key in ["baseline-raw", "baseline-clean", "candidate-raw", "candidate-clean"]:
        vals = [r["metrics"][key]["iou"] for r in rows]
        summary["metrics"][key] = {
            "meanIoU": float(np.mean(vals)),
            "medianIoU": float(np.median(vals)),
            "iouAtLeast90": sum(v >= 0.9 for v in vals),
            "iouAtLeast80": sum(v >= 0.8 for v in vals),
        }
    save(out / "results.json", {"summary": summary, "rows": rows})
    save(
        out / "file-hashes.json",
        {p.relative_to(out).as_posix(): sha(p) for p in out.rglob("*") if p.is_file()},
    )
    print(json.dumps(summary, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    for key in ["training-data", "bundle", "freeze", "freeze-sha256", "out"]:
        p.add_argument("--" + key, required=True)
    main(p.parse_args())
