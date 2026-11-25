import tempfile
import unittest
from hashlib import sha256
from pathlib import Path
from types import SimpleNamespace

from app import Catalog
from catalog import list_assets


class CatalogTests(unittest.TestCase):
    def setUp(self):
        self.path = Path(self.enterContext(tempfile.TemporaryDirectory()))
        self.catalog = Catalog(self.path)

    def test_empty_catalog_preserves_the_project_pilot(self):
        self.assertEqual(self.catalog.items, [])
        self.assertIsNone(self.catalog.file_response("unregistered", None, None, None))

    def test_lists_canonical_fields_and_filters(self):
        item = {
            "id": "asset-8", "name": "示例桌", "standardName": "中岛桌", "variant": "A",
            "function": "island_table", "placeable": True,
            "siFamily": "SI2.0", "category": "软装道具",
        }
        self.catalog.items = [item]
        request = SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(catalog=self.catalog)))
        self.assertEqual(list_assets(request, q=" 中岛 "), {"items": [item], "total": 1})
        self.assertEqual(list_assets(request, placeable="false")["total"], 0)
        self.assertEqual(list_assets(request, siFamily="SI1.0")["total"], 0)

    def test_registered_svg_is_cacheable_but_sandboxed(self):
        folder = self.path / "files"
        folder.mkdir()
        file = folder / "test.svg"
        file.write_bytes(b"<svg xmlns='http://www.w3.org/2000/svg'/>")
        digest = sha256(file.read_bytes()).hexdigest()
        self.catalog.files["registered"] = {
            "name": file.name, "contentType": "image/svg+xml", "sha256": digest,
        }
        response = self.catalog.file_response("registered", digest[:16], "160", None)
        self.assertEqual(response.path, file)
        self.assertEqual(response.media_type, "image/svg+xml")
        self.assertIn("sandbox", response.headers["content-security-policy"])
        self.assertIn("private", response.headers["cache-control"])
        cached = self.catalog.file_response("registered", digest[:16], None, response.headers["etag"])
        self.assertEqual(cached.status_code, 304)
