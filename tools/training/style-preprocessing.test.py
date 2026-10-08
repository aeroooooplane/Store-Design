"""Regression tests: complete frame, bounded size, and masked padding loss."""
import importlib.util
from pathlib import Path
import unittest

import numpy as np
from PIL import Image, ImageDraw, ImageOps
import torch

spec = importlib.util.spec_from_file_location('style_preprocessing', Path(__file__).with_name('style_preprocessing.py'))
prep = None
if spec and Path(spec.origin).exists():
    prep = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(prep)


class PreprocessingTests(unittest.TestCase):
    def setUp(self):
        self.assertIsNotNone(prep, 'The frame-preserving preprocessing module must exist')

    def test_wide_image_keeps_all_four_colored_edges(self):
        # A center crop, stretch, or off-by-one content box breaks this fixture.
        im = Image.new('RGB', (1000, 500), 'white')
        draw = ImageDraw.Draw(im)
        draw.rectangle((0, 0, 39, 499), fill='red')
        draw.rectangle((960, 0, 999, 499), fill='blue')
        draw.rectangle((40, 0, 959, 39), fill='green')
        draw.rectangle((40, 460, 959, 499), fill='yellow')
        out, mask, info = prep.prepare_image(im, 512, 'keep-aspect')
        self.assertEqual(out.size, (512, 256))
        self.assertEqual(info['content_box'], [0, 0, 512, 256])
        self.assertEqual(out.getpixel((5, 128)), (255, 0, 0))
        self.assertEqual(out.getpixel((506, 128)), (0, 0, 255))
        self.assertEqual(out.getpixel((256, 5)), (0, 128, 0))
        self.assertEqual(out.getpixel((256, 250)), (255, 255, 0))
        self.assertTrue(np.all(mask == 1))

    def test_non_aligned_height_has_small_symmetric_padding(self):
        out, mask, info = prep.prepare_image(Image.new('RGB', (900, 500), 'red'), 512, 'keep-aspect')
        self.assertEqual(out.size, (512, 320))
        self.assertEqual(info['resized_size'], [512, 284])
        self.assertEqual(info['content_box'], [0, 18, 512, 302])
        self.assertEqual(float(mask.sum()), 512 * 284)
        self.assertEqual(float(mask[0].sum()), 0)
        self.assertLess(info['padding_fraction'], .12)
        self.assertEqual(info['crop_fraction'], 0)

    def test_portrait_and_extreme_panorama_are_bounded_and_aligned(self):
        for shape, expected in [((500, 900), (320, 512)), ((10000, 100), (512, 64)), ((512, 512), (512, 512))]:
            out, mask, info = prep.prepare_image(Image.new('RGB', shape), 512, 'keep-aspect')
            self.assertEqual(out.size, expected)
            self.assertEqual(mask.shape, (expected[1], expected[0]))
            self.assertEqual(info['crop_fraction'], 0)

    def test_legacy_center_crop_is_unchanged(self):
        im = Image.fromarray(np.arange(100 * 200 * 3, dtype=np.uint8).reshape(100, 200, 3))
        out, mask, info = prep.prepare_image(im, 64, 'center-crop')
        expected = ImageOps.fit(im, (64, 64), method=Image.Resampling.LANCZOS)
        np.testing.assert_array_equal(out, expected)
        self.assertTrue(np.all(mask == 1))
        self.assertAlmostEqual(info['crop_fraction'], .5)

    def test_bad_policy_or_non_aligned_limit_is_rejected(self):
        for size, policy in [(511, 'keep-aspect'), (0, 'keep-aspect'), (512, 'unknown')]:
            with self.assertRaises(ValueError):
                prep.prepare_image(Image.new('RGB', (20, 10)), size, policy)

    def test_latent_mask_excludes_blocks_touching_padding(self):
        mask = np.zeros((16, 16), dtype=np.float32)
        mask[0:12, :] = 1
        actual = prep.latent_mask(mask, (2, 2), 'cpu')
        torch.testing.assert_close(actual, torch.tensor([[[[1., 1.], [0., 0.]]]]))

    def test_masked_loss_and_gradient_ignore_padding_and_normalize_channels(self):
        pred = torch.tensor([[[[2., 100.]], [[4., -100.]]]], requires_grad=True)
        target = torch.zeros_like(pred)
        mask = torch.tensor([[[[1., 0.]]]])
        loss = prep.masked_mse(pred, target, mask)
        self.assertEqual(loss.item(), 10.)
        loss.backward()
        torch.testing.assert_close(pred.grad, torch.tensor([[[[2., 0.]], [[4., 0.]]]]))

    def test_masked_loss_rejects_empty_mask(self):
        with self.assertRaises(ValueError):
            prep.masked_mse(torch.zeros(1, 4, 2, 2), torch.zeros(1, 4, 2, 2), torch.zeros(1, 1, 2, 2))

    def test_all_valid_mask_matches_ordinary_mse(self):
        pred = torch.arange(16, dtype=torch.float32).reshape(1, 4, 2, 2)
        expected = torch.nn.functional.mse_loss(pred, torch.zeros_like(pred))
        self.assertEqual(prep.masked_mse(pred, torch.zeros_like(pred), torch.ones(1, 1, 2, 2)), expected)


if __name__ == '__main__':
    unittest.main()
