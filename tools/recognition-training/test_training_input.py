import importlib.util
import tempfile
import unittest
from pathlib import Path


@unittest.skipUnless(
    all(importlib.util.find_spec(x) for x in ["torch", "PIL", "numpy"]),
    "需要完整训练环境",
)
class TrainingInputTests(unittest.TestCase):
    def test_black_variant_keeps_coordinates_and_contrast_order(self):
        from PIL import Image, ImageDraw
        from drawing_input import synthetic_dark_page, normalize_polarity

        im = Image.new("L", (180, 120), 255)
        ImageDraw.Draw(im).rectangle((17, 23, 130, 90), outline=0, width=4)
        before = im.tobytes()
        dark = synthetic_dark_page(im)
        self.assertEqual(im.tobytes(), before)
        self.assertEqual(dark.size, im.size)
        self.assertEqual(dark.getpixel((0, 0)), 12)
        self.assertGreater(dark.getpixel((17, 40)), dark.getpixel((0, 0)))
        normalized, inverted = normalize_polarity(dark)
        self.assertTrue(inverted)
        self.assertEqual(normalized.getpixel((17, 40)), 0)
        self.assertGreaterEqual(normalized.getpixel((0, 0)), 254)

    def test_training_and_evaluation_preprocessing_match_without_mask_change(self):
        import numpy as np
        from PIL import Image, ImageDraw
        from train import read_samples, letterbox
        from drawing_input import normalize_polarity, synthetic_dark_page
        from dataset import save

        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            points = [[20, 20], [110, 20], [110, 65], [20, 65]]
            page = Image.new("L", (160, 90), 255)
            ImageDraw.Draw(page).polygon([tuple(p) for p in points], outline=0, width=2)
            synthetic_dark_page(page).save(root / "image.png")
            mask = Image.new("L", page.size)
            ImageDraw.Draw(mask).polygon([tuple(p) for p in points], fill=255)
            mask.save(root / "mask.png")
            save(
                root / "polygon.json",
                {"imageSize": list(page.size), "polygonPx": points},
            )
            m = {
                "samples": [
                    {
                        "store_id": "SYN-001",
                        "split": "train",
                        "image": "image.png",
                        "mask": "mask.png",
                        "polygon": "polygon.json",
                    }
                ]
            }
            raw = read_samples(root, m, 64)[0]
            normalized = read_samples(root, m, 64, True)[0]
            expected, _ = letterbox(
                normalize_polarity(Image.open(root / "image.png"))[0], 64
            )
            self.assertTrue(np.array_equal(normalized["x"].numpy()[0, 0], 1 - expected))
            self.assertTrue(np.array_equal(normalized["y"], raw["y"]))
            self.assertFalse(np.array_equal(normalized["x"], raw["x"]))


if __name__ == "__main__":
    unittest.main()
