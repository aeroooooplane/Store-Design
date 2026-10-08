import importlib.util
from pathlib import Path
import unittest

spec=importlib.util.spec_from_file_location('catalog',Path(__file__).with_name('build-clean-catalog.py'))
catalog=importlib.util.module_from_spec(spec)
spec.loader.exec_module(catalog)

class NativeCatalogTests(unittest.TestCase):
    def test_same_native_hash_has_one_record_and_all_provenance(self):
        def page(pid,sid,path):
            return {'id':pid,'store_id':sid,'source_pdf':sid+'.pdf','source_sha256':'source',
                    'source_page':2,'category':'image_candidate','flags':[], 'master_si_unverified':'SI1.0',
                    'region_candidates':[{'box_normalized':[0,0,1,1],'native_image':{
                        'sha256':'same-image','path':path,'width':1600,'height':900,'pdf_transform':[1,0,0,1,0,0]}}]}
        rows=catalog.native_records([page('a','store-a','a.jpg'),page('b','store-b','b.jpg')])
        self.assertEqual(len(rows),1)
        self.assertEqual(len(rows[0]['occurrences']),2)
        self.assertEqual(rows[0]['stores'],['store-a','store-b'])
        self.assertFalse(rows[0]['training_eligible'])

    def test_small_and_extreme_aspect_images_are_flagged(self):
        self.assertIn('low_resolution',catalog.dimension_flags(300,200))
        self.assertIn('extreme_aspect_ratio',catalog.dimension_flags(4000,500))
        self.assertEqual(catalog.dimension_flags(1600,900),[])

    def test_decode_failure_shows_placeholder_not_broken_thumbnail(self):
        from html.parser import HTMLParser
        class Images(HTMLParser):
            def __init__(self):
                super().__init__(); self.images=[]
            def handle_starttag(self,tag,attrs):
                if tag=='img':self.images.append(dict(attrs))
        parser=Images()
        parser.feed(catalog.preview_html({'id':'broken','decode_verified':False}))
        self.assertEqual(parser.images,[])
        parser.feed(catalog.preview_html({'id':'valid','decode_verified':True}))
        self.assertEqual(len(parser.images),1)

if __name__=='__main__':
    unittest.main()
