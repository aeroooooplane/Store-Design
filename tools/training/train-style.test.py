"""CLI contracts: no model load for preflight, evidence gate and no overwrite."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

from PIL import Image

SCRIPT = Path(__file__).with_name('train-style.py')


class TrainerCliTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        self.root = Path(self.folder.name)
        self.rows = []
        for i, color in enumerate(('red', 'blue')):
            path = self.root / f'{i}.png'
            Image.new('RGB', (900, 500), color).save(path)
            self.rows.append({'file_name': path.name, 'image_sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
                             'style': 'SI1.0', 'store_id': str(i), 'split': 'train' if i == 0 else 'validation',
                             'text': 'camera store', 'training_eligible': False,
                             'label_usable_for_exploratory_trial': True, 'si_label_status': 'document_supported'})
        self.save_rows()

    def save_rows(self):
        (self.root / 'metadata.jsonl').write_text('\n'.join(json.dumps(r) for r in self.rows), encoding='utf8')

    def run_cli(self, *extra):
        return subprocess.run([sys.executable, str(SCRIPT), '--style', 'SI1.0', '--data-dir', str(self.root),
                               '--output-dir', str(self.root / 'out'), '--image-policy', 'keep-aspect',
                               '--preprocess-only', '--preview-suite', *extra], capture_output=True, text=True, encoding='utf8')

    def test_preflight_exports_real_inputs_and_latent_masks_without_loading_model(self):
        result = self.run_cli('--allow-exploratory-labels', '--base-model', 'deliberately-nonexistent-model')
        self.assertEqual(result.returncode, 0, result.stderr)
        entries = json.loads((self.root / 'out' / 'preprocessing.json').read_text())
        self.assertEqual(len(entries), 2)
        self.assertEqual(entries[0]['resized_size'], [64, 36])
        self.assertEqual(entries[0]['content_box'], [0, 14, 64, 50])
        self.assertEqual(entries[0]['crop_fraction'], 0)
        self.assertEqual(entries[0]['valid_latent_fraction'], .5)
        self.assertTrue((self.root / 'out' / entries[0]['preview_file']).is_file())
        self.assertTrue((self.root / 'out' / entries[0]['latent_mask_file']).is_file())
        plan = json.loads((self.root / 'out' / 'preview-plan.json').read_text())
        self.assertEqual(len(plan), 6)
        self.assertEqual({p['seed'] for p in plan}, {123, 456})
        self.assertFalse((self.root / 'out' / 'pytorch_lora_weights.safetensors').exists())

    def test_exploratory_data_requires_explicit_opt_in(self):
        result = self.run_cli()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('allow-exploratory-labels', result.stderr)
        self.assertFalse((self.root / 'out').exists())

    def test_conflicting_label_cannot_be_opted_into(self):
        self.rows[0]['si_label_status'] = 'suspected_error_or_conflict'
        self.rows[0]['label_usable_for_exploratory_trial'] = False
        self.save_rows()
        result = self.run_cli('--allow-exploratory-labels')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('not approved for exploratory', result.stderr)

    def test_existing_output_is_not_overwritten(self):
        out = self.root / 'out'
        out.mkdir()
        marker = out / 'keep.txt'
        marker.write_text('existing experiment')
        result = self.run_cli('--allow-exploratory-labels')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('existing experiment preserved', result.stderr)
        self.assertEqual(marker.read_text(), 'existing experiment')


if __name__ == '__main__':
    unittest.main()
