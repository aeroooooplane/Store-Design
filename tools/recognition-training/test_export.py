"""数值回归使用完整训练环境；轻量CI显式跳过运行时依赖项。"""

import importlib.util
import unittest


@unittest.skipUnless(
    importlib.util.find_spec("torch") and importlib.util.find_spec("numpy"),
    "需要本地训练环境",
)
class ExportTests(unittest.TestCase):
    def test_export_copy_preserves_weights_and_original_modules(self):
        import torch
        from torch import nn
        from export_model import export_copy, ExportGroupNorm

        torch.manual_seed(37)
        original = nn.Sequential(nn.Conv2d(1, 8, 3, padding=1), nn.GroupNorm(4, 8))
        converted = export_copy(original)
        self.assertIsInstance(original[1], nn.GroupNorm)
        self.assertIsInstance(converted[1], ExportGroupNorm)
        for key, value in original.state_dict().items():
            self.assertTrue(torch.equal(value, converted.state_dict()[key]))
            self.assertNotEqual(
                value.data_ptr(), converted.state_dict()[key].data_ptr()
            )

    def test_centered_statistics_on_constant_and_low_contrast(self):
        import torch
        from torch import nn
        from export_model import ExportGroupNorm

        torch.set_num_threads(2)
        torch.manual_seed(37)
        for affine in (True, False):
            norm = nn.GroupNorm(4, 8, affine=affine)
            converted = ExportGroupNorm(norm)
            for x in [
                torch.full((1, 8, 256, 256), 0.5),
                torch.full((1, 8, 256, 256), 0.5) + torch.randn(1, 8, 256, 256) * 1e-5,
            ]:
                with torch.no_grad():
                    diff = (norm(x) - converted(x)).abs().max().item()
                self.assertLess(diff, 0.0001)


if __name__ == "__main__":
    unittest.main()
