"""首批轮廓试训的数据契约。禁止将开发/验收门店用于梯度训练或内部验证。"""

import argparse
import hashlib
import json
import math
import re
import shutil
import unicodedata
from pathlib import Path


def load(path):
    return json.loads(Path(path).read_text(encoding="utf-8-sig"))


def save(path, value):
    Path(path).write_text(
        json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def identity_index_sha(value):
    # 身份索引只有字符串/整数；与pilot-contract.mjs的排序紧凑JSON哈希一致。
    return hashlib.sha256(
        json.dumps(
            value, ensure_ascii=False, sort_keys=True, separators=(",", ":")
        ).encode("utf-8")
    ).hexdigest()


def check_index_binding(pilot, indexes):
    for kind, index in indexes.items():
        need(
            pilot.get("exclusions", {}).get(kind + "Sha256")
            == identity_index_sha(index),
            "保护清单不匹配冻结试点版本",
        )


def need(condition, message):
    if not condition:
        raise ValueError(message)


def within(root, relative):
    root = Path(root).resolve()
    p = (root / relative).resolve()
    need(p.is_relative_to(root) and p != root, "路径越出数据包")
    return p


def identity_keys(s):
    normalize = lambda x: "".join(
        c for c in unicodedata.normalize("NFKC", str(x)).casefold() if c.isalnum()
    )
    names = [s.get("name", ""), *s.get("aliases", [])]
    keys = (
        {f'id:{s["store_id"].upper()}'}
        | {"name:" + normalize(n) for n in names if normalize(n)}
        | {"key:" + normalize(k) for k in s.get("sameStoreKeys", [])}
        | {"source:" + h for h in s.get("sourceSha256s", [])}
    )
    if "source" in s:
        keys.add("source:" + s["source"]["sha256"])
    return keys


def check_isolation(samples, protected):
    keys = set().union(*(identity_keys(s) for s in protected))
    seen = set()
    for s in samples:
        k = identity_keys(s)
        need(not k & keys, f'{s["store_id"]}: 命中开发/验收身份: {sorted(k & keys)}')
        need(not k & seen, f'{s["store_id"]}: 同店/同源重复；须先合并分组')
        seen |= k


def polygon_check(points, size):
    need(len(points) >= 3, "轮廓不足3点")
    w, h = size
    for p in points:
        need(
            len(p) == 2
            and all(isinstance(v, (float, int)) and math.isfinite(v) for v in p),
            "无效坐标",
        )
        need(0 <= p[0] < w and 0 <= p[1] < h, "坐标越界")
    need(len({tuple(p) for p in points}) == len(points), "重复顶点")

    def cross(a, b, c):
        return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])

    def on(a, b, c):
        return (
            abs(cross(a, b, c)) < 1e-7
            and min(a[0], b[0]) <= c[0] <= max(a[0], b[0])
            and min(a[1], b[1]) <= c[1] <= max(a[1], b[1])
        )

    def intersect(a, b, c, d):
        return (
            cross(a, b, c) * cross(a, b, d) < 0 and cross(c, d, a) * cross(c, d, b) < 0
        ) or any((on(a, b, c), on(a, b, d), on(c, d, a), on(c, d, b)))

    n = len(points)
    for i in range(n):
        for j in range(i + 1, n):
            if j == i + 1 or (i == 0 and j == n - 1):
                continue
            need(
                not intersect(
                    points[i], points[(i + 1) % n], points[j], points[(j + 1) % n]
                ),
                "轮廓自交",
            )
    area = (
        abs(
            sum(
                points[i][0] * points[(i + 1) % n][1]
                - points[(i + 1) % n][0] * points[i][1]
                for i in range(n)
            )
        )
        / 2
    )
    need(area > 1, "轮廓面积为零")


def split_ids(ids, seed=20261105, val_count=3):
    need(0 < val_count < len(ids), "训练和内部验证均须非空")
    ranked = sorted(
        ids, key=lambda x: hashlib.sha256(f"{seed}:{x}".encode()).hexdigest()
    )
    return {id: ("internal_val" if id in ranked[:val_count] else "train") for id in ids}


def build(inputs, decisions_file, resources, out, val_count=3):
    from PIL import Image, ImageDraw

    inputs, out, resources = Path(inputs), Path(out), Path(resources)
    need(not out.exists(), "输出已存在；请使用新版本目录以保留历史")
    pilot = load(inputs / "pilot-manifest.json")
    need(pilot["status"] == "frozen", "试点未冻结")
    indexes = {
        kind: load(inputs / f"{kind}-index.json")
        for kind in ("acceptance", "development")
    }
    for kind, expected in [("acceptance", 45), ("development", 48)]:
        need(
            indexes[kind]["kind"] == kind and len(indexes[kind]["stores"]) == expected,
            "保护清单缺失或数量改变",
        )
    check_index_binding(pilot, indexes)
    decisions = load(decisions_file)
    rows = decisions["records"]
    need(len({r["store_id"] for r in rows}) == len(rows), "重复准入记录")
    need(
        {r["store_id"] for r in rows} == {s["store_id"] for s in pilot["samples"]},
        "须保留完整冻结试点的准入和排除记录",
    )
    admitted = [r for r in rows if r["status"] == "admitted"]
    samples = [
        s
        for s in pilot["samples"]
        if s["store_id"] in {r["store_id"] for r in admitted}
    ]
    check_isolation(
        samples, indexes["acceptance"]["stores"] + indexes["development"]["stores"]
    )
    splits = split_ids([s["store_id"] for s in samples], val_count=val_count)
    # 先核对所有准入资料，任何一项失败都不生成半成品训练包。
    for r in admitted:
        s = next(s for s in samples if s["store_id"] == r["store_id"])
        need(re.fullmatch(r"[A-Z]+-\d+", r["store_id"]), "门店编号无效")
        need(
            r.get("identityReview") and r.get("reviewer") and r.get("reason"),
            "缺少独立准入证据",
        )
        need(
            sha(within(resources, s["source"]["path"])) == s["source"]["sha256"],
            "原PDF哈希改变",
        )
        need(sha(r["image"]) == r["imageSha256"], "原页图像改变")
        need(list(Image.open(r["image"]).size) == r["imageSize"], "坐标系尺寸不匹配")
        polygon_check(r["polygonPx"], r["imageSize"])
    out.mkdir(parents=True)
    (out / "identity-only").mkdir()
    for name in [
        "pilot-manifest.json",
        "acceptance-index.json",
        "development-index.json",
    ]:
        shutil.copy2(inputs / name, out / "identity-only" / name)
    save(out / "decisions.json", decisions)
    manifest = {
        "schemaVersion": 1,
        "task": "outline-segmentation-trial",
        "target": decisions["target"],
        "seed": 20261105,
        "protectedCounts": {"acceptance": 45, "development": 48},
        "identityScope": "ID、别名、同店键、PDF哈希严格隔离；原页图名人工代理核查。未证明全资源库不存在未登记近重复。",
        "samples": [],
        "files": {},
    }
    for r in admitted:
        id = r["store_id"]
        dest = out / id
        dest.mkdir()
        s = next(s for s in samples if s["store_id"] == id)
        shutil.copy2(r["image"], dest / "image.png")
        mask = Image.new("L", tuple(r["imageSize"]), 0)
        ImageDraw.Draw(mask).polygon([tuple(p) for p in r["polygonPx"]], fill=255)
        mask.save(dest / "mask.png")
        save(
            dest / "polygon.json",
            {
                "store_id": id,
                "coordinateSystem": "source-image-pixels",
                "imageSize": r["imageSize"],
                "polygonPx": r["polygonPx"],
                "target": decisions["target"],
                "humanReviewed": False,
                "evidence": r,
            },
        )
        # 带色标签只用于审核；训练器固定读取image.png，不读取overlay。
        im = Image.open(r["image"]).convert("RGBA")
        layer = Image.new("RGBA", im.size)
        d = ImageDraw.Draw(layer)
        pts = [tuple(p) for p in r["polygonPx"]]
        d.polygon(pts, fill=(255, 210, 0, 35))
        d.line(pts + [pts[0]], fill=(220, 160, 0, 255), width=5)
        Image.alpha_composite(im, layer).convert("RGB").save(dest / "review.png")
        manifest["samples"].append(
            {
                **s,
                "split": splits[id],
                "image": f"{id}/image.png",
                "mask": f"{id}/mask.png",
                "polygon": f"{id}/polygon.json",
                "labelReview": "agent-reviewed-outline-only",
            }
        )
    for p in sorted(out.rglob("*")):
        if p.is_file():
            manifest["files"][p.relative_to(out).as_posix()] = sha(p)
    save(out / "manifest.json", manifest)
    validate(out)
    return manifest


def validate(root):
    root = Path(root)
    m = load(root / "manifest.json")
    need(
        m["schemaVersion"] == 1 and m["task"] == "outline-segmentation-trial",
        "未知数据契约",
    )
    for file, digest in m["files"].items():
        need(sha(within(root, file)) == digest, f"数据包文件改变: {file}")
    for f in ["pilot-manifest.json", "acceptance-index.json", "development-index.json"]:
        need("identity-only/" + f in m["files"], "保护文件未绑定哈希")
    protected = []
    indexes = {}
    for kind, count in [("acceptance", 45), ("development", 48)]:
        idx = load(root / "identity-only" / f"{kind}-index.json")
        need(idx["kind"] == kind and len(idx["stores"]) == count, "保护清单不完整")
        protected += idx["stores"]
        indexes[kind] = idx
    check_index_binding(load(root / "identity-only/pilot-manifest.json"), indexes)
    samples = m["samples"]
    check_isolation(samples, protected)
    need(
        {s["split"] for s in samples} == {"train", "internal_val"},
        "划分必须且仅包含train/internal_val",
    )
    pilot = {
        s["store_id"]: s
        for s in load(root / "identity-only/pilot-manifest.json")["samples"]
    }
    decisions = {r["store_id"]: r for r in load(root / "decisions.json")["records"]}
    need("decisions.json" in m["files"], "准入未绑定哈希")
    image_hashes = set()
    for s in samples:
        id = s["store_id"]
        need(s["source"] == pilot[id]["source"], "来源不属于冻结试点")
        need(identity_keys(s) == identity_keys(pilot[id]), "冻结身份发生改变")
        need(decisions[id]["status"] == "admitted", "未准入样本混入")
        for kind in ("image", "mask", "polygon"):
            need(s[kind] in m["files"], "训练输入未绑定哈希")
        digest = m["files"][s["image"]]
        need(
            digest == decisions[id]["imageSha256"],
            "输入不是已核准原图，禁止将叠图作为输入",
        )
        need(digest not in image_hashes, "重复图像泄漏")
        image_hashes.add(digest)
        p = load(within(root, s["polygon"]))
        polygon_check(p["polygonPx"], p["imageSize"])
        need(p["polygonPx"] == decisions[id]["polygonPx"], "标签与准入版本不一致")
    expected = split_ids(
        [s["store_id"] for s in samples],
        m["seed"],
        sum(s["split"] == "internal_val" for s in samples),
    )
    need(all(s["split"] == expected[s["store_id"]] for s in samples), "冻结划分改变")
    return m


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="command", required=True)
    b = sub.add_parser("build")
    for name in ["inputs", "decisions", "resources", "out"]:
        b.add_argument("--" + name, required=True)
    b.add_argument("--val-count", type=int, default=3)
    v = sub.add_parser("validate")
    v.add_argument("root")
    a = ap.parse_args()
    m = (
        validate(a.root)
        if a.command == "validate"
        else build(a.inputs, a.decisions, a.resources, a.out, a.val_count)
    )
    print(
        json.dumps(
            {
                "samples": len(m["samples"]),
                "splits": {
                    k: sum(s["split"] == k for s in m["samples"])
                    for k in ("train", "internal_val")
                },
                "protectedCounts": m["protectedCounts"],
            },
            ensure_ascii=False,
        )
    )
