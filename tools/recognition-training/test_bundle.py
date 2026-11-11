"""无需真实门店文件，验证打包后篡改、未准入、同源替换均会失败。"""

import json
import copy
import unittest
from pathlib import Path
from unittest.mock import patch
from dataset import validate, split_ids, identity_index_sha, inherited_splits


class BundleTests(unittest.TestCase):
    def fixture(self):
        samples = [
            {
                "store_id": f"TRAIN-{i:03}",
                "name": f"独立{i}",
                "source": {"path": f"{i}.pdf", "sha256": str(i)},
            }
            for i in range(4)
        ]
        splits = split_ids([s["store_id"] for s in samples], val_count=1)
        protected = {
            k: {
                "kind": k,
                "stores": [
                    {"store_id": f"{k}-{i}", "name": f"{k}{i}"} for i in range(n)
                ],
            }
            for k, n in [("acceptance", 45), ("development", 48)]
        }
        files = {
            "identity-only/pilot-manifest.json": "pilot",
            "identity-only/acceptance-index.json": "acceptance",
            "identity-only/development-index.json": "development",
            "decisions.json": "decisions",
        }
        docs = {
            "identity-only/pilot-manifest.json": {
                "samples": json.loads(json.dumps(samples))
            },
            **{f"identity-only/{k}-index.json": v for k, v in protected.items()},
        }
        decisions = []
        for s in samples:
            id = s["store_id"]
            points = [[1, 1], [8, 1], [8, 8], [1, 8]]
            s.update(
                split=splits[id],
                image=f"{id}/image.png",
                mask=f"{id}/mask.png",
                polygon=f"{id}/polygon.json",
            )
            for key in ("image", "mask", "polygon"):
                files[s[key]] = s[key]
            docs[s["polygon"]] = {"imageSize": [10, 10], "polygonPx": points}
            decisions.append(
                {
                    "store_id": id,
                    "status": "admitted",
                    "imageSize": [10, 10],
                    "polygonPx": points,
                    "imageSha256": s["image"],
                }
            )
        docs["identity-only/pilot-manifest.json"]["exclusions"] = {
            k + "Sha256": identity_index_sha(v) for k, v in protected.items()
        }
        docs["decisions.json"] = {"records": decisions}
        docs["manifest.json"] = {
            "schemaVersion": 1,
            "task": "outline-segmentation-trial",
            "files": files,
            "samples": samples,
            "seed": 20261105,
        }
        return docs

    def run_validation(self, docs, bad_hash=None):
        root = Path(__file__).resolve().parent / "fictional-bundle"

        def rel(p):
            return Path(p).relative_to(root).as_posix()

        def digest(p):
            r = rel(p)
            return "tampered" if r == bad_hash else docs["manifest.json"]["files"][r]

        with patch("dataset.load", side_effect=lambda p: docs[rel(p)]), patch(
            "dataset.sha", side_effect=digest
        ), patch("dataset.check_mask"):
            return validate(root)

    def test_complete_fixture_passes(self):
        self.run_validation(self.fixture())

    def inherited_fixture(self):
        d = self.fixture()
        parent = copy.deepcopy(d["manifest.json"])
        d["parent-manifest.json"] = parent
        d["manifest.json"].update(
            splitPolicy="inherit-parent", parentManifestSha256="parent"
        )
        d["manifest.json"]["files"]["parent-manifest.json"] = "parent"
        return d

    def test_expansion_keeps_old_split_and_new_stores_train(self):
        d = self.inherited_fixture()
        self.run_validation(d)
        parent = d["parent-manifest.json"]
        new = {
            "store_id": "TRAIN-999",
            "name": "新增",
            "source": {"sha256": "new", "path": "new.pdf"},
        }
        result = inherited_splits(parent["samples"] + [new], parent)
        self.assertEqual(result[new["store_id"]], "train")
        for s in parent["samples"]:
            self.assertEqual(result[s["store_id"]], s["split"])

    def test_explicit_new_validation_preserves_old_splits(self):
        parent = self.inherited_fixture()["parent-manifest.json"]
        new = {
            "store_id": "NEW-999",
            "name": "新验证",
            "source": {"sha256": "fresh", "path": "fresh.pdf"},
        }
        extension = {
            "newValidationIds": ["NEW-999"],
            "modelInferenceBeforeSelection": False,
            "frozenAt": "2026-11-11",
            "reason": "先冻结再预测",
        }
        actual = inherited_splits(parent["samples"] + [new], parent, extension)
        self.assertEqual(actual.pop("NEW-999"), "internal_val")
        self.assertEqual(actual, {r["store_id"]: r["split"] for r in parent["samples"]})
        for ids in [
            [parent["samples"][0]["store_id"]],
            ["UNKNOWN"],
            ["NEW-999", "NEW-999"],
            [],
        ]:
            with self.subTest(ids=ids), self.assertRaises(ValueError):
                inherited_splits(
                    parent["samples"] + [new],
                    parent,
                    {**extension, "newValidationIds": ids},
                )
        with self.assertRaisesRegex(ValueError, "冻结证据"):
            inherited_splits(
                parent["samples"] + [new],
                parent,
                {**extension, "modelInferenceBeforeSelection": True},
            )
        with self.assertRaisesRegex(ValueError, "开发/验收"):
            inherited_splits(
                parent["samples"] + [{**new, "source": parent["samples"][0]["source"]}],
                parent,
                extension,
            )

    def validation_extension_fixture(self):
        d = self.inherited_fixture()
        old = d["parent-manifest.json"]["samples"]
        new = next(s for s in old if s["split"] == "train")
        old.remove(new)
        d["manifest.json"]["samples"][
            [s["store_id"] for s in d["manifest.json"]["samples"]].index(
                new["store_id"]
            )
        ]["split"] = "internal_val"
        d["manifest.json"]["validationExtensionSha256"] = "extension"
        d["manifest.json"]["files"]["validation-extension.json"] = "extension"
        d["validation-extension.json"] = {
            "newValidationIds": [new["store_id"]],
            "parentManifestSha256": "parent",
            "modelInferenceBeforeSelection": False,
            "frozenAt": "2026-11-11",
            "reason": "测试",
        }
        return d

    def test_bundle_validation_extension_bound_and_split_enforced(self):
        d = self.validation_extension_fixture()
        self.run_validation(d)
        sid = d["validation-extension.json"]["newValidationIds"][0]
        next(s for s in d["manifest.json"]["samples"] if s["store_id"] == sid)[
            "split"
        ] = "train"
        with self.assertRaisesRegex(ValueError, "冻结划分改变"):
            self.run_validation(d)

    def test_validation_extension_hash_and_parent_required(self):
        for field in ["validationExtensionSha256", "parentManifestSha256"]:
            d = self.validation_extension_fixture()
            d["manifest.json"][field] = "wrong"
            with self.subTest(field=field), self.assertRaises(ValueError):
                self.run_validation(d)
        d = self.validation_extension_fixture()
        d["validation-extension.json"]["parentManifestSha256"] = "wrong"
        with self.assertRaisesRegex(ValueError, "父版哈希"):
            self.run_validation(d)
        with self.assertRaisesRegex(ValueError, "文件改变"):
            self.run_validation(
                self.validation_extension_fixture(), "validation-extension.json"
            )

    def test_expansion_cannot_move_validation_into_training(self):
        d = self.inherited_fixture()
        samples = d["manifest.json"]["samples"]
        a = next(s for s in samples if s["split"] == "train")
        b = next(s for s in samples if s["split"] == "internal_val")
        a["split"], b["split"] = b["split"], a["split"]
        with self.assertRaisesRegex(ValueError, "冻结划分改变"):
            self.run_validation(d)

    def test_expansion_cannot_change_old_label_even_with_new_hash(self):
        d = self.inherited_fixture()
        d["manifest.json"]["files"]["TRAIN-000/mask.png"] = "new-valid-hash"
        with self.assertRaisesRegex(ValueError, "旧图像或标签"):
            self.run_validation(d)

    def test_expansion_parent_hash_required(self):
        d = self.inherited_fixture()
        d["manifest.json"]["parentManifestSha256"] = "wrong"
        with self.assertRaisesRegex(ValueError, "父版未绑定"):
            self.run_validation(d)

    def test_expansion_cannot_remove_old_store(self):
        d = self.inherited_fixture()
        d["manifest.json"]["samples"].pop()
        with self.assertRaisesRegex(ValueError, "移除此前门店"):
            self.run_validation(d)

    def test_expansion_cannot_replace_protection_lists(self):
        d = self.inherited_fixture()
        d["manifest.json"]["files"]["identity-only/acceptance-index.json"] = "new-hash"
        with self.assertRaisesRegex(ValueError, "替换保护清单"):
            self.run_validation(d)

    def test_replaced_identity_index_rejected(self):
        d = self.fixture()
        d["identity-only/acceptance-index.json"]["stores"][0][
            "name"
        ] = "替换身份仍保留数量"
        with self.assertRaisesRegex(ValueError, "冻结试点版本"):
            self.run_validation(d)

    def test_tampered_mask_rejected(self):
        with self.assertRaisesRegex(ValueError, "文件改变"):
            self.run_validation(self.fixture(), "TRAIN-000/mask.png")

    def test_protected_index_not_hashed_rejected(self):
        d = self.fixture()
        del d["manifest.json"]["files"]["identity-only/acceptance-index.json"]
        with self.assertRaisesRegex(ValueError, "未绑定"):
            self.run_validation(d)

    def test_incomplete_protected_index_rejected(self):
        d = self.fixture()
        d["identity-only/development-index.json"]["stores"].pop()
        with self.assertRaisesRegex(ValueError, "不完整"):
            self.run_validation(d)

    def test_deferred_sample_rejected(self):
        d = self.fixture()
        d["decisions.json"]["records"][0]["status"] = "deferred"
        with self.assertRaisesRegex(ValueError, "未准入"):
            self.run_validation(d)

    def test_overlay_substitution_rejected(self):
        d = self.fixture()
        s = d["manifest.json"]["samples"][0]
        s["image"] = "TRAIN-000/review.png"
        d["manifest.json"]["files"][s["image"]] = "overlay-digest"
        with self.assertRaisesRegex(ValueError, "原图"):
            self.run_validation(d)

    def test_changed_frozen_source_rejected(self):
        d = self.fixture()
        d["manifest.json"]["samples"][0]["source"]["sha256"] = "different"
        with self.assertRaisesRegex(ValueError, "冻结试点"):
            self.run_validation(d)

    def test_moved_validation_sample_rejected(self):
        d = self.fixture()
        s = d["manifest.json"]["samples"]
        a = next(x for x in s if x["split"] == "train")
        b = next(x for x in s if x["split"] == "internal_val")
        a["split"], b["split"] = b["split"], a["split"]
        with self.assertRaisesRegex(ValueError, "划分改变"):
            self.run_validation(d)

    def test_changed_polygon_rejected(self):
        d = self.fixture()
        d["TRAIN-000/polygon.json"]["polygonPx"] = [[2, 2], [8, 2], [8, 8], [2, 8]]
        with self.assertRaisesRegex(ValueError, "准入版本"):
            self.run_validation(d)


if __name__ == "__main__":
    unittest.main()
