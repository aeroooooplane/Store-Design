import importlib.util
import unittest


@unittest.skipUnless(
    importlib.util.find_spec("torch"), "数值损失测试需要完整训练环境torch"
)
class NegativeInkTests(unittest.TestCase):
    def test_weights_cover_outside_ink_only_and_no_label_gradient(self):
        import torch
        from negative_loss import negative_ink_weights

        ink = torch.zeros(1, 1, 16, 16, requires_grad=True)
        with torch.no_grad():
            ink[0, 0, 4, 4] = 1
            ink[0, 0, 12, 12] = 1
        y = torch.zeros_like(ink)
        y[:, :, 10:, 10:] = 1
        w = negative_ink_weights(ink, y, 2)
        self.assertEqual(w[0, 0, 4, 4].item(), 3)
        self.assertEqual(w[0, 0, 6, 6].item(), 3)
        self.assertEqual(w[0, 0, 0, 0].item(), 1)
        self.assertTrue(torch.all(w[y.bool()] == 1))
        self.assertFalse(w.requires_grad)

    def test_default_loss_unchanged_and_wrong_foreground_has_larger_gradient(self):
        import torch
        import torch.nn.functional as F
        from train import loss_fn

        z = torch.zeros(1, 1, 16, 16, requires_grad=True)
        y = torch.zeros_like(z)
        x = torch.zeros_like(z)
        x[:, :, 4, 4] = 1
        dice = (2 * (z.sigmoid() * y).sum() + 1) / (z.sigmoid().sum() + y.sum() + 1)
        expected = F.binary_cross_entropy_with_logits(z, y) + 1 - dice
        self.assertAlmostEqual(loss_fn(z, y).item(), expected.item(), places=6)
        loss_fn(z, y, ink=x, negative_ink_weight=2).backward()
        self.assertGreater(z.grad[0, 0, 4, 4].item(), z.grad[0, 0, 0, 0].item() * 2)

    def test_invalid_strength_and_shapes_rejected(self):
        import torch
        from negative_loss import negative_ink_weights

        x = torch.zeros(1, 1, 8, 8)
        for v in [-1, float("nan"), float("inf")]:
            with self.subTest(v=v), self.assertRaises(ValueError):
                negative_ink_weights(x, x, v)
        with self.assertRaises(ValueError):
            negative_ink_weights(x, x[:, :, :4], 2)
