import hashlib
import json
import os
import platform
import re
import sqlite3
import tempfile
from contextlib import closing
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import quote, urlsplit
from uuid import uuid4

ROOT = Path(__file__).resolve().parent
INSTANCE_ID = uuid4().hex


def prepare_fixture(directory):
    target = directory / "boldsite-probe.txt"
    if not target.exists():
        # Publish a complete file atomically even if deployment starts two processes.
        with tempfile.TemporaryDirectory(dir=directory) as scratch:
            source = Path(scratch) / "fixture.txt"
            source.write_bytes(("synthetic-boldsite-probe " + uuid4().hex + "\n").encode())
            with source.open("rb") as file:
                os.fsync(file.fileno())

            try:
                os.link(source, target)
            except FileExistsError:
                pass
    return target.read_bytes()


def check_sqlite(directory):
    with tempfile.TemporaryDirectory(dir=directory) as scratch:
        path = Path(scratch) / "probe.sqlite3"
        with closing(sqlite3.connect(path, timeout=0)) as writer:
            if writer.execute("PRAGMA journal_mode=DELETE").fetchone()[0] != "delete":
                return "journal-unavailable"
            writer.execute("BEGIN IMMEDIATE")
            with closing(sqlite3.connect(path, timeout=0)) as second:
                try:
                    second.execute("BEGIN IMMEDIATE")
                except sqlite3.OperationalError as error:
                    if getattr(error, "sqlite_errorcode", None) == getattr(sqlite3, "SQLITE_BUSY", 5):
                        return "second-writer-blocked"
                    if str(error) == "database is locked":
                        return "second-writer-blocked"
                    raise
            return "second-writer-acquired"


def check_persistence():
    configured = os.environ.get("DATA_DIR", "").strip()
    if not configured:
        return None, "data-dir-missing", "skipped"
    directory = Path(configured)
    try:
        fixture = prepare_fixture(directory)
    except OSError:
        return None, "fixture-unavailable", "skipped"
    try:
        return fixture, "fixture-ready", check_sqlite(directory)
    except (OSError, sqlite3.Error):
        return fixture, "fixture-ready", "sqlite-check-failed"


class Handler(BaseHTTPRequestHandler):
    def respond(self, status, data, content_type, **headers):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        for name, value in headers.items():
            self.send_header(name, value)
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        url = urlsplit(self.path)
        prefix = re.match(r"^/svc/[^/]+(?=/|$)", url.path)
        path = url.path[len(prefix[0]):] if prefix else url.path
        if not path and prefix:
            self.respond(307, b"", "text/plain", Location=quote(prefix[0], safe="/%") + "/")
        elif path in ("/", "/index.html"):
            self.respond(200, (ROOT / "index.html").read_bytes(), "text/html; charset=utf-8")
        elif path == "/workbench/v1/probe":
            result = {
                "release": (ROOT / "release.txt").read_text(encoding="utf-8").strip(),
                "instanceId": INSTANCE_ID,
                "python": platform.python_version(),
                "implementation": platform.python_implementation(),
                "system": platform.system(),
                "architecture": platform.machine(),
                "libc": platform.libc_ver(),
                "sqlite": sqlite3.sqlite_version,
                "persistence": persistence,
                "fixtureSha256": hashlib.sha256(fixture).hexdigest() if fixture else None,
                "sqliteLock": sqlite_lock,
            }
            self.respond(200, json.dumps(result).encode(), "application/json")
        elif path == "/workbench/v1/fixture" and fixture:
            self.respond(200, fixture, "text/plain", **{
                "Content-Disposition": 'attachment; filename="synthetic-boldsite-probe.txt"',
                "X-Content-Type-Options": "nosniff",
            })
        elif path == "/workbench/v1/fixture":
            self.respond(503, b"fixture unavailable", "text/plain")
        else:
            self.respond(404, b"not found", "text/plain")


if __name__ == "__main__":
    fixture, persistence, sqlite_lock = check_persistence()
    with ThreadingHTTPServer(("0.0.0.0", int(os.environ.get("CAPort", "9000"))), Handler) as server:
        server.serve_forever()
