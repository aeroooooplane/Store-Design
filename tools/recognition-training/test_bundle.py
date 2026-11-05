"""无需真实门店文件，验证打包后篡改、未准入、同源替换均会失败。"""

import json
import unittest
from pathlib import Path
from unittest.mock import patch
from dataset import validate, split_ids, identity_index_sha


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
        ):
            return validate(root)

    def test_complete_fixture_passes(self):
        self.run_validation(self.fixture())

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
