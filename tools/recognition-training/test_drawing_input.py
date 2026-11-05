import importlib.util
import unittest


@unittest.skipUnless(
    importlib.util.find_spec("numpy") and importlib.util.find_spec("PIL"),
    "需要完整训练环境",
)
class InputTests(unittest.TestCase):
    def test_dark_gray_background_and_faint_lines_get_full_range(self):
        from PIL import Image, ImageDraw
        from drawing_input import normalize_polarity

        im = Image.new("L", (200, 200), 12)
        ImageDraw.Draw(im).rectangle((50, 30, 150, 170), outline=130, width=3)
        normalized, flip = normalize_polarity(im)
        self.assertTrue(flip)
        self.assertGreaterEqual(normalized.getpixel((0, 0)), 254)
        self.assertEqual(normalized.getpixel((50, 70)), 0)

    def test_black_white_versions_normalize_identically_without_labels(self):
        from PIL import Image, ImageDraw, ImageOps
        import numpy as np
        from drawing_input import normalize_polarity

        white = Image.new("L", (240, 170), 255)
        d = ImageDraw.Draw(white)
        d.rectangle((65, 20, 175, 145), outline=0, width=2)
        d.line((65, 90, 175, 90), fill=0, width=2)
        a, flip_a = normalize_polarity(white)
        b, flip_b = normalize_polarity(ImageOps.invert(white))
        self.assertFalse(flip_a)
        self.assertTrue(flip_b)
        self.assertTrue(np.array_equal(a, b))

    def test_black_frame_does_not_invert_white_page(self):
        from PIL import Image, ImageDraw
        from drawing_input import normalize_polarity

        im = Image.new("L", (200, 200), 255)
        ImageDraw.Draw(im).rectangle((0, 0, 199, 199), outline=0, width=8)
        _, flip = normalize_polarity(im)
        self.assertFalse(flip)


if __name__ == "__main__":
    unittest.main()
