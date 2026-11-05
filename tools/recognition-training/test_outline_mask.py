import importlib.util
import unittest


@unittest.skipUnless(importlib.util.find_spec("numpy"), "需要训练环境numpy")
class MaskTests(unittest.TestCase):
    def test_remove_text_island_and_fill_internal_hole(self):
        import numpy as np
        from outline_mask import clean_outline

        x = np.zeros((20, 20), bool)
        x[4:16, 4:16] = True
        x[8:10, 8:10] = False
        x[1, 1] = True
        y = clean_outline(x)
        self.assertEqual(y.sum(), 144)
        self.assertFalse(y[1, 1])
        self.assertTrue(y[8, 8])

    def test_concave_notch_and_empty_are_preserved(self):
        import numpy as np
        from outline_mask import clean_outline

        x = np.zeros((20, 20), bool)
        x[4:16, 4:16] = True
        x[4:10, 8:12] = False
        self.assertTrue(np.array_equal(x, clean_outline(x)))
        self.assertFalse(clean_outline(np.zeros_like(x)).any())


if __name__ == "__main__":
    unittest.main()
