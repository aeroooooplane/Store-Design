"""门店档案脚本的公共路径与输出工具。

原图纸和被 Git 忽略的旧成果只在主仓库里，所以输入一律从 --repo（默认主仓库）读取；
输出写到本脚本所在仓库（可能是独立工作区）的 资源库/09_门店档案/。
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
from datetime import datetime, timezone
from pathlib import Path

SCRIPT_VERSION = "0.1.0"
THIS_REPO = Path(__file__).resolve().parents[2]
DEFAULT_REPO = Path(os.environ.get("STORE_ARCHIVE_REPO", "D:/text demo"))
ARCHIVE_DIR = "资源库/09_门店档案"
SOURCE_DIR = "资源库/01_各门店原图纸"


def base_args(description: str) -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=description)
    parser.add_argument("--repo", type=Path, default=DEFAULT_REPO, help="读取原图纸与旧成果的主仓库根目录")
    parser.add_argument("--out", type=Path, default=THIS_REPO / ARCHIVE_DIR, help="输出目录")
    return parser


def sha256_file(path: Path, chunk: int = 1 << 20) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while block := handle.read(chunk):
            digest.update(block)
    return digest.hexdigest()


def git_tracked(repo: Path, *paths: str) -> set[str]:
    """返回 repo 中被 Git 跟踪的文件（相对仓库根目录、正斜杠）。"""
    result = subprocess.run(
        ["git", "-c", "core.quotepath=false", "-C", str(repo), "ls-files", "-z", "--", *paths],
        check=True,
        capture_output=True,
    )
    return {item.decode("utf-8") for item in result.stdout.split(b"\0") if item}


def load_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(data, ensure_ascii=False, indent=1) + "\n"
    path.write_text(text, encoding="utf-8", newline="\n")


def header(script: str) -> dict:
    return {
        "schemaVersion": 1,
        "generatedAt": datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds"),
        "generator": {"script": f"tools/store-archive/{script}", "version": SCRIPT_VERSION},
    }


def rel(repo: Path, path: Path) -> str:
    return path.resolve().relative_to(repo.resolve()).as_posix()
