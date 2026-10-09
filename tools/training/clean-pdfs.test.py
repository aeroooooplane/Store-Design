import importlib.util
import tempfile
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('clean_pdfs', Path(__file__).with_name('clean-pdfs.py'))
clean = importlib.util.module_from_spec(spec)
spec.loader.exec_module(clean)

class CleaningTests(unittest.TestCase):
    def test_cover_mentioning_render_is_not_a_render(self):
        self.assertEqual(clean.page_category('授权体验店 平面图 & 效果图 & 施工图 2025.12 115平方米', 1, 0), 'cover_candidate')

    def test_contents_mentions_do_not_become_training(self):
        self.assertEqual(clean.page_category('图 纸 目 录\n家具平面布置图\n效果图\n天花图', 2, 0), 'contents')

    def test_plan_on_first_page_is_retained(self):
        self.assertEqual(clean.page_category('家具平面布置图\n6700\n2400\n体验桌', 1, 0), 'plan_candidate')

    def test_sparse_text_image_needs_visual_review(self):
        self.assertEqual(clean.page_category('', 3, .9), 'image_candidate')
        self.assertEqual(clean.page_category('', 3, 0), 'unknown')

    def test_specification_body_does_not_become_elevation(self):
        self.assertEqual(clean.page_category('设计施工说明\n所有立面图应与平面图核对。'*20, 4, 0), 'specification')

    def test_benign_outline_and_content_errors_are_separate(self):
        self.assertFalse(clean.content_warning('Bad or missing parent pointer in outline tree, repairing'))
        self.assertTrue(clean.content_warning('syntax error: unknown keyword'))
        self.assertTrue(clean.content_warning('cannot find object in xref (6 0 R)'))

    def test_split_preserves_page_dimensions_rotation_and_render(self):
        import fitz
        with tempfile.TemporaryDirectory() as folder:
            original = fitz.open()
            page = original.new_page(width=360, height=240)
            page.insert_text((30, 60), 'test source')
            page.draw_rect(fitz.Rect(50, 90, 180, 180), color=(1,0,0))
            page.set_rotation(90)
            original.new_page()
            out = Path(folder)/'page.pdf'
            clean.split_page(original, 0, out)
            with fitz.open(out) as result:
                self.assertEqual(len(result), 1)
                self.assertEqual(result[0].rotation, 90)
                self.assertEqual(result[0].rect, original[0].rect)
                self.assertEqual(result[0].get_pixmap().samples, original[0].get_pixmap().samples)
            original.close()

    def test_near_duplicate_search_does_not_discard_pages(self):
        tree = clean.HashIndex()
        tree.add(0b101010, 'a')
        self.assertEqual(tree.find(0b101011, 1), [('a', 1)])
        self.assertEqual(tree.find(0b111111, 1), [])

    def test_native_image_extraction_omits_pdf_overlay_without_inpainting(self):
        import fitz
        from PIL import Image
        import io
        with tempfile.TemporaryDirectory() as folder:
            image = Image.new('RGB', (320,240), (70,90,110))
            buf = io.BytesIO()
            image.save(buf, format='PNG')
            doc = fitz.open()
            page = doc.new_page(width=320,height=240)
            xref = page.insert_image(page.rect,stream=buf.getvalue())
            page.insert_text((30,50),'1234',fontsize=30,color=(1,0,0))
            record = clean.extract_native_image(doc,xref,Path(folder)/'native')
            with Image.open(record['path']) as extracted:
                self.assertEqual(extracted.convert('RGB').tobytes(),image.tobytes())
            self.assertEqual(record['method'],'original_embedded_raster_not_inpainted')
            doc.close()

    def test_real_pdf_with_existing_alpha_and_soft_mask_can_extract(self):
        import fitz
        source=clean.ROOT/'资源库/01_各门店原图纸/上海龙湖宝山天街.pdf'
        if not source.exists():
            self.skipTest('Local corpus integration fixture unavailable')
        with tempfile.TemporaryDirectory() as folder, fitz.open(source) as doc:
            candidates=[i[0] for page in doc for i in page.get_images(full=True)
                        if i[1] and fitz.Pixmap(doc,i[0]).alpha]
            self.assertTrue(candidates)
            record=clean.extract_native_image(doc,candidates[0],Path(folder)/'alpha')
            self.assertTrue(Path(record['path']).exists())

    def test_fallback_split_preserves_form_appearance_and_field(self):
        import fitz
        from pypdf import PdfReader
        source=clean.ROOT/'资源库/01_各门店原图纸/天津百脑汇照材专卖店.pdf'
        if not source.exists():
            self.skipTest('Local corpus fixture unavailable')
        with tempfile.TemporaryDirectory() as folder, fitz.open(source) as doc:
            path=Path(folder)/'single.pdf'
            method=clean.split_page(doc,1,path)
            with fitz.open(path) as single:
                self.assertEqual(single[0].get_pixmap().samples,doc[1].get_pixmap().samples)
            self.assertEqual(len(PdfReader(path).get_fields()),1)
            self.assertEqual(method,'pypdf_fallback_requires_review')

    def test_missing_object_source_split_has_explicit_recovery_status(self):
        import fitz
        source=clean.ROOT/'资源库/01_各门店原图纸/台湾远东新竹Big City中岛.pdf'
        if not source.exists():
            self.skipTest('Local corpus fixture unavailable')
        with tempfile.TemporaryDirectory() as folder, fitz.open(source) as doc:
            path=Path(folder)/'single.pdf'
            method=clean.split_page(doc,0,path)
            with fitz.open(path) as single:
                self.assertEqual(single[0].get_pixmap().samples,doc[0].get_pixmap().samples)
            self.assertEqual(method,'pypdf_fallback_requires_review')

if __name__ == '__main__':
    unittest.main()
