import hashlib
import json
import re
from io import BytesIO
from typing import Annotated, Literal
from urllib.parse import quote
from uuid import uuid4
from zipfile import ZipFile

from fastapi import APIRouter, Body, Header, Query, Request
from fastapi.responses import Response
from PIL import Image, ImageOps, UnidentifiedImageError
from starlette.concurrency import run_in_threadpool

from contract import ApiError, ResourceId, invalid, missing, project_row
from storage import timestamp
from workbench import node_row, resolve_space

router = APIRouter(prefix="/workbench/v1")
MAX_IMAGE = 16 * 1024 * 1024
MAX_CAMERAS = 24


def camera_rows(db, node_id, deleted=False):
    return db.execute(
        "SELECT * FROM stage_cameras WHERE nodeId = ? AND (? OR deletedAt IS NULL) ORDER BY sort",
        (node_id, int(deleted)),
    ).fetchall()


def camera_json(row):
    return {**dict(row), "camera": json.loads(row["camera"])}


def find_camera(db, camera_id):
    row = db.execute("SELECT * FROM stage_cameras WHERE id = ?", (camera_id,)).fetchone()
    if row is None:
        raise missing("视角")
    return row


def save_camera(db, node_id, values, sort):
    row = db.execute(
        "INSERT INTO stage_cameras (id,nodeId,camera,sort) VALUES (?,?,?,?) RETURNING *",
        (str(uuid4()), node_id, json.dumps(values, ensure_ascii=False), sort),
    ).fetchone()
    return camera_json(row)


def initialize_views(db, node, rules, source=None):
    if camera_rows(db, node["id"], True):
        return
    parent = source
    while parent:
        rows = camera_rows(db, parent["id"], True)
        if rows:
            for sort, row in enumerate(r for r in rows if r["deletedAt"] is None):
                camera = json.loads(row["camera"])
                save_camera(db, node["id"], {k: camera[k] for k in ("name","position","target","fovDeg","source")}, sort)
            return
        if parent["kind"] == "space":
            break
        parent = node_row(db, parent["parentId"]) if parent["parentId"] else None
    for sort, values in enumerate(rules.run("default-cameras", resolve_space(db, node))["cameras"]):
        save_camera(db, node["id"], values, sort)


def mutable_node(db, node_id):
    node = node_row(db, node_id)
    project_row(db, node["projectId"], active=True)
    return node


@router.get("/nodes/{nodeId}/cameras")
def get_cameras(request: Request, nodeId: ResourceId, includeDeleted: Literal["true","false"] = "false"):
    with request.app.state.db.connect() as db:
        node_row(db, nodeId)
        return {"nodeId": nodeId, "cameras": [camera_json(r) for r in camera_rows(db, nodeId, includeDeleted == "true")]}


@router.post("/nodes/{nodeId}/cameras/initialize")
def init_cameras(request: Request, nodeId: ResourceId):
    with request.app.state.db.connect(write=True) as db:
        node = mutable_node(db, nodeId)
        parent = node_row(db, node["parentId"]) if node["parentId"] and node["kind"] != "space" else None
        initialize_views(db, node, request.app.state.rules, parent)
        return {"nodeId": nodeId, "cameras": [camera_json(r) for r in camera_rows(db, nodeId, True)]}


def require_camera_room(db, node_id):
    if len(camera_rows(db, node_id)) >= MAX_CAMERAS:
        raise ApiError(409, "INVALID_STATE", f"每个阶段最多 {MAX_CAMERAS} 个视角")


@router.post("/nodes/{nodeId}/cameras", status_code=201)
def add_camera(request: Request, nodeId: ResourceId, body: Annotated[dict, Body()]):
    camera = request.app.state.rules.run("camera-create", body)
    with request.app.state.db.connect(write=True) as db:
        mutable_node(db, nodeId)
        require_camera_room(db, nodeId)
        existing = camera_rows(db, nodeId, True)
        return save_camera(db, nodeId, {**camera, "source": "user"}, existing[-1]["sort"] + 1 if existing else 0)


@router.patch("/cameras/{cameraId}")
def update_camera(request: Request, cameraId: ResourceId, body: Annotated[dict, Body()]):
    patch = request.app.state.rules.run("camera-update", body)
    revision = patch.pop("expectedBackgroundRevision", None)
    with request.app.state.db.connect(write=True) as db:
        row = find_camera(db, cameraId)
        node = mutable_node(db, row["nodeId"])
        if row["deletedAt"]:
            raise ApiError(409, "INVALID_STATE", "视角已删除，请先恢复")
        camera = json.loads(row["camera"])
        previous = camera.get("backgroundRevision", 0)
        reaimed = bool({"position","target","fovDeg"} & patch.keys())
        if "background" in patch:
            if node["kind"] != "render":
                raise ApiError(409, "INVALID_STATE", "请在渲染步骤设置背景")
            if revision != previous:
                raise ApiError(409, "REVISION_CONFLICT", "背景已更新，请重新读取后再保存")
            background = patch["background"]
            if background:
                image = background["image"]
                file = db.execute("SELECT * FROM stage_files WHERE id = ?", (image["fileId"],)).fetchone()
                if (not file or file["projectId"] != node["projectId"] or file["kind"] != "background"
                    or any(image[key] != file[column] for key, column in (("fileId","id"),("width","width"),("height","height")))):
                    raise invalid("背景图片与当前项目或图片记录不一致")
                background["image"] = background_image(file)
        camera.update(patch)
        if "background" in patch or reaimed:
            camera["backgroundRevision"] = previous + 1
        if reaimed:
            camera["source"] = "user"
        return camera_json(db.execute("UPDATE stage_cameras SET camera=? WHERE id=? RETURNING *",
            (json.dumps(camera, ensure_ascii=False),cameraId)).fetchone())


def camera_visibility(request, camera_id, deleted):
    with request.app.state.db.connect(write=True) as db:
        row = find_camera(db, camera_id)
        mutable_node(db, row["nodeId"])
        if not deleted and row["deletedAt"]:
            require_camera_room(db, row["nodeId"])
        at = (row["deletedAt"] or timestamp()) if deleted else None
        return camera_json(db.execute("UPDATE stage_cameras SET deletedAt=? WHERE id=? RETURNING *",
            (at,camera_id)).fetchone())


@router.delete("/cameras/{cameraId}")
def delete_camera(request: Request, cameraId: ResourceId):
    return camera_visibility(request, cameraId, True)


@router.post("/cameras/{cameraId}/restore")
def restore_camera(request: Request, cameraId: ResourceId):
    return camera_visibility(request, cameraId, False)


async def bytes_limited(request, limit):
    data = bytearray()
    async for chunk in request.stream():
        if len(data) + len(chunk) > limit:
            raise ApiError(413, "PAYLOAD_TOO_LARGE", "文件过大")
        data.extend(chunk)
    return bytes(data)


def image_data(data, formats, max_side, *, min_side=1, normalize=False):
    try:
        with Image.open(BytesIO(data), formats=formats) as image:
            if not all(min_side <= side <= max_side for side in image.size):
                raise invalid(f"图片边长须在 {min_side}–{max_side} 像素之间")
            if normalize:
                fixed = ImageOps.exif_transpose(image).convert("RGB")
                output = BytesIO()
                fixed.save(output, "PNG")
                return output.getvalue(), fixed.width, fixed.height
            size = image.size
            image.verify()
            return data, *size
    except (UnidentifiedImageError, Image.DecompressionBombError, SyntaxError, OSError, ValueError):
        raise invalid("无法读取图片") from None


def file_url(file_id):
    return "/workbench/v1/stage-files/" + file_id


def put_file(db, project, kind, name, mime, data, width=None, height=None):
    sha = hashlib.sha256(data).hexdigest()
    db.execute("""INSERT OR IGNORE INTO stage_files (id,projectId,kind,name,mime,sha,data,width,height)
        VALUES (?,?,?,?,?,?,?,?,?)""", (str(uuid4()), project, kind, name, mime, sha, data, width, height))
    return db.execute("SELECT id,name,width,height FROM stage_files WHERE projectId=? AND kind=? AND sha=? AND name=?",
        (project, kind, sha, name)).fetchone()


def background_image(file):
    return {"fileId":file["id"],"url":file_url(file["id"]),"width":file["width"],"height":file["height"]}


def store_background(request, camera_id, data):
    data, width, height = image_data(data, ["PNG","JPEG"], 4096, normalize=True)
    if len(data) > MAX_IMAGE:
        raise ApiError(413, "PAYLOAD_TOO_LARGE", "背景图片过大")
    with request.app.state.db.connect(write=True) as db:
        camera = find_camera(db,camera_id)
        node = mutable_node(db,camera["nodeId"])
        if node["kind"] != "render" or camera["deletedAt"]:
            raise ApiError(409,"INVALID_STATE","请在有效的渲染视角设置背景")
        row = put_file(db,node["projectId"],"background","背景.png","image/png",data,width,height)
        return background_image(row)


@router.post("/cameras/{cameraId}/background-image", status_code=201)
async def upload_background(request: Request, cameraId: ResourceId):
    return await run_in_threadpool(store_background, request, cameraId, await bytes_limited(request, MAX_IMAGE))


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def layout_signature(request, db, node):
    project = project_row(db, node["projectId"])
    assets = request.app.state.catalog.by_id
    models = {}
    for item in json.loads(node["layout"])["items"]:
        asset_id = item.get("assetId")
        if asset_id in assets:
            asset = assets[asset_id]
            models[asset_id] = [asset.get(key) for key in ("glb","whiteGlb","finishGlb","marketVariants")]
    return digest([resolve_space(db, node), node["layout"], node["siStyle"], project["market"], project["shopType"], models])


def camera_signature(row):
    camera = json.loads(row["camera"])
    return digest([camera.get(key) for key in ("position","target","fovDeg","background")])


def render_image(row, stale):
    return {**{k:row[k] for k in ("id","cameraId","mode","width","height","createdAt")},
        "url":file_url(row["fileId"]),"stale":stale}


def render_images(request, db, node):
    if node["kind"] != "render":
        return []
    signature = layout_signature(request,db,node)
    result = []
    for camera in camera_rows(db,node["id"]):
        row = db.execute("""SELECT * FROM stage_renders WHERE nodeId=? AND cameraId=?
            ORDER BY createdAt DESC, rowid DESC LIMIT 1""", (node["id"],camera["id"])).fetchone()
        if row:
            result.append(render_image(row, row["layoutSignature"] != signature or row["cameraSignature"] != camera_signature(camera)))
    return result


@router.get("/nodes/{nodeId}/renders")
def list_renders(request: Request, nodeId: ResourceId):
    with request.app.state.db.connect() as db:
        return {"nodeId":nodeId,"images":render_images(request, db, node_row(db,nodeId))}


def save_render(request, node_id, camera_id, mode, revision, data):
    data,width,height = image_data(data, ["PNG"], 4096, min_side=64)
    with request.app.state.db.connect(write=True) as db:
        node = mutable_node(db,node_id)
        camera = find_camera(db,camera_id)
        if node["kind"] != "render":
            raise ApiError(409,"INVALID_STATE","只有渲染节点可以保存渲染图")
        if camera["nodeId"] != node_id or camera["deletedAt"]:
            raise missing("视角")
        info = json.loads(camera["camera"])
        if (revision is not None or info.get("backgroundRevision",0)) and revision != info.get("backgroundRevision",0):
            raise ApiError(409,"REVISION_CONFLICT","背景已更新，请重新渲染")
        layout_sig, camera_sig = layout_signature(request,db,node), camera_signature(camera)
        file = put_file(db,node["projectId"],"render",info["name"]+"-材质.png","image/png",data,width,height)
        row = db.execute("""INSERT INTO stage_renders
            (id,nodeId,cameraId,mode,fileId,width,height,layoutSignature,cameraSignature,createdAt)
            VALUES (?,?,?,?,?,?,?,?,?,?)
            ON CONFLICT(nodeId,cameraId,mode,layoutSignature,cameraSignature)
            DO UPDATE SET fileId=excluded.fileId,width=excluded.width,height=excluded.height,createdAt=excluded.createdAt
            RETURNING *""",(str(uuid4()),node_id,camera_id,mode,file["id"],width,height,layout_sig,camera_sig,timestamp())).fetchone()
        return render_image(row,False)


@router.put("/nodes/{nodeId}/renders/{cameraId}/{mode}",status_code=201)
async def upload_render(request: Request,nodeId: ResourceId,cameraId: ResourceId,mode: Literal["material"],
    backgroundRevision: Annotated[int|None, Query(ge=0)] = None):
    if request.headers.get("content-type","").split(";")[0].strip() != "image/png":
        raise invalid("请求体必须是 PNG 图片")
    return await run_in_threadpool(save_render,request,nodeId,cameraId,mode,backgroundRevision,await bytes_limited(request,MAX_IMAGE))


def file_headers(name, download=False):
    return {"Content-Disposition": ("attachment" if download else "inline") + "; filename*=UTF-8''" + quote(name,safe=""),
        "X-Content-Type-Options":"nosniff"}


@router.get("/stage-files/{fileId}")
def stage_file(request: Request,fileId: ResourceId,if_none_match: Annotated[str|None,Header()]=None,
    w: Literal["160","480"]|None=None):
    with request.app.state.db.connect() as db:
        file = db.execute("SELECT * FROM stage_files WHERE id=?",(fileId,)).fetchone()
        if not file:
            raise missing("文件")
    etag = '"' + file["sha"] + (f"-w{w}" if w and file["mime"].startswith("image/") else "") + '"'
    headers = {**file_headers(file["name"],not file["mime"].startswith("image/")),"ETag":etag,"Cache-Control":"private, max-age=3600"}
    if if_none_match == etag:
        return Response(status_code=304,headers=headers)
    if w and file["mime"].startswith("image/"):
        with Image.open(BytesIO(file["data"])) as image:
            image.thumbnail((int(w),int(w)))
            out=BytesIO()
            image.save(out,"WEBP")
        return Response(out.getvalue(),media_type="image/webp",headers=headers)
    return Response(file["data"],media_type=file["mime"],headers=headers)


@router.get("/nodes/{nodeId}/renders/archive")
def render_archive(request: Request,nodeId: ResourceId):
    out=BytesIO()
    with request.app.state.db.connect() as db, ZipFile(out,"w") as archive:
        node=node_row(db,nodeId)
        images=[i for i in render_images(request,db,node) if not i["stale"]]
        if not images:
            raise ApiError(409,"INVALID_STATE","还没有可下载的渲染图，请先渲染")
        for sort,image in enumerate(images,1):
            file=db.execute("SELECT name,data FROM stage_files WHERE id=?",(image["url"].rsplit("/",1)[-1],)).fetchone()
            name=re.sub(r'[\\/:*?"<>|\s]+',"_",file["name"])
            archive.writestr(f"{sort:02d}-{name}",file["data"])
    return Response(out.getvalue(),media_type="application/zip",headers=file_headers("渲染图.zip",True))

