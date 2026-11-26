import tempfile
import unittest
from pathlib import Path
from urllib.parse import urlsplit

from app import ServicePrefix
from contract import FullWorkbenchTransport
from storage import Database, timestamp


class WorkbenchTransportTests(unittest.IsolatedAsyncioTestCase):
    async def request(self, path, *, token="a" * 43, method="POST"):
        target = urlsplit(path)
        scope = {
            "type": "http", "scheme": "https", "root_path": "",
            "method": method, "path": target.path, "query_string": target.query.encode("ascii"),
            "headers": [(b"content-type", ("application/json; workbench-token=" + token).encode("ascii"))],
        }
        forwarded, output = [], []

        async def receiver():
            return {"type": "http.request", "body": b""}

        async def send(message):
            output.append(message)

        async def downstream(accepted, receive, respond):
            forwarded.append(accepted)

        gateway = ServicePrefix(FullWorkbenchTransport(downstream, "a" * 43))
        await gateway(scope, receiver, send)
        return forwarded, output

    async def test_restores_method_and_revision_under_service_mount(self):
        requests, output = await self.request(
            "/svc/app/workbench/v1/_write/put/projects/p/draft?from=plan&__workbench_if_match=%222%22",
        )
        self.assertFalse(output)
        self.assertEqual(len(requests), 1)
        scope = requests[0]
        self.assertEqual(scope["method"], "PUT")
        self.assertEqual(scope["path"], "/workbench/v1/projects/p/draft")
        self.assertEqual(scope["query_string"], b"from=plan")
        self.assertIn((b"if-match", b'"2"'), scope["headers"])

    async def test_rejects_invalid_token_and_ambiguous_revisions(self):
        target = "/svc/app/workbench/v1/_write/delete/projects/p"
        for query, token, code in [
            ("", "b" * 43, 403),
            ("?__workbench_if_match=1&__workbench_if_match=2", "a" * 43, 400),
        ]:
            with self.subTest(code=code):
                requests, output = await self.request(target + query, token=token)
                self.assertFalse(requests)
                self.assertEqual(output[0]["status"], code)


class WorkbenchStorageTests(unittest.TestCase):
    def test_additive_tables_keep_earlier_project_and_schema_version(self):
        with tempfile.TemporaryDirectory() as directory:
            db = Database(Path(directory))
            db.initialize()
            now = timestamp()
            with db.connect(write=True) as conn:
                conn.execute("""
                    INSERT INTO projects (id, name, shopType, market, siStyle, createdAt, updatedAt)
                    VALUES ('project', '虚构项目', 'side_hall', 'domestic', 'SI2.0', ?, ?)
                """, (now, now))
            db.initialize_workbench()
            db.initialize_workbench()

            previous_release = Database(Path(directory))
            previous_release.initialize()
            with previous_release.connect() as conn:
                self.assertEqual(conn.execute("PRAGMA user_version").fetchone()[0], 1)
                self.assertEqual(conn.execute("SELECT name FROM projects").fetchone()[0], "虚构项目")
                self.assertEqual(conn.execute("SELECT COUNT(*) FROM workbench_nodes").fetchone()[0], 0)

    def test_source_column_is_added_to_an_existing_history(self):
        with tempfile.TemporaryDirectory() as directory:
            db = Database(Path(directory))
            db.initialize()
            with db.connect(write=True) as conn:
                conn.execute("""
                    CREATE TABLE workbench_nodes (
                        seq INTEGER PRIMARY KEY AUTOINCREMENT,
                        id TEXT NOT NULL UNIQUE,
                        projectId TEXT NOT NULL REFERENCES projects(id),
                        name TEXT NOT NULL
                    )
                """)
                now = timestamp()
                conn.execute("""
                    INSERT INTO projects (id, name, shopType, market, siStyle, createdAt, updatedAt)
                    VALUES ('p', '虚构项目', 'side_hall', 'domestic', 'SI2.0', ?, ?)
                """, (now, now))
                conn.execute("INSERT INTO workbench_nodes (id, projectId, name) VALUES ('n', 'p', '旧方案')")
            db.initialize_workbench()
            db.initialize_workbench()
            with db.connect() as conn:
                row = conn.execute("SELECT name, sourceNodeId FROM workbench_nodes WHERE id = 'n'").fetchone()
                self.assertEqual((row["name"], row["sourceNodeId"]), ("旧方案", None))
