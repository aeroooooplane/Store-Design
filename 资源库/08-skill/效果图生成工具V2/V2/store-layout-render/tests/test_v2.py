import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parents[1] / 'scripts'
sys.path.insert(0, str(SCRIPTS))


class V2Tests(unittest.TestCase):
    def require_module(self, name):
        self.assertIsNotNone(importlib.util.find_spec(name), f'Missing V2 implementation: {name}')
        return __import__(name)

    def test_grouped_passes_reduce_switches_without_adding_white_top(self):
        module = self.require_module('render_queue')
        views = [{'id': 'a'}, {'id': 'b'}, {'id': 'top', 'modes': ['material']}]
        self.assertEqual([(v['id'], m) for v, m in module.build_passes(views, 'both', 'grouped')],
                         [('a', 'material'), ('b', 'material'), ('top', 'material'), ('a', 'white'), ('b', 'white')])

    def test_explicit_group_not_xian_names_selects_new_project_preview(self):
        module = self.require_module('render_queue')
        job = {'views': [{'id': 'abc', 'camera': 'a'}, {'id': 'xyz', 'camera': 'b'}], 'view_groups': {'preview': ['xyz']}}
        self.assertEqual([v['id'] for v in module.select_views(job, '@preview')], ['xyz'])
        with self.assertRaises(ValueError):
            module.select_views(job, '@missing')

    def test_corrupt_same_key_is_backed_up_only_on_explicit_recovery(self):
        module = self.require_module('render_queue')
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'material/a.png'
            path.parent.mkdir()
            path.write_bytes(b'partial image')
            entry = {'key': 'same', 'sha256': 'different'}
            with self.assertRaises(FileExistsError):
                module.prepare_output(path, entry, 'same', False)
            backup = module.prepare_output(path, entry, 'same', True)
            self.assertFalse(path.exists())
            self.assertEqual(Path(backup).read_bytes(), b'partial image')

    def test_changed_settings_never_overwrite_completed_work(self):
        module = self.require_module('render_queue')
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'a.png'
            path.write_bytes(b'old')
            with self.assertRaises(FileExistsError):
                module.prepare_output(path, {'key': 'old'}, 'new', True)
            self.assertEqual(path.read_bytes(), b'old')

    def test_unowned_partial_cannot_be_assumed_same_configuration(self):
        module = self.require_module('render_queue')
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'a.partial.png'
            path.write_bytes(b'unknown')
            with self.assertRaises(FileExistsError):
                module.prepare_output(path, None, 'new-key', True)
            self.assertEqual(path.read_bytes(), b'unknown')

    def test_pdf_selection_and_cache_preserve_page_coordinates(self):
        module = self.require_module('pdf_cache')
        from reportlab.pdfgen.canvas import Canvas
        with tempfile.TemporaryDirectory(prefix='PDF 中文 ') as directory:
            path = Path(directory) / 'source.pdf'
            canvas = Canvas(str(path), pagesize=(300, 400))
            canvas.drawString(10, 370, 'PAGE ONE')
            canvas.line(10, 100, 110, 100)
            canvas.showPage()
            canvas.drawString(10, 370, 'PAGE TWO')
            canvas.save()
            first = module.extract(path, Path(directory) / 'cache', [1])
            self.assertEqual(first['parsed_pages'], 1)
            data = json.loads(Path(first['pages'][0]['path']).read_text(encoding='utf-8'))
            self.assertIn('PAGE ONE', data['text'])
            self.assertNotIn('PAGE TWO', data['text'])
            self.assertEqual(data['lines'][0]['points'], [[10, 300], [110, 300]])
            second = module.extract(path, Path(directory) / 'cache', [1])
            self.assertEqual(second['parsed_pages'], 0)
            self.assertEqual(second['cached_pages'], 1)
            third = module.extract(path, Path(directory) / 'cache', [2])
            self.assertEqual(third['parsed_pages'], 1)
            with self.assertRaises(ValueError):
                module.extract(path, Path(directory) / 'cache', [3])

    def test_preview_sheet_reports_missing_images_instead_of_omitting(self):
        module = self.require_module('contact_sheet')
        from PIL import Image
        with tempfile.TemporaryDirectory() as directory:
            directory = Path(directory)
            (directory / 'material').mkdir()
            Image.new('RGB', (60, 40), (255, 0, 0)).save(directory / 'material/a.png')
            result = module.make_sheet(directory, [{'id': 'a'}, {'id': 'b'}])
            self.assertEqual(result['missing'], ['b'])
            self.assertTrue((directory / 'preview-contact.jpg').exists())
            with Image.open(directory / 'preview-contact.jpg') as image:
                self.assertGreater(image.width, 600)

    def test_status_command_reports_absence_without_launching_blender(self):
        script = SCRIPTS / 'pipeline.py'
        self.assertTrue(script.exists(), 'Missing unified entry point')
        with tempfile.TemporaryDirectory() as directory:
            result = subprocess.run([sys.executable, str(script), 'status', '--out', directory], capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(json.loads(result.stdout)['state'], 'not_started')

    def test_status_flags_stale_initialization_without_controller(self):
        module = self.require_module('pipeline')
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'progress.json'
            path.write_text(json.dumps({'state': 'initializing', 'started_at': 1, 'updated_at': 1}))
            result = module.status(directory)
            self.assertTrue(result.get('check_process_if_stale'))

    def test_successful_check_persists_terminal_status(self):
        module = self.require_module('pipeline')
        self.assertTrue(hasattr(module, 'finish_check'), 'Check does not persist terminal status')
        with tempfile.TemporaryDirectory() as directory:
            module.finish_check(Path(directory), {'state': 'check_passed', 'selected_views': 5})
            self.assertEqual(module.status(directory)['state'], 'check_passed')

    def test_output_lock_blocks_second_process_and_releases_after_exit(self):
        module = self.require_module('render_queue')
        with tempfile.TemporaryDirectory() as directory:
            code = "import sys;sys.path.insert(0,sys.argv[1]);from render_queue import output_lock\nwith output_lock(sys.argv[2]): print('acquired')"
            with module.output_lock(directory):
                result = subprocess.run([sys.executable, '-c', code, str(SCRIPTS), directory], capture_output=True)
                self.assertNotEqual(result.returncode, 0)
            result = subprocess.run([sys.executable, '-c', code, str(SCRIPTS), directory], capture_output=True)
            self.assertEqual(result.returncode, 0, result.stderr)


if __name__ == '__main__':
    unittest.main()
