import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

from app import ApiError
from project_exchange import export_project, save_import
from storage import Database


class ExchangeStorageTests(unittest.TestCase):
    def setUp(self):
        directory = self.enterContext(tempfile.TemporaryDirectory())
        self.db = Database(Path(directory))
        self.db.initialize()
        self.db.initialize_workbench()
        rules = SimpleNamespace(run=lambda command, value: value)
        self.request = SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(db=self.db, rules=rules)))

    def plan(self):
        space = {"schemaVersion": 1, "height": 3.2, "ceiling": "film", "shopType": "side_hall",
                 "boundary": [[0, 0], [8, 0], [8, 6], [0, 6]], "entrances": [], "obstacles": []}
        layout = {"schemaVersion": 3, "items": [], "planning": None,
                  "fixtures": [{"id": "panel", "kind": "hollow_partition", "cx": 2, "cz": 2,
                                "w": 1, "d": 0.4, "h": 2.4, "rotation": 35}]}
        node = {"ref": "source", "parentRef": None, "kind": "space", "name": "虚构空间",
                "space": space, "layout": layout, "strategy": None, "siStyle": "SI2.0",
                "origin": "user", "importedFrom": None, "hidden": False}
        copy = {**node, "ref": "copy", "sourceRef": "source", "hidden": True}
        return {"name": "虚构项目导入验收", "shopType": "side_hall", "storeType": "camera_retailer",
                "market": "domestic", "siStyle": "SI2.0", "nodes": [node, copy],
                "draft": {"baseRef": "source", "layout": layout},
                "additionalDrafts": [{"baseRef": "copy", "layout": layout}],
                "format": "store-design-project", "warnings": []}

    def test_new_project_remaps_source_and_preserves_space_and_drafts(self):
        first = save_import(self.request, self.plan())
        second = save_import(self.request, self.plan())
        self.assertNotEqual(first["project"]["id"], second["project"]["id"])
        self.assertEqual(first["nodesImported"], 2)
        self.assertTrue(first["draftImported"])
        response = export_project(self.request, first["project"]["id"])
        exported = json.loads(response.body)
        self.assertEqual(exported["project"]["storeType"], "camera_retailer")
        self.assertEqual(exported["nodes"][0]["space"]["ceiling"], "film")
        self.assertEqual(exported["nodes"][1]["sourceNodeId"], exported["nodes"][0]["id"])
        self.assertTrue(exported["nodes"][1]["hidden"])
        self.assertEqual(len(exported["drafts"]), 2)
        self.assertEqual(exported["draft"]["layout"]["fixtures"][0]["rotation"], 35)
        self.assertIn("attachment", response.headers["content-disposition"])

    def test_invalid_reference_rolls_back_every_insert(self):
        plan = self.plan()
        plan["nodes"][1]["parentRef"] = "missing"
        with self.assertRaises(ApiError):
            save_import(self.request, plan)
        with self.db.connect() as db:
            for table in ("projects", "workbench_nodes", "workbench_drafts"):
                self.assertEqual(db.execute(f"SELECT count(*) FROM {table}").fetchone()[0], 0)
