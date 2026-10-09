import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from render_core import cache_key, cache_hit, sha256_file, validate_view, validate_scale


class RenderCoreTests(unittest.TestCase):
    def test_camera_change_invalidates_only_that_camera(self):
        a = {'id': 'a', 'camera': 'front', 'lens': 35}
        b = {'id': 'b', 'camera': 'back', 'lens': 35}
        old_a = cache_key('scene1', a, 'white', {'samples': 8}, '4.5')
        old_b = cache_key('scene1', b, 'white', {'samples': 8}, '4.5')
        a['lens'] = 28
        self.assertNotEqual(old_a, cache_key('scene1', a, 'white', {'samples': 8}, '4.5'))
        self.assertEqual(old_b, cache_key('scene1', b, 'white', {'samples': 8}, '4.5'))

    def test_changed_scene_mode_samples_or_engine_invalidates(self):
        args = ['scene1', {'id': 'a'}, 'white', {'samples': 8}, '4.5']
        original = cache_key(*args)
        for index, value in [(0, 'scene2'), (2, 'material'), (3, {'samples': 16}), (4, '4.6')]:
            changed = args.copy()
            changed[index] = value
            self.assertNotEqual(original, cache_key(*changed))

    def test_existing_but_corrupted_output_is_not_cache_hit(self):
        with tempfile.TemporaryDirectory(prefix='render 中文 ') as directory:
            output = Path(directory) / 'a.png'
            output.write_bytes(b'original')
            entry = {'key': 'key1', 'sha256': sha256_file(output)}
            self.assertTrue(cache_hit(entry, 'key1', output))
            output.write_bytes(b'corrupted')
            self.assertFalse(cache_hit(entry, 'key1', output))
            self.assertFalse(cache_hit(entry, 'key2', output))

    def test_view_id_cannot_escape_output_folder(self):
        for invalid in ['../out', 'a/b', 'a\\b', '', 'C:out']:
            with self.assertRaises(ValueError):
                validate_view({'id': invalid, 'camera': 'front'})
        validate_view({'id': '01_front', 'camera': 'front'})

    def test_furniture_cannot_be_scaled_even_uniformly(self):
        validate_scale('island_a', 1)
        for value in [0, -1, .99, 1.01]:
            with self.assertRaises(ValueError):
                validate_scale('island_a', value)
        validate_scale('logo_full', .52)
        with self.assertRaises(ValueError):
            validate_scale('logo_full', -1)


if __name__ == '__main__':
    unittest.main()
