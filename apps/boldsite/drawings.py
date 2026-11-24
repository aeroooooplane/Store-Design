import hashlib
from io import BytesIO
from typing import Annotated, Literal
from urllib.parse import quote
from uuid import uuid4

from fastapi import APIRouter, Header, Query, Request
from fastapi.responses import Response
from PIL import Image
from starlette.concurrency import run_in_threadpool

from contract import ApiError, ResourceId, invalid, missing, project_row
from storage import timestamp

router = APIRouter(prefix="/api/v1")
MAX_BYTES = 20 * 1024 * 1024
MAX_SIDE = 8192
IMAGE_TYPES = {"image/png": "PNG", "image/jpeg": "JPEG"}


def to_upload(row):
    return {**dict(row), "url": f'/api/v1/files/{row["fileId"]}'}


@router.get("/projects/{projectId}/uploads")
def list_uploads(request: Request, projectId: ResourceId):
    with request.app.state.db.connect() as db:
        rows = db.execute("""
            SELECT u.*, f.projectId, f.originalName
            FROM uploads u JOIN drawing_files f ON f.id = u.fileId
            WHERE f.projectId = ? ORDER BY u.createdAt DESC, u.rowid DESC LIMIT 20
        """, (projectId,))
        return [to_upload(row) for row in rows]


def store_upload(database, project_id, data, content_type, original_name, page):
    expected = IMAGE_TYPES[content_type]
    try:
        with Image.open(BytesIO(data), formats=[expected]) as image:
            width, height = image.size
            if max(width, height) > MAX_SIDE:
                raise invalid(f"图片边长不能超过 {MAX_SIDE} 像素")
            image.verify()
    except (OSError, ValueError, SyntaxError, Image.DecompressionBombError) as error:
        raise invalid(f"文件内容不是有效的 {expected} 图片") from error

    digest = hashlib.sha256(data).hexdigest()
    upload_id = str(uuid4())
    created = timestamp()
    with database.connect(write=True) as db:
        project_row(db, project_id, active=True)
        file = db.execute("""
            SELECT id, originalName FROM drawing_files WHERE projectId = ? AND sha256 = ?
        """, (project_id, digest)).fetchone()
        if file is None:
            file = db.execute("""
                INSERT INTO drawing_files (id, projectId, sha256, contentType, originalName, data)
                VALUES (?, ?, ?, ?, ?, ?) RETURNING id, originalName
            """, (str(uuid4()), project_id, digest, content_type, original_name, data)).fetchone()
        db.execute("""
            INSERT INTO uploads (id, fileId, page, width, height, createdAt) VALUES (?, ?, ?, ?, ?, ?)
        """, (upload_id, file["id"], page, width, height, created))
    return to_upload({
        "id": upload_id,
        "projectId": project_id,
        "fileId": file["id"],
        "originalName": file["originalName"],
        "page": page,
        "width": width,
        "height": height,
        "createdAt": created,
    })


@router.post("/projects/{projectId}/uploads", status_code=201)
async def upload(
    request: Request,
    projectId: ResourceId,
    originalName: Annotated[str | None, Query(max_length=200)] = None,
    page: Annotated[int | None, Query(gt=0, le=2147483647)] = None,
):
    content_type = request.headers.get("content-type", "").split(";", 1)[0].strip()
    if content_type not in IMAGE_TYPES:
        raise invalid("请求体须为 image/png 或 image/jpeg")
    too_large = ApiError(413, "PAYLOAD_TOO_LARGE", "图片不能超过 20 MB")
    length = request.headers.get("content-length", "")
    if length.isdecimal() and int(length) > MAX_BYTES:
        raise too_large
    data = bytearray()
    async for chunk in request.stream():
        if len(data) + len(chunk) > MAX_BYTES:
            raise too_large
        data.extend(chunk)
    return await run_in_threadpool(
        store_upload, request.app.state.db, projectId, data, content_type, originalName, page
    )


def attachment_name(file):
    name = (file["originalName"] or "图纸").replace("\\", "/").rsplit("/", 1)[-1]
    extension = ".png" if file["contentType"] == "image/png" else ".jpg"
    if name.lower().endswith(".pdf"):
        return name[:-4] + extension
    return name


@router.get("/files/{fileId}")
def download(
    request: Request,
    fileId: ResourceId,
    v: Annotated[str | None, Query(max_length=64)] = None,
    w: Literal["160", "480"] | None = None,
    if_none_match: Annotated[str | None, Header()] = None,
):
    with request.app.state.db.connect() as db:
        file = db.execute("""
            SELECT sha256, contentType, originalName FROM drawing_files WHERE id = ?
        """, (fileId,)).fetchone()
        if file is None:
            raise missing("文件")
        suffix = f"-w{w}" if w else ""
        etag = f'"{file["sha256"]}{suffix}"'
        versioned = v is not None and file["sha256"].startswith(v)
        headers = {
            "etag": etag,
            "cache-control": (
                "private, max-age=31536000, immutable" if versioned else "private, max-age=3600"
            ),
            "x-content-type-options": "nosniff",
        }
        if if_none_match == etag:
            return Response(status_code=304, headers=headers)
        data = db.execute("SELECT data FROM drawing_files WHERE id = ?", (fileId,)).fetchone()[0]
    if w:
        with Image.open(BytesIO(data)) as image:
            image.thumbnail((int(w), int(w)))
            output = BytesIO()
            image.save(output, format="WEBP")
        return Response(output.getvalue(), media_type="image/webp", headers=headers)
    headers["content-disposition"] = "inline; filename*=UTF-8''" + quote(attachment_name(file), safe="")
    return Response(data, media_type=file["contentType"], headers=headers)
