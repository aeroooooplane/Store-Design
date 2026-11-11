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


def outline_parts(record):
    """单轮廓沿用原契约；多区域逐个闭合，禁止隐式桥接公区。"""
    need(("polygonPx" in record) != ("polygonsPx" in record), "须且仅须一种轮廓字段")
    parts = (
        record.get("polygonsPx") if "polygonsPx" in record else [record["polygonPx"]]
    )
    need(isinstance(parts, list) and len(parts) > 0, "多区域轮廓不能为空")
    for points in parts:
        polygon_check(points, record["imageSize"])
    return parts


def outline_fields(record):
    outline_parts(record)
    key = "polygonsPx" if "polygonsPx" in record else "polygonPx"
    return {key: record[key]}


def outline_mask(record):
    from PIL import Image, ImageDraw

    mask = Image.new("L", tuple(record["imageSize"]), 0)
    draw = ImageDraw.Draw(mask)
    for points in outline_parts(record):
        draw.polygon([tuple(p) for p in points], fill=255)
    return mask


def check_mask(path, record):
    # 轻量隔离CI无需Pillow；实际训练环境必须逐像素核对。
    import importlib.util

    if importlib.util.find_spec("PIL"):
        from PIL import Image

        with Image.open(path) as mask:
            expected = outline_mask(record)
            need(
                mask.size == expected.size
                and mask.convert("L").tobytes() == expected.tobytes(),
                "掩膜与轮廓不一致，禁止桥接公区或丢失库房",
            )


def split_ids(ids, seed=20261105, val_count=3):
    need(0 < val_count < len(ids), "训练和内部验证均须非空")
    ranked = sorted(
        ids, key=lambda x: hashlib.sha256(f"{seed}:{x}".encode()).hexdigest()
    )
    return {id: ("internal_val" if id in ranked[:val_count] else "train") for id in ids}


def inherited_splits(samples, parent, extension=None):
    previous = {s["store_id"]: s for s in parent["samples"]}
    current = {s["store_id"]: s for s in samples}
    need(set(previous) <= set(current), "扩充不能移除此前门店")
    need(
        {s["split"] for s in previous.values()} == {"train", "internal_val"},
        "父版划分无效",
    )
    for id, old in previous.items():
        need(identity_keys(current[id]) == identity_keys(old), "扩充不得改换旧门店身份")
        need(current[id]["source"] == old["source"], "扩充不得改换旧来源")
    added_validation = set()
    if extension is not None:
        ids = extension.get("newValidationIds", [])
        need(
            isinstance(ids, list) and ids and all(isinstance(x, str) for x in ids),
            "新增验证名单无效",
        )
        need(len(ids) == len(set(ids)), "新增验证名单重复")
        added_validation = set(ids)
        need(
            added_validation <= set(current) - set(previous),
            "新增验证只能使用未入旧版的新门店",
        )
        need(
            extension.get("modelInferenceBeforeSelection") is False
            and extension.get("frozenAt")
            and extension.get("reason"),
            "验证扩充缺少预测前冻结证据",
        )
        check_isolation([current[x] for x in ids], list(previous.values()))
    return {
        id: (
            previous[id]["split"]
            if id in previous
            else ("internal_val" if id in added_validation else "train")
        )
        for id in current
    }


def check_crop(record):
    """按图框选版的裁图须与原页逐像素一致，不能换成带标签叠图。"""
    from PIL import Image

    if "cropBoxPx" not in record:
        return
    need(record.get("cropBasis") == "document-panel-title", "裁图须有独立图框依据")
    need(sha(record["sourceImage"]) == record["sourceImageSha256"], "裁图原页改变")
    with Image.open(record["sourceImage"]) as source:
        need(list(source.size) == record["sourceImageSize"], "裁图原页尺寸改变")
        box = record["cropBoxPx"]
        need(len(box) == 4 and all(type(v) is int for v in box), "裁图坐标无效")
        left, top, right, bottom = box
        need(
            0 <= left < right <= source.width and 0 <= top < bottom <= source.height,
            "裁图越界",
        )
        expected = source.convert("RGB").crop(box)
        with Image.open(record["image"]) as actual:
            need(
                actual.size == expected.size
                and actual.convert("RGB").tobytes() == expected.tobytes(),
                "裁图与原页不一致",
            )


def build(
    inputs,
    decisions_file,
    resources,
    out,
    val_count=3,
    parent_dataset=None,
    parent_manifest_sha256=None,
    validation_extension=None,
):
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
    parent = None
    extension = load(validation_extension) if validation_extension else None
    need(extension is None or parent_dataset, "验证扩充必须指定父版")
    if parent_dataset:
        need(
            parent_manifest_sha256
            and sha(Path(parent_dataset) / "manifest.json") == parent_manifest_sha256,
            "父版manifest哈希不匹配",
        )
        parent = validate(parent_dataset)
        if extension is not None:
            need(
                extension.get("parentManifestSha256") == parent_manifest_sha256,
                "验证扩充父版哈希不匹配",
            )
        splits = inherited_splits(samples, parent, extension)
    else:
        need(not parent_manifest_sha256, "指定父版哈希时必须提供父版数据目录")
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
        check_crop(r)
        outline_parts(r)
    out.mkdir(parents=True)
    (out / "identity-only").mkdir()
    for name in [
        "pilot-manifest.json",
        "acceptance-index.json",
        "development-index.json",
    ]:
        shutil.copy2(inputs / name, out / "identity-only" / name)
    save(out / "decisions.json", decisions)
    if extension is not None:
        shutil.copy2(validation_extension, out / "validation-extension.json")
    if parent is not None:
        shutil.copy2(
            Path(parent_dataset) / "manifest.json", out / "parent-manifest.json"
        )
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
    if parent is not None:
        manifest.update(
            splitPolicy="inherit-parent", parentManifestSha256=parent_manifest_sha256
        )
    if extension is not None:
        manifest["validationExtensionSha256"] = sha(out / "validation-extension.json")
    for r in admitted:
        id = r["store_id"]
        dest = out / id
        dest.mkdir()
        s = next(s for s in samples if s["store_id"] == id)
        shutil.copy2(r["image"], dest / "image.png")
        mask = outline_mask(r)
        mask.save(dest / "mask.png")
        save(
            dest / "polygon.json",
            {
                "store_id": id,
                "coordinateSystem": "source-image-pixels",
                "imageSize": r["imageSize"],
                **outline_fields(r),
                "target": decisions["target"],
                "humanReviewed": False,
                "evidence": r,
            },
        )
        # 带色标签只用于审核；训练器固定读取image.png，不读取overlay。
        im = Image.open(r["image"]).convert("RGBA")
        layer = Image.new("RGBA", im.size)
        d = ImageDraw.Draw(layer)
        for points in outline_parts(r):
            pts = [tuple(p) for p in points]
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
        need(outline_fields(p) == outline_fields(decisions[id]), "标签与准入版本不一致")
        need(p["imageSize"] == decisions[id]["imageSize"], "标签坐标系不一致")
        check_mask(within(root, s["mask"]), p)
    if m.get("splitPolicy") == "inherit-parent":
        need(
            m["files"].get("parent-manifest.json") == m.get("parentManifestSha256"),
            "父版未绑定哈希",
        )
        parent = load(within(root, "parent-manifest.json"))
        extension = None
        if "validationExtensionSha256" in m:
            need(
                m["files"].get("validation-extension.json")
                == m["validationExtensionSha256"],
                "验证扩充未绑定哈希",
            )
            extension = load(within(root, "validation-extension.json"))
            need(
                extension.get("parentManifestSha256") == m["parentManifestSha256"],
                "验证扩充父版哈希不匹配",
            )
        else:
            need("validation-extension.json" not in m["files"], "验证扩充声明缺失")
        expected = inherited_splits(samples, parent, extension)
        current = {s["store_id"]: s for s in samples}
        for old in parent["samples"]:
            new = current[old["store_id"]]
            for field in ("image", "mask", "polygon"):
                need(
                    m["files"][new[field]] == parent["files"][old[field]],
                    "扩充不得改变旧图像或标签；修订应另开明确版本",
                )
        for kind in ("acceptance", "development"):
            key = f"identity-only/{kind}-index.json"
            need(m["files"][key] == parent["files"][key], "扩充不得替换保护清单")
    else:
        need(
            "validationExtensionSha256" not in m
            and "validation-extension.json" not in m["files"],
            "验证扩充必须继承父版",
        )
        need(m.get("splitPolicy") in (None, "hash"), "未知划分策略")
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
    b.add_argument("--parent-dataset")
    b.add_argument("--parent-manifest-sha256")
    b.add_argument("--validation-extension")
    v = sub.add_parser("validate")
    v.add_argument("root")
    a = ap.parse_args()
    m = (
        validate(a.root)
        if a.command == "validate"
        else build(
            a.inputs,
            a.decisions,
            a.resources,
            a.out,
            a.val_count,
            a.parent_dataset,
            a.parent_manifest_sha256,
            a.validation_extension,
        )
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
