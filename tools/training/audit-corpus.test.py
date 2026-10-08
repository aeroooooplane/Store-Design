import importlib.util
import unittest
import tempfile
import json
from pathlib import Path

spec = importlib.util.spec_from_file_location('audit', Path(__file__).with_name('audit-corpus.py'))
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)

class CandidateTests(unittest.TestCase):
    def test_scan_invalidates_old_cache_and_reports_pdf_repair(self):
        # Removing warning collection or accepting a v1 cache hides repaired PDFs.
        import fitz
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            doc = fitz.open()
            doc.new_page()
            raw = doc.tobytes()
            doc.close()
            import re
            raw = re.sub(rb'startxref\s+\d+', b'startxref\n0', raw)
            pdf = root/'broken.pdf'
            pdf.write_bytes(raw)
            (root/'fixture.json').write_text(json.dumps({'classifier_version':1,'pages':[], 'page_count':0}))
            result = audit.scan_pdf(pdf, 'fixture', root)
            self.assertEqual(result['page_count'], 1)
            self.assertTrue(result.get('parse_warnings'))
            self.assertFalse(result['pages'][0]['training_eligible'])

    def test_contents_does_not_become_plan_or_render(self):
        self.assertEqual(audit.classify('图 纸 目 录 平面布置图 效果图 立面图'), ['contents', 'image_or_sparse_text'])

    def test_multiple_types_require_review(self):
        result = audit.classify('平面布置图 / 效果图 以及大量其他注释' * 4)
        self.assertIn('plan', result)
        self.assertIn('render', result)

    def test_no_text_is_not_automatically_a_render(self):
        self.assertEqual(audit.classify(''), ['image_or_sparse_text'])

    def test_spaced_plan_title(self):
        self.assertIn('plan', audit.classify('平 面 布 置 图'))

if __name__ == '__main__':
    unittest.main()
