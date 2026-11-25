import errno
import os
import runpy
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

PROBE = Path(__file__).parent / "probe" / "app.py"
check_persistence = runpy.run_path(str(PROBE))["check_persistence"]


class StorageProbeTests(unittest.TestCase):
    def setUp(self):
        self.directory = Path(self.enterContext(tempfile.TemporaryDirectory()))
        self.enterContext(patch.dict(os.environ, {"DATA_DIR": str(self.directory)}))

    def test_missing_directory_reports_stage_without_exposing_path(self):
        storage = self.directory / "missing"
        with patch.dict(os.environ, {"DATA_DIR": str(storage)}):
            fixture, result = check_persistence()
        self.assertIsNone(fixture)
        self.assertEqual(result["fixtureError"], {
            "stage": "stat-data-dir", "type": "FileNotFoundError", "errno": "ENOENT",
        })
        self.assertEqual(result["sqliteLock"], "skipped")

    def test_creates_configured_missing_directory_only_on_writable_nfs(self):
        for read_only in (True, False):
            directory = self.directory / str(read_only)
            mount = {"type": "nfs", "readOnly": read_only, "atDataDir": False}
            with patch.dict(os.environ, {"DATA_DIR": str(directory)}):
                with patch.dict(check_persistence.__globals__, {"filesystem_for": lambda _: mount}):
                    fixture, result = check_persistence()
            if read_only:
                self.assertFalse(directory.exists())
                self.assertEqual(result["fixtureError"]["errno"], "ENOENT")
            else:
                self.assertTrue(directory.is_dir())
                self.assertIsNotNone(fixture)
                self.assertEqual(result["sqliteBackup"], "restored")


    def test_failed_link_still_verifies_sqlite_lock_and_backup(self):
        with patch("os.link", side_effect=OSError(errno.EOPNOTSUPP, "synthetic unsupported link")):
            fixture, result = check_persistence()
        self.assertIsNone(fixture)
        self.assertEqual(result["fixtureError"]["stage"], "publish-fixture-link")
        self.assertEqual(result["sqliteLock"], "second-writer-blocked")
        self.assertEqual(result["sqliteBackup"], "restored")

    def test_published_fixture_does_not_change_between_runs(self):
        first, before = check_persistence()
        second, after = check_persistence()
        self.assertIsNotNone(first)
        self.assertEqual(first, second)
        self.assertEqual(before["persistence"], "fixture-ready")
        self.assertEqual(before["fixtureSha256"], after["fixtureSha256"])
        self.assertEqual(after["sqliteBackup"], "restored")
