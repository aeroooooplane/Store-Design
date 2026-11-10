import importlib.util
import unittest
from dataset import outline_parts, outline_fields, outline_mask, check_mask


class MultipartTests(unittest.TestCase):
    def setUp(self):
        self.main = [[1, 10], [18, 10], [18, 18], [1, 18]]
        self.warehouse = [[1, 1], [6, 1], [6, 5], [1, 5]]
        self.record = {"imageSize": [20, 20], "polygonsPx": [self.main, self.warehouse]}

    def test_legacy_field_kept(self):
        old = {"imageSize": [20, 20], "polygonPx": self.main}
        self.assertEqual(outline_fields(old), {"polygonPx": self.main})

    def test_ambiguous_fields_rejected(self):
        with self.assertRaisesRegex(ValueError, "一种"):
            outline_parts({**self.record, "polygonPx": self.main})

    def test_empty_rejected(self):
        with self.assertRaisesRegex(ValueError, "为空"):
            outline_parts({"imageSize": [20, 20], "polygonsPx": []})

    def test_each_part_validated(self):
        with self.assertRaisesRegex(ValueError, "越界"):
            outline_parts(
                {
                    "imageSize": [20, 20],
                    "polygonsPx": [self.main, [[21, 1], [6, 1], [6, 5]]],
                }
            )

    @unittest.skipUnless(importlib.util.find_spec("PIL"), "需要可选Pillow")
    def test_corridor_excluded_and_warehouse_kept(self):
        mask = outline_mask(self.record)
        self.assertEqual(mask.getpixel((3, 3)), 255)
        self.assertEqual(mask.getpixel((10, 15)), 255)
        self.assertEqual(mask.getpixel((3, 8)), 0)
        self.assertEqual(mask.getpixel((10, 3)), 0)

    @unittest.skipUnless(importlib.util.find_spec("PIL"), "需要可选Pillow")
    def test_old_raster_unchanged(self):
        from PIL import Image, ImageDraw

        old = Image.new("L", (20, 20), 0)
        ImageDraw.Draw(old).polygon([tuple(p) for p in self.main], fill=255)
        self.assertEqual(
            outline_mask({"imageSize": [20, 20], "polygonPx": self.main}).tobytes(),
            old.tobytes(),
        )

    @unittest.skipUnless(importlib.util.find_spec("PIL"), "需要可选Pillow")
    def test_mask_bridge_tamper_rejected(self):
        import tempfile
        from pathlib import Path

        with tempfile.TemporaryDirectory() as td:
            p = Path(td) / "mask.png"
            mask = outline_mask(self.record)
            mask.save(p)
            check_mask(p, self.record)
            mask.putpixel((3, 8), 255)
            mask.save(p)
            with self.assertRaisesRegex(ValueError, "桥接"):
                check_mask(p, self.record)


if __name__ == "__main__":
    unittest.main()
