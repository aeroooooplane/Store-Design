"""CPU/CUDA 小型U-Net真实试训。所有选择限于独立内部验证，不读取45/48标签。"""

import argparse
import copy
import math
import importlib.metadata
import json
import platform
import random
import shutil
import sys
import time
from pathlib import Path

import numpy as np
from PIL import Image
import torch
from torch import nn
import torch.nn.functional as F
from dataset import load, save, sha, need, validate, within, outline_mask
from export_model import export_onnx
from drawing_input import normalize_polarity, synthetic_dark_page


class TinyUNet(nn.Module):
    def __init__(self):
        super().__init__()

        def block(a, b):
            return nn.Sequential(
                nn.Conv2d(a, b, 3, padding=1),
                nn.GroupNorm(4, b),
                nn.ReLU(),
                nn.Conv2d(b, b, 3, padding=1),
                nn.GroupNorm(4, b),
                nn.ReLU(),
            )

        self.a = block(1, 8)
        self.b = block(8, 16)
        self.c = block(16, 32)
        self.d = block(32, 64)
        self.u = block(96, 32)
        self.v = block(48, 16)
        self.w = block(24, 8)
        self.out = nn.Conv2d(8, 1, 1)

    def forward(self, x):
        a = self.a(x)
        b = self.b(F.max_pool2d(a, 2))
        c = self.c(F.max_pool2d(b, 2))
        d = self.d(F.max_pool2d(c, 2))
        u = self.u(
            torch.cat([F.interpolate(d, size=c.shape[2:], mode="nearest"), c], 1)
        )
        v = self.v(
            torch.cat([F.interpolate(u, size=b.shape[2:], mode="nearest"), b], 1)
        )
        return self.out(
            self.w(
                torch.cat([F.interpolate(v, size=a.shape[2:], mode="nearest"), a], 1)
            )
        )


def letterbox(im, side, is_mask=False):
    scale = side / max(im.size)
    w = max(1, round(im.width * scale))
    h = max(1, round(im.height * scale))
    out = Image.new("L", (side, side), 0 if is_mask else 255)
    left = (side - w) // 2
    top = (side - h) // 2
    out.paste(
        im.resize(
            (w, h), Image.Resampling.NEAREST if is_mask else Image.Resampling.BILINEAR
        ),
        (left, top),
    )
    return np.array(out, dtype=np.float32) / 255, {
        "size": [w, h],
        "offset": [left, top],
        "sourceSize": list(im.size),
    }


def read_samples(root, m, side, normalize_input=False):
    rows = []
    for s in m["samples"]:
        im = Image.open(within(root, s["image"])).convert("L")
        mask = Image.open(within(root, s["mask"])).convert("L")
        p = load(within(root, s["polygon"]))
        need(
            list(im.size) == p["imageSize"] and im.size == mask.size,
            "图像、标签坐标系不同",
        )
        expected = outline_mask(p)
        need(np.array_equal(np.array(mask), np.array(expected)), "掩膜与多边形不符")
        if normalize_input:
            im, _ = normalize_polarity(im)
        x, tr = letterbox(im, side)
        y, _ = letterbox(mask, side, True)
        rows.append(
            {
                **s,
                "x": torch.from_numpy(1 - x)[None, None],
                "y": torch.from_numpy(y)[None, None],
                "transform": tr,
            }
        )
    return rows


def loss_fn(logits, y, pos_weight=None):
    probs = logits.sigmoid()
    dims = (1, 2, 3)
    dice = (2 * (probs * y).sum(dims) + 1) / (probs.sum(dims) + y.sum(dims) + 1)
    return (
        F.binary_cross_entropy_with_logits(logits, y, pos_weight=pos_weight)
        + (1 - dice).mean()
    )


def metric(pred, y):
    pred = pred.bool()
    y = y.bool()
    inter = (pred & y).sum().item()
    union = (pred | y).sum().item()
    return {
        "iou": inter / max(1, union),
        "dice": 2 * inter / max(1, pred.sum().item() + y.sum().item()),
        "predPixels": pred.sum().item(),
        "labelPixels": y.sum().item(),
    }


@torch.no_grad()
def evaluate(model, rows, device):
    model.eval()
    result = []
    for r in rows:
        x, y = r["x"].to(device), r["y"].to(device)
        z = model(x)
        result.append(
            {
                "store_id": r["store_id"],
                "split": r["split"],
                "loss": loss_fn(z, y).item(),
                **metric(z.sigmoid() >= 0.5, y),
            }
        )
    return result


def mean(rows, key, split):
    return float(np.mean([r[key] for r in rows if r["split"] == split]))


def augment_page(x, y):
    # 对整页和标签应用同一变换；不依赖目标位置，不改变验证输入。
    angle = random.uniform(-6, 6) * math.pi / 180
    scale = random.uniform(0.9, 1.1)
    c, s = math.cos(angle) / scale, math.sin(angle) / scale
    theta = torch.tensor(
        [[[c, -s, random.uniform(-0.12, 0.12)], [s, c, random.uniform(-0.12, 0.12)]]],
        dtype=x.dtype,
    )
    grid = F.affine_grid(theta, x.shape, align_corners=False)
    return F.grid_sample(x, grid, align_corners=False), F.grid_sample(
        y, grid, mode="nearest", align_corners=False
    )


def main(a):
    # ONNX导出日志含Unicode；Windows重定向默认GBK会在训练完成后抛错。
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8")
    root = Path(a.dataset)
    out = Path(a.out)
    need(not out.exists(), "训练输出已存在；不得覆盖之前试训")
    need(sha(root / "manifest.json") == a.manifest_sha256, "数据版本与指定冻结哈希不同")
    m = validate(root)
    need(
        a.epochs > 0
        and a.side >= 64
        and a.side % 8 == 0
        and a.batch_size > 0
        and a.threads > 0,
        "参数无效",
    )
    random.seed(m["seed"])
    np.random.seed(m["seed"])
    torch.manual_seed(m["seed"])
    torch.set_num_threads(a.threads)
    torch.use_deterministic_algorithms(True)
    device = torch.device(a.device)
    rows = read_samples(root, m, a.side, a.normalize_polarity)
    need(
        not a.black_background_augment or a.normalize_polarity,
        "黑底增强须启用与复评一致的极性预处理",
    )
    train = [r for r in rows if r["split"] == "train"]
    foreground = sum(r["y"].sum().item() for r in train)
    pixels = sum(r["y"].numel() for r in train)
    weight = (pixels - foreground) / max(1, foreground)
    if a.positive_weight is not None:
        need(a.positive_weight > 0, "前景权重必须为正")
        weight = a.positive_weight
    pos_weight = torch.tensor(weight, device=device)
    out.mkdir(parents=True)
    if a.black_background_augment:
        (out / "augmentation-inputs").mkdir()
        for r in train:
            dark = synthetic_dark_page(Image.open(within(root, r["image"])))
            dark.save(
                out / "augmentation-inputs" / (r["store_id"] + "-synthetic-dark.png")
            )
            normalized, _ = normalize_polarity(dark)
            x, _ = letterbox(normalized, a.side)
            r["dark_x"] = torch.from_numpy(1 - x)[None, None]
    save(
        out / "config.json",
        {
            **vars(a),
            "seed": m["seed"],
            "architecture": "TinyUNet-8-16-32-64-GroupNorm4",
            "loss": "训练: BCEWithLogits(训练像素负正比权重)+softDice；评估loss:无权重BCE+softDice",
            "trainingPositiveWeight": weight,
            "threshold": 0.5,
            "augmentation": "训练门店随机水平/垂直翻转；可选整页同步仿射；验证无增强；整页等比例补白，无按标签裁图",
            "checkpointSelection": "仅internal_val平均IoU；包含epoch0基线以防训练退化",
            "blackBackgroundAugmentation": "若开启，仅训练原页生成深灰底低对比变体，50%概率替换输入；同标签/同划分，不计新增门店",
        },
    )
    for file in ["train.py", "dataset.py", "export_model.py", "drawing_input.py"]:
        shutil.copy2(Path(__file__).parent / file, out / ("source-" + file))
    save(
        out / "environment.json",
        {
            "python": platform.python_version(),
            "platform": platform.platform(),
            "torch": torch.__version__,
            "cudaAvailable": torch.cuda.is_available(),
            "threads": a.threads,
            "packages": {
                d.metadata["Name"]: d.version
                for d in importlib.metadata.distributions()
            },
        },
    )
    model = TinyUNet().to(device)
    optimizer = torch.optim.Adam(model.parameters(), lr=0.001)
    initial_state = copy.deepcopy(model.state_dict())
    initial = evaluate(model, rows, device)
    save(out / "initial-metrics.json", initial)
    # 训练集平均位置掩膜用于暴露只学图纸版式、未学边界的问题。
    prior = torch.stack([r["y"] for r in train]).mean(0) >= 0.5
    save(
        out / "layout-prior-metrics.json",
        [
            {"store_id": r["store_id"], "split": r["split"], **metric(prior, r["y"])}
            for r in rows
        ],
    )
    best_iou = mean(initial, "iou", "internal_val")
    best_epoch = 0
    best = copy.deepcopy(initial_state)
    steps = 0
    t0 = time.perf_counter()
    with (out / "history.jsonl").open("w", encoding="utf-8") as log:
        for epoch in range(1, a.epochs + 1):
            model.train()
            order = list(train)
            random.shuffle(order)
            losses = []
            for start in range(0, len(order), a.batch_size):
                xs = []
                ys = []
                for r in order[start : start + a.batch_size]:
                    x, y = r["x"], r["y"]
                    if a.black_background_augment and random.random() < 0.5:
                        x = r["dark_x"]
                    dims = [d for d in (2, 3) if random.random() < 0.5]
                    if dims:
                        x = x.flip(dims)
                        y = y.flip(dims)
                    if a.affine_augment:
                        x, y = augment_page(x, y)
                    xs.append(x)
                    ys.append(y)
                x, y = torch.cat(xs).to(device), torch.cat(ys).to(device)
                optimizer.zero_grad()
                loss = loss_fn(model(x), y, pos_weight)
                need(torch.isfinite(loss).item(), "训练损失非有限数")
                loss.backward()
                optimizer.step()
                steps += 1
                losses.append(loss.item())
            metrics = evaluate(model, rows, device)
            vi = mean(metrics, "iou", "internal_val")
            row = {
                "epoch": epoch,
                "steps": steps,
                "trainAugmentedLoss": float(np.mean(losses)),
                "trainIoU": mean(metrics, "iou", "train"),
                "internalValIoU": vi,
                "elapsedSeconds": time.perf_counter() - t0,
            }
            log.write(json.dumps(row) + "\n")
            log.flush()
            if vi > best_iou:
                best_iou = vi
                best_epoch = epoch
                best = copy.deepcopy(model.state_dict())
            if epoch == 1 or epoch % 10 == 0:
                print(json.dumps(row), flush=True)
    gradient_seconds = time.perf_counter() - t0
    last = evaluate(model, rows, device)
    save(out / "last-metrics.json", last)
    torch.save(
        {
            "state_dict": model.cpu().state_dict(),
            "epoch": a.epochs,
            "manifestSha256": a.manifest_sha256,
            "normalizePolarity": a.normalize_polarity,
        },
        out / "last.pt",
    )
    changed = max(
        (model.state_dict()[k] - initial_state[k].cpu()).abs().max().item()
        for k in initial_state
    )
    need(changed > 0 and steps > 0, "权重未实际更新")
    model.load_state_dict({k: v.cpu() for k, v in best.items()})
    model.eval()
    torch.save(
        {
            "state_dict": model.state_dict(),
            "epoch": best_epoch,
            "manifestSha256": a.manifest_sha256,
            "normalizePolarity": a.normalize_polarity,
        },
        out / "best.pt",
    )
    final = evaluate(model, rows, "cpu")
    save(out / "best-metrics.json", final)
    # 只导出与本次试训完全相同的固定整页分辨率；不宣称已接入编辑器。
    export_onnx(model, out / "outline.onnx", a.side)
    import onnxruntime as ort

    options = ort.SessionOptions()
    options.intra_op_num_threads = a.threads
    session = ort.InferenceSession(
        str(out / "outline.onnx"), options, providers=["CPUExecutionProvider"]
    )
    max_error = 0.0
    max_probability_error = 0.0
    max_mask_difference = 0.0
    different_pixels = 0
    latencies = []
    (out / "predictions").mkdir()
    for r in rows:
        x = r["x"].numpy()
        with torch.no_grad():
            z = model(r["x"]).numpy()
        start = time.perf_counter()
        oz = session.run(None, {"image": x})[0]
        latencies.append(time.perf_counter() - start)
        max_error = max(max_error, float(np.max(np.abs(z - oz))))
        max_probability_error = max(
            max_probability_error,
            float(np.max(np.abs(1 / (1 + np.exp(-z)) - 1 / (1 + np.exp(-oz))))),
        )
        differing = int(np.sum((z >= 0) != (oz >= 0)))
        different_pixels += differing
        max_mask_difference = max(max_mask_difference, differing / z.size)
        pred = z[0, 0] >= 0
        mask = r["y"].numpy()[0, 0] > 0
        Image.fromarray(pred.astype(np.uint8) * 255).save(
            out / "predictions" / f'{r["store_id"]}-mask.png'
        )
        rgb = np.repeat(
            ((1 - r["x"].numpy()[0, 0]) * 255).astype(np.uint8)[..., None], 3, axis=2
        )
        # 黄=参考，青=预测。透明混合保留原图，不作为下轮模型输入。
        rgb[mask] = (rgb[mask] * 0.6 + np.array([255, 200, 0]) * 0.4).astype(np.uint8)
        rgb[pred] = (rgb[pred] * 0.6 + np.array([0, 190, 170]) * 0.4).astype(np.uint8)
        Image.fromarray(rgb).resize((768, 768)).save(
            out / "predictions" / f'{r["store_id"]}-comparison.png'
        )
    # 不同CPU卷积实现有小幅logit差异；按最终概率和分割结果共同验收，并保留原始误差。
    export_check = {
        "maxAbsLogitError": max_error,
        "maxAbsProbabilityError": max_probability_error,
        "maxMaskDifferenceFraction": max_mask_difference,
        "differentMaskPixelsTotal": different_pixels,
        "comparedImages": len(rows),
        "probabilityTolerance": 0.005,
        "maskDifferenceTolerance": 0.0001,
    }
    save(out / "export-check.json", export_check)
    export_passed = max_probability_error < 0.005 and max_mask_difference < 0.0001
    save(
        out / "summary.json",
        {
            "trainStores": len(train),
            "internalValStores": len(rows) - len(train),
            "epochs": a.epochs,
            "optimizerSteps": steps,
            "bestEpoch": best_epoch,
            "weightMaxChange": changed,
            "gradientAndEpochEvaluationSeconds": gradient_seconds,
            "trainingAndExportSeconds": time.perf_counter() - t0,
            "initialValIoU": mean(initial, "iou", "internal_val"),
            "bestValIoU": mean(final, "iou", "internal_val"),
            "lastValIoU": mean(last, "iou", "internal_val"),
            "bestTrainIoU": mean(final, "iou", "train"),
            "onnxMaxAbsError": max_error,
            "onnxMeanSeconds": float(np.mean(latencies)),
            "exportPassed": export_passed,
            "parameterCount": sum(p.numel() for p in model.parameters()),
            "development48ReadForTraining": False,
            "acceptance45ReadForTraining": False,
            "externalEvaluationPerformed": False,
            "productionReady": False,
        },
    )
    save(
        out / "file-hashes.json",
        {
            p.relative_to(out).as_posix(): sha(p)
            for p in sorted(out.rglob("*"))
            if p.is_file()
        },
    )
    print((out / "summary.json").read_text("utf-8"), flush=True)
    # 导出未通过也先保存真实训练结果和哈希，命令仍以失败退出。
    need(export_passed, "ONNX概率或掩膜偏差超过容差")


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--dataset", required=True)
    p.add_argument("--out", required=True)
    p.add_argument("--manifest-sha256", required=True)
    p.add_argument("--epochs", type=int, default=80)
    p.add_argument("--side", type=int, default=256)
    p.add_argument("--threads", type=int, default=4)
    p.add_argument("--batch-size", type=int, default=2)
    p.add_argument("--device", choices=["cpu", "cuda"], default="cpu")
    p.add_argument("--positive-weight", type=float)
    p.add_argument("--affine-augment", action="store_true")
    p.add_argument("--normalize-polarity", action="store_true")
    p.add_argument("--black-background-augment", action="store_true")
    main(p.parse_args())
