import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from storage import Database
from storage_gate import StorageBusy, exclusive_storage

HERE = Path(__file__).resolve().parent


class StorageGateTests(unittest.TestCase):
    def setUp(self):
        self.directory = Path(self.enterContext(tempfile.TemporaryDirectory()))
        self.db = Database(self.directory)
        self.db.initialize()

    def child(self, body):
        return subprocess.run(
            [sys.executable, "-c", body, str(self.directory)],
            cwd=HERE, check=True, capture_output=True, text=True, timeout=12,
        ).stdout.strip()

    def test_another_process_cannot_open_database_gate(self):
        child = """
import sys
from pathlib import Path
from storage import Database
from storage_gate import StorageBusy, exclusive_storage

db = Database(Path(sys.argv[1]))
try:
    with exclusive_storage(db.gate, timeout=0):
        print("acquired")
except StorageBusy:
    print("blocked")
"""
        with self.db.connect(write=True):
            self.assertEqual(self.child(child), "blocked")
        self.assertEqual(self.child(child), "acquired")

    def test_failed_transaction_releases_gate_without_committing(self):
        with self.assertRaisesRegex(RuntimeError, "abort"):
            with self.db.connect(write=True) as connection:
                connection.execute("CREATE TABLE aborted_write (value TEXT)")
                raise RuntimeError("abort")
        self.assertFalse(self.db.gate.exists())
        with self.db.connect() as connection:
            self.assertIsNone(connection.execute(
                "SELECT name FROM sqlite_master WHERE name = 'aborted_write'"
            ).fetchone())

    def test_existing_gate_is_never_removed_by_a_contender(self):
        self.db.gate.mkdir()
        with self.assertRaises(StorageBusy):
            with exclusive_storage(self.db.gate, timeout=0):
                self.fail("Contender entered the existing gate")
        self.assertTrue(self.db.gate.is_dir())
