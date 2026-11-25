import errno
import hashlib
import json
import os
import platform
import re
import sqlite3
import stat
import tempfile
from contextlib import closing
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import quote, urlsplit
from uuid import uuid4

ROOT = Path(__file__).resolve().parent
INSTANCE_ID = uuid4().hex


class ProbeFailure(Exception):
    def __init__(self, stage, error):
        self.result = {"stage": stage, "type": type(error).__name__, "errno": errno.errorcode.get(error.errno)}


def step(stage, action, *args, **kwargs):
    try:
        return action(*args, **kwargs)
    except OSError as error:
        raise ProbeFailure(stage, error) from error


def filesystem_for(directory):
    # Report only filesystem metadata, never environment values or host paths.
    try:
        mounts = Path("/proc/self/mountinfo").read_text(encoding="utf-8").splitlines()
        resolved = directory.resolve()
    except OSError:
        return None

    candidates = []
    for line in mounts:
        left, separator, right = line.partition(" - ")
        if not separator:
            continue
        fields, detail = left.split(), right.split()
        mount = Path(re.sub(r"\\([0-7]{3})", lambda match: chr(int(match[1], 8)), fields[4]))
        if resolved.is_relative_to(mount):
            read_only = "ro" in fields[5].split(",") or "ro" in detail[2].split(",")
            candidates.append((len(mount.parts), {
                "type": detail[0], "readOnly": read_only, "atDataDir": resolved == mount,
            }))
    return max(candidates, key=lambda match: match[0])[1] if candidates else None


def prepare_fixture(directory):
    target = directory / "boldsite-probe.txt"
    try:
        return target.read_bytes()
    except FileNotFoundError:
        pass
    except OSError as error:
        raise ProbeFailure("read-existing-fixture", error) from error

    # Publish a complete file atomically even if deployment starts two processes.
    with step("create-fixture-scratch", tempfile.TemporaryDirectory, dir=directory) as scratch:
        source = Path(scratch) / "fixture.txt"
        contents = ("synthetic-boldsite-probe " + uuid4().hex + "\n").encode()
        step("write-fixture", source.write_bytes, contents)
        with step("open-fixture-for-sync", source.open, "r+b") as file:
            step("sync-fixture", os.fsync, file.fileno())
        try:
            os.link(source, target)
        except FileExistsError:
            pass
        except OSError as error:
            raise ProbeFailure("publish-fixture-link", error) from error
    return step("read-published-fixture", target.read_bytes)


def check_sqlite(directory):
    with tempfile.TemporaryDirectory(dir=directory) as scratch:
        path = Path(scratch) / "probe.sqlite3"
        with closing(sqlite3.connect(path, timeout=0)) as writer:
            if writer.execute("PRAGMA journal_mode=DELETE").fetchone()[0] != "delete":
                return "journal-unavailable", "skipped"
            writer.execute("CREATE TABLE sample (value TEXT NOT NULL)")
            writer.execute("INSERT INTO sample VALUES ('synthetic')")
            writer.commit()
            writer.execute("BEGIN IMMEDIATE")
            with closing(sqlite3.connect(path, timeout=0)) as second:
                try:
                    second.execute("BEGIN IMMEDIATE")
                except sqlite3.OperationalError as error:
                    if getattr(error, "sqlite_errorcode", None) != getattr(sqlite3, "SQLITE_BUSY", 5):
                        if str(error) != "database is locked":
                            raise
                    lock = "second-writer-blocked"
                else:
                    lock = "second-writer-acquired"
            writer.rollback()
            with closing(sqlite3.connect(Path(scratch) / "restored.sqlite3")) as restored:
                writer.backup(restored)
                result = restored.execute("SELECT value FROM sample").fetchone()
                integrity = restored.execute("PRAGMA integrity_check").fetchone()
                backup = "restored" if result == ("synthetic",) and integrity == ("ok",) else "invalid"
            return lock, backup


def check_persistence():
    result = {
        "persistence": "data-dir-missing",
        "fixtureSha256": None,
        "sqliteLock": "skipped",
        "sqliteBackup": "skipped",
    }
    configured = os.environ.get("DATA_DIR", "").strip()
    if not configured:
        return None, result

    directory = Path(configured)
    result["filesystem"] = filesystem_for(directory)
    try:
        mode = step("stat-data-dir", directory.stat).st_mode
        if not stat.S_ISDIR(mode):
            raise ProbeFailure("stat-data-dir", NotADirectoryError(errno.ENOTDIR, "not a directory"))
    except ProbeFailure as error:
        result["persistence"] = "data-dir-unavailable"
        result["fixtureError"] = error.result
        return None, result

    fixture = None
    try:
        fixture = prepare_fixture(directory)
        result["persistence"] = "fixture-ready"
        result["fixtureSha256"] = hashlib.sha256(fixture).hexdigest()
    except ProbeFailure as error:
        result["persistence"] = "fixture-unavailable"
        result["fixtureError"] = error.result
    except OSError as error:
        result["persistence"] = "fixture-unavailable"
        result["fixtureError"] = ProbeFailure("clean-fixture-scratch", error).result

    try:
        result["sqliteLock"], result["sqliteBackup"] = check_sqlite(directory)
    except (OSError, sqlite3.Error) as error:
        result["sqliteLock"] = "sqlite-check-failed"
        result["sqliteError"] = {
            "type": type(error).__name__,
            "code": getattr(error, "sqlite_errorname", None) or errno.errorcode.get(getattr(error, "errno", None)),
        }
    return fixture, result



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
                **storage_status,
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
    fixture, storage_status = check_persistence()
    with ThreadingHTTPServer(("0.0.0.0", int(os.environ.get("CAPort", "9000"))), Handler) as server:
        server.serve_forever()
