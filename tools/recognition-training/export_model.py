"""只在导出副本中以FP64累积GroupNorm统计；原训练结构和权重不变。"""

import argparse
import copy
import time
from pathlib import Path

import numpy as np
import torch
from torch import nn

from dataset import load, save, sha, need, validate


class ExportGroupNorm(nn.Module):
    def __init__(self, source):
        super().__init__()
        self.groups = source.num_groups
        self.eps = source.eps
        self.weight = source.weight
        self.bias = source.bias

    def forward(self, x):
        grouped = x.double().reshape(x.shape[0], self.groups, -1)
        centered = grouped - grouped.mean(dim=2, keepdim=True)
        normal = centered * torch.rsqrt(
            (centered * centered).mean(dim=2, keepdim=True) + self.eps
        )
        result = normal.reshape_as(x).to(x.dtype)
        if self.weight is not None:
            result = (
                result * self.weight[None, :, None, None]
                + self.bias[None, :, None, None]
            )
        return result


def export_copy(model):
    result = copy.deepcopy(model).cpu().eval()

    def replace(module):
        for name, child in list(module.named_children()):
            if isinstance(child, nn.GroupNorm):
                setattr(module, name, ExportGroupNorm(child))
            else:
                replace(child)

    replace(result)
    return result


def export_onnx(model, path, side):
    torch.onnx.export(
        export_copy(model),
        (torch.zeros(1, 1, side, side),),
        str(path),
        input_names=["image"],
        output_names=["logits"],
        dynamo=True,
        optimize=False,
        opset_version=18,
        external_data=False,
    )


def stress_inputs(side):
    rng = np.random.default_rng(20261105)
    yy, xx = np.indices((side, side))
    arrays = {
        "blank": np.zeros((side, side)),
        "solid": np.ones((side, side)),
        "gray": np.full((side, side), 0.5),
        "low-contrast": 0.5 + rng.uniform(-1e-5, 1e-5, (side, side)),
        "noise": rng.random((side, side)),
        "checker": (xx + yy) % 2,
        "thin-lines": ((xx % 31 == 0) | (yy % 37 == 0)).astype(float),
        "edge": (xx < side // 2).astype(float),
    }
    return [
        (name, torch.from_numpy(a.astype(np.float32))[None, None])
        for name, a in arrays.items()
    ]


def compare(model, path, inputs, threads):
    import onnxruntime as ort

    options = ort.SessionOptions()
    options.intra_op_num_threads = threads
    session = ort.InferenceSession(
        str(path), options, providers=["CPUExecutionProvider"]
    )
    records = []
    for name, x in inputs:
        with torch.no_grad():
            expected = model(x).numpy()
        start = time.perf_counter()
        actual = session.run(None, {"image": x.numpy()})[0]
        seconds = time.perf_counter() - start
        need(
            np.isfinite(actual).all() and np.isfinite(expected).all(),
            "导出结果非有限数",
        )
        different = int(np.sum((expected >= 0) != (actual >= 0)))
        # clip只避免exp溢出，概率误差计算不改变0.5阈值或掩膜。
        sigmoid = lambda z: 1 / (1 + np.exp(-np.clip(z, -80, 80)))
        records.append(
            {
                "id": name,
                "maxAbsLogitError": float(np.max(abs(actual - expected))),
                "maxAbsProbabilityError": float(
                    np.max(abs(sigmoid(actual) - sigmoid(expected)))
                ),
                "differentMaskPixels": different,
                "maskDifferenceFraction": different / expected.size,
                "inferenceSeconds": seconds,
            }
        )
    passed = all(
        r["maxAbsProbabilityError"] < 0.005 and r["maskDifferenceFraction"] < 0.0001
        for r in records
    )
    return {
        "passed": passed,
        "probabilityTolerance": 0.005,
        "maskDifferenceTolerance": 0.0001,
        "maxAbsProbabilityError": max(r["maxAbsProbabilityError"] for r in records),
        "differentMaskPixelsTotal": sum(r["differentMaskPixels"] for r in records),
        "records": records,
    }


def main(a):
    # 延迟导入避免训练器调用export_onnx时循环依赖。
    from train import TinyUNet, read_samples

    data, checkpoint, out = Path(a.dataset), Path(a.checkpoint), Path(a.out)
    need(not out.exists(), "输出已存在，请使用新目录")
    need(a.side >= 64 and a.side % 8 == 0 and a.threads > 0, "输入尺寸或线程数无效")
    need(sha(data / "manifest.json") == a.manifest_sha256, "数据版本改变")
    need(sha(checkpoint) == a.checkpoint_sha256, "权重版本改变")
    manifest = validate(data)
    state = torch.load(checkpoint, map_location="cpu", weights_only=True)
    need(state["manifestSha256"] == a.manifest_sha256, "权重与数据不匹配")
    torch.set_num_threads(a.threads)
    model = TinyUNet().eval()
    model.load_state_dict(state["state_dict"])
    normalize_input = state.get("normalizePolarity", False)
    need(type(normalize_input) is bool, "权重预处理配置无效")
    rows = read_samples(data, manifest, a.side, normalize_input)
    out.mkdir(parents=True)
    export_onnx(model, out / "outline.onnx", a.side)
    check = compare(
        model,
        out / "outline.onnx",
        [(r["store_id"], r["x"]) for r in rows] + stress_inputs(a.side),
        a.threads,
    )
    save(out / "export-check.json", check)
    save(
        out / "manifest.json",
        {
            "schemaVersion": 1,
            "task": "outline-onnx-export",
            "dataManifestSha256": a.manifest_sha256,
            "checkpointSha256": a.checkpoint_sha256,
            "sourceCheckpoint": str(checkpoint),
            "side": a.side,
            "threads": a.threads,
            "method": "FP64-centered-GroupNorm-statistics; FP32-convolutions; exporter-optimize-false",
            "sourceExportSha256": sha(Path(__file__)),
            "onnxSha256": sha(out / "outline.onnx"),
            "productionReady": False,
            "exportPassed": check["passed"],
            "normalizePolarity": normalize_input,
        },
    )
    import shutil

    for name in ["export_model.py", "train.py", "dataset.py", "drawing_input.py"]:
        shutil.copy2(Path(__file__).parent / name, out / ("source-" + name))
    save(
        out / "file-hashes.json", {p.name: sha(p) for p in out.iterdir() if p.is_file()}
    )
    print({k: v for k, v in check.items() if k != "records"}, flush=True)
    need(check["passed"], "ONNX一致性未通过，不可使用此导出")


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    for name in [
        "dataset",
        "checkpoint",
        "manifest-sha256",
        "checkpoint-sha256",
        "out",
    ]:
        p.add_argument("--" + name, required=True)
    p.add_argument("--side", type=int, default=256)
    p.add_argument("--threads", type=int, default=4)
    main(p.parse_args())
