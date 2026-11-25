import json
from io import BytesIO
from pathlib import Path
from typing import Annotated, Literal

from fastapi import APIRouter, Path as ApiPath, Query, Request
from fastapi.responses import FileResponse, Response
from PIL import Image

from contract import missing

router = APIRouter(prefix="/workbench/v1")
CatalogFunction = Literal[
    "island_table", "unboxing_table", "cashier", "accessory_cabinet", "side_cabinet",
    "display_stand", "screen", "signage", "seating", "storage", "other",
]
CatalogCategory = Literal["软装道具", "信息化物料", "品牌标识", "非标陈列", "环境设施"]
IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp"}


class Catalog:
    def __init__(self, directory: Path):
        self.directory = directory.resolve()
        index = self.directory / "index.json"
        snapshot = json.loads(index.read_text(encoding="utf-8")) if index.is_file() else {}
        self.items = snapshot.get("items", [])
        self.by_id = {record["id"]: record for record in self.items}
        self.files = snapshot.get("files", {})
        rules = self.directory / "display.json"
        self.display_rules = json.loads(rules.read_text(encoding="utf-8")) if rules.is_file() else None

    def file_response(self, file_id, version, width, if_none_match):
        record = self.files.get(file_id)
        if record is None:
            return None
        file = (self.directory / "files" / record["name"]).resolve()
        if file.parent != self.directory / "files" or not file.is_file():
            raise missing("文件")
        content_type = record["contentType"]
        resize = width if content_type in IMAGE_TYPES else None
        digest = record["sha256"]
        etag = '"' + digest + (f"-w{resize}" if resize else "") + '"'
        headers = {
            "etag": etag,
            "cache-control": (
                "private, max-age=31536000, immutable"
                if version and digest.startswith(version) else "private, max-age=3600"
            ),
            "x-content-type-options": "nosniff",
        }
        if if_none_match == etag:
            return Response(status_code=304, headers=headers)
        if resize:
            with Image.open(file) as image:
                image.thumbnail((int(resize), int(resize)))
                output = BytesIO()
                image.save(output, format="WEBP")
            return Response(output.getvalue(), media_type="image/webp", headers=headers)
        if content_type == "image/svg+xml":
            headers["content-security-policy"] = "sandbox; default-src 'none'; style-src 'unsafe-inline'"
        return FileResponse(file, media_type=content_type, headers=headers)


@router.get("/assets")
def list_assets(
    request: Request,
    q: Annotated[str | None, Query(max_length=100)] = None,
    function: CatalogFunction | None = None,
    placeable: Literal["true", "false"] | None = None,
    siFamily: Annotated[str | None, Query(max_length=10)] = None,
    category: CatalogCategory | None = None,
):
    query = (q or "").strip().casefold()
    family = siFamily.strip() if siFamily else None
    items = [
        asset for asset in request.app.state.catalog.items
        if (not function or asset["function"] == function)
        and (placeable is None or asset["placeable"] == (placeable == "true"))
        and (not family or asset["siFamily"] == family)
        and (not category or asset["category"] == category)
        and (not query or any(
            query in asset[key].casefold() for key in ("id", "name", "standardName", "variant")
        ))
    ]
    return {"items": items, "total": len(items)}


@router.get("/assets/{assetId}")
def asset_detail(request: Request, assetId: Annotated[str, ApiPath(pattern=r"^asset-\d+$")]):
    item = request.app.state.catalog.by_id.get(assetId)
    if item is None:
        raise missing("资产")
    return item


@router.get("/display-rules/current")
def current_display_rules(request: Request):
    rules = request.app.state.catalog.display_rules
    if rules is None:
        raise missing("展陈规则")
    return rules