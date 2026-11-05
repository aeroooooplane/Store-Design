import unittest
import tempfile
import importlib.util
from pathlib import Path
from dataset import check_isolation, polygon_check, split_ids, within, check_crop, sha


def store(id="TRAIN-001", name="独立门店", digest="a"):
    return {
        "store_id": id,
        "name": name,
        "aliases": [],
        "sameStoreKeys": [],
        "sourceSha256s": [digest],
    }


class IsolationTests(unittest.TestCase):
    def test_independent_passes(self):
        check_isolation([store()], [store("GOLD-001", "验收门店", "b")])

    def test_protected_id_rejected_even_renamed(self):
        with self.assertRaisesRegex(ValueError, "开发/验收"):
            check_isolation([store("GOLD-001")], [store("GOLD-001", "验收门店", "b")])

    def test_alias_spacing_and_case_rejected(self):
        p = store("GOLD-001", "Other", "b")
        p["aliases"] = ["Store A （1）"]
        with self.assertRaisesRegex(ValueError, "开发/验收"):
            check_isolation([store(name="store-a(1)")], [p])

    def test_same_store_key_rejected(self):
        a = store()
        b = store("DEV-001", "开发门店", "b")
        a["sameStoreKeys"] = ["name-旧店名"]
        b["sameStoreKeys"] = ["name-旧店名"]
        with self.assertRaisesRegex(ValueError, "开发/验收"):
            check_isolation([a], [b])

    def test_pdf_reused_under_new_id_rejected(self):
        with self.assertRaisesRegex(ValueError, "开发/验收"):
            check_isolation([store()], [store("DEV-001", "其他名称")])

    def test_source_object_also_checked(self):
        a = store()
        a["source"] = {"sha256": "protected"}
        with self.assertRaisesRegex(ValueError, "开发/验收"):
            check_isolation([a], [store("DEV-001", "其他名称", "protected")])

    def test_same_store_pages_cannot_split(self):
        a = store()
        b = store("TRAIN-002", "其他名称", "b")
        b["aliases"] = ["独立门店"]
        with self.assertRaisesRegex(ValueError, "同店/同源"):
            check_isolation([a, b], [])

    def test_same_pdf_pages_cannot_split(self):
        with self.assertRaisesRegex(ValueError, "同店/同源"):
            check_isolation([store(), store("TRAIN-002", "其他名称")], [])

    def test_empty_names_do_not_cause_collision(self):
        check_isolation([store(name="")], [store("DEV-001", "", "b")])

    def test_fullwidth_alias_normalization(self):
        with self.assertRaisesRegex(ValueError, "开发/验收"):
            check_isolation(
                [store(name="ＳｔｏｒｅＡ")], [store("DEV-001", "Store A", "b")]
            )


class CropTests(unittest.TestCase):
    @unittest.skipUnless(
        importlib.util.find_spec("PIL"), "裁图像素测试需要可选的训练环境Pillow"
    )
    def test_crop_pixels_and_provenance(self):
        from PIL import Image

        with tempfile.TemporaryDirectory() as td:
            src, cropped = Path(td) / "source.png", Path(td) / "crop.png"
            im = Image.new("RGB", (20, 10), "white")
            im.putpixel((4, 4), (0, 0, 0))
            im.save(src)
            im.crop((2, 2, 12, 8)).save(cropped)
            record = dict(
                sourceImage=str(src),
                sourceImageSha256=sha(src),
                sourceImageSize=[20, 10],
                image=str(cropped),
                cropBoxPx=[2, 2, 12, 8],
                cropBasis="document-panel-title",
            )
            check_crop(record)
            record["cropBoxPx"] = [2, 2, 22, 8]
            with self.assertRaisesRegex(ValueError, "裁图越界"):
                check_crop(record)
            record["cropBoxPx"] = [2, 2, 12, 8]
            Image.new("RGB", (10, 6), "white").save(cropped)
            with self.assertRaisesRegex(ValueError, "与原页不一致"):
                check_crop(record)


class GeometryAndSplitTests(unittest.TestCase):
    def test_concave_polygon_passes(self):
        polygon_check([[1, 1], [8, 1], [8, 8], [4, 8], [4, 4], [1, 4]], [10, 10])

    def test_bowtie_rejected(self):
        with self.assertRaisesRegex(ValueError, "自交"):
            polygon_check([[1, 1], [8, 8], [8, 1], [1, 8]], [10, 10])

    def test_self_touch_rejected(self):
        with self.assertRaises(ValueError):
            polygon_check([[1, 1], [8, 1], [8, 8], [4, 1], [1, 8]], [10, 10])

    def test_nan_rejected(self):
        with self.assertRaises(ValueError):
            polygon_check([[1, 1], [float("nan"), 2], [8, 8]], [10, 10])

    def test_out_of_bounds_rejected(self):
        with self.assertRaisesRegex(ValueError, "越界"):
            polygon_check([[1, 1], [10, 1], [8, 8]], [10, 10])

    def test_duplicate_vertex_rejected(self):
        with self.assertRaisesRegex(ValueError, "重复"):
            polygon_check([[1, 1], [8, 1], [8, 8], [1, 1]], [10, 10])

    def test_zero_area_rejected(self):
        with self.assertRaises(ValueError):
            polygon_check([[1, 1], [2, 2], [3, 3]], [10, 10])

    def test_split_is_stable_for_reordered_input(self):
        ids = ["A", "B", "C", "D", "E"]
        a = split_ids(ids, val_count=2)
        self.assertEqual(a, split_ids(ids[::-1], val_count=2))
        self.assertEqual(list(a.values()).count("internal_val"), 2)

    def test_empty_training_rejected(self):
        with self.assertRaises(ValueError):
            split_ids(["A", "B"], val_count=2)

    def test_path_traversal_rejected(self):
        td = Path(__file__).resolve().parent
        with self.assertRaisesRegex(ValueError, "越出"):
            within(td, "../secret.json")
        self.assertEqual(within(td, "data/image.png"), td / "data/image.png")


if __name__ == "__main__":
    unittest.main()
