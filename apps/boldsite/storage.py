import os
import sqlite3
from contextlib import closing, contextmanager
from datetime import datetime, timezone
from pathlib import Path

from storage_gate import exclusive_storage


def timestamp():
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


class Database:
    def __init__(self, directory: Path):
        self.path = directory / "workbench-pilot.sqlite3"
        self.gate = directory / ".workbench-pilot-sqlite-gate"

    @contextmanager
    def connect(self, *, write=False):
        with exclusive_storage(self.gate), self._connect(write=write) as db:
            yield db

    @contextmanager
    def _connect(self, *, write):
        with closing(sqlite3.connect(self.path, timeout=15)) as db:
            db.row_factory = sqlite3.Row
            db.create_function("casefold", 1, str.casefold, deterministic=True)
            db.execute("PRAGMA foreign_keys = ON")
            db.execute("PRAGMA synchronous = FULL")
            with db:
                db.execute("BEGIN IMMEDIATE" if write else "BEGIN")
                yield db

    def initialize(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with exclusive_storage(self.gate):
            self._initialize()

    def _initialize(self):
        with closing(sqlite3.connect(self.path, timeout=15)) as db:
            mode = db.execute("PRAGMA journal_mode = DELETE").fetchone()[0]
            if mode != "delete":
                raise RuntimeError("试点数据库需要 DELETE 日志模式")
        with self._connect(write=True) as db:
            version = db.execute("PRAGMA user_version").fetchone()[0]
            if version == 1:
                return
            if version != 0:
                raise RuntimeError(f"不支持的试点数据库版本：{version}")
            db.execute("""
                CREATE TABLE projects (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    shopType TEXT NOT NULL,
                    market TEXT NOT NULL,
                    siStyle TEXT NOT NULL,
                    revision INTEGER NOT NULL DEFAULT 1,
                    createdAt TEXT NOT NULL,
                    updatedAt TEXT NOT NULL,
                    deletedAt TEXT
                )
            """)
            db.execute("""
                CREATE TABLE drawing_files (
                    id TEXT PRIMARY KEY,
                    projectId TEXT NOT NULL REFERENCES projects(id),
                    sha256 TEXT NOT NULL,
                    contentType TEXT NOT NULL,
                    originalName TEXT,
                    data BLOB NOT NULL,
                    UNIQUE(projectId, sha256)
                )
            """)
            db.execute("""
                CREATE TABLE uploads (
                    id TEXT PRIMARY KEY,
                    fileId TEXT NOT NULL REFERENCES drawing_files(id),
                    page INTEGER,
                    width INTEGER NOT NULL,
                    height INTEGER NOT NULL,
                    createdAt TEXT NOT NULL
                )
            """)
            db.execute("CREATE INDEX drawing_uploads_file ON uploads(fileId)")
            db.execute("PRAGMA user_version = 1")


def configured_database():
    # An explicit path prevents a successful deploy silently writing into the release directory.
    return Database(Path(os.environ["DATA_DIR"]).resolve())
