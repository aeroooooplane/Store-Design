import json
from io import BytesIO
from typing import Annotated, Literal
from uuid import uuid4
from zipfile import BadZipFile, ZipFile

from fastapi import APIRouter, Body, Header, Request
from starlette.concurrency import run_in_threadpool

from contract import ApiError, ResourceId, current_revision, invalid, project_row
from render_stage import bytes_limited, camera_json, camera_rows, file_url, mutable_node, put_file, render_images
from storage import timestamp
from workbench import node_row, resolve_space

router = APIRouter(prefix="/workbench/v1")
OFFICE = "application/vnd.openxmlformats-officedocument."
MAX_ARCHIVE = 60 * 1024 * 1024


def render_node(db, node_id, *, write=False):
    node = mutable_node(db,node_id) if write else node_row(db,node_id)
    if node["kind"] != "render":
        raise ApiError(409,"INVALID_STATE","需在渲染节点操作")
    return node


def records(db,node_id,kind):
    rows = db.execute("""SELECT value FROM stage_exports WHERE nodeId=? AND kind=?
        ORDER BY createdAt DESC,rowid DESC LIMIT 100""",(node_id,kind)).fetchall()
    return [json.loads(row[0]) for row in rows]


def display_record(request,db,node):
    catalog = request.app.state.catalog
    if not catalog.display_rules:
        raise ApiError(409,"INVALID_STATE","还没有导入展陈规则")
    project = project_row(db,node["projectId"])
    saved = db.execute("SELECT * FROM stage_displays WHERE nodeId=?",(node["id"],)).fetchone()
    computed = request.app.state.rules.run("stage-display",{
        "nodeId":node["id"],"layout":json.loads(node["layout"]),"space":resolve_space(db,node),
        "market":project["market"],"siStyle":node["siStyle"],"rules":catalog.display_rules,
        "edits":json.loads(saved["edits"]) if saved else None,
        "cameras":[camera_json(c) for c in camera_rows(db,node["id"])],
        "images":render_images(request,db,node),
    })
    return {**computed,"revision":saved["revision"] if saved else 0,"exports":records(db,node["id"],"display")[:10]}


@router.get("/nodes/{nodeId}/display")
def display(request: Request,nodeId: ResourceId):
    with request.app.state.db.connect() as db:
        return display_record(request,db,render_node(db,nodeId))


@router.put("/nodes/{nodeId}/display")
def save_display(request: Request,nodeId: ResourceId,body: Annotated[dict,Body()],
    if_match: Annotated[str|None,Header()]=None):
    expected = current_revision(if_match) if if_match is not None else 0
    edits = request.app.state.rules.run("display-update",body)["edits"]
    with request.app.state.db.connect(write=True) as db:
        node = render_node(db,nodeId,write=True)
        existing = db.execute("SELECT revision FROM stage_displays WHERE nodeId=?",(nodeId,)).fetchone()
        revision = existing["revision"] if existing else 0
        if expected != revision:
            raise ApiError(409,"REVISION_CONFLICT","展陈方案已被修改，请刷新后再保存",{"revision":revision})
        db.execute("""INSERT INTO stage_displays VALUES (?,?,?)
            ON CONFLICT(nodeId) DO UPDATE SET revision=excluded.revision,edits=excluded.edits""",
            (nodeId,revision+1,json.dumps(edits,ensure_ascii=False)))
        return display_record(request,db,node)


def unpack_archive(data,kind):
    names = ({"display.pptx","display.xlsx"} if kind == "display"
             else {"full.pdf","show.pdf","plan.png","plan.svg","display.pptx","display.xlsx"})
    required = ({"display.pptx","display.xlsx"} if kind == "display" else {"full.pdf","show.pdf","plan.png"})
    try:
        with ZipFile(BytesIO(data)) as archive:
            files = archive.infolist()
            found = {f.filename for f in files}
            if (len(files) != len(found) or not required <= found <= names
                or ("display.pptx" in found) != ("display.xlsx" in found)
                or sum(f.file_size for f in files) > MAX_ARCHIVE):
                raise invalid("交付包文件不完整或超出大小限制")
            result = {f.filename:archive.read(f) for f in files}
        for name, content in result.items():
            extension = name.rsplit(".",1)[1]
            if extension in {"pptx","xlsx"}:
                with ZipFile(BytesIO(content)) as office:
                    expected = "ppt/presentation.xml" if extension == "pptx" else "xl/workbook.xml"
                    if expected not in office.namelist():
                        raise invalid("Office 文件格式错误")
            if extension == "pdf" and not content.startswith(b"%PDF-"):
                raise invalid("PDF 文件格式错误")
            if extension == "png" and not content.startswith(b"\x89PNG\r\n\x1a\n"):
                raise invalid("平面图片格式错误")
        return result
    except (BadZipFile, RuntimeError, OSError):
        raise invalid("交付包无法读取") from None


def archive_compiled(request,node_id,kind,data,revision,expected_views,pages_full,pages_show):
    parts = unpack_archive(data,kind)
    with request.app.state.db.connect(write=True) as db:
        node = render_node(db,node_id,write=True)
        project = project_row(db,node["projectId"])
        images = render_images(request,db,node)
        views = camera_rows(db,node_id)
        actual_views = [image["id"] for image in images if not image["stale"]]
        if not views or len(actual_views) != len(views) or ",".join(actual_views) != expected_views:
            raise ApiError(409,"REVISION_CONFLICT","渲染图已更新，请重新生成交付")
        uid, now = str(uuid4()),timestamp()
        if "display.pptx" in parts:
            view = display_record(request,db,node)
            if revision != view["revision"]:
                raise ApiError(409,"REVISION_CONFLICT","展陈方案已更新，请重新生成")
        def keep(name,mime,bytes_,file_kind=kind):
            file = put_file(db,node["projectId"],file_kind,name,mime,bytes_)
            return {"url":file_url(file["id"]),"name":name,"bytes":len(bytes_)}
        display_export = None
        if "display.pptx" in parts:
            display_export = {"pptx":keep("展陈方案.pptx",OFFICE+"presentationml.presentation",parts["display.pptx"],"display"),
                "xlsx":keep("展陈清单.xlsx",OFFICE+"spreadsheetml.sheet",parts["display.xlsx"],"display"),
                "ruleVersion":view["ruleVersion"],"createdAt":now}
            db.execute("INSERT INTO stage_exports VALUES (?,?,?,?,?)",
                       (str(uuid4()),node_id,"display",json.dumps(display_export,ensure_ascii=False),now))
        if kind == "display":
            return display_export
        if not pages_full or not pages_show:
            raise invalid("交付页数无效")
        rules = request.app.state.rules
        date = now[:10]
        revision_no = db.execute("""SELECT count(*) FROM stage_exports e JOIN workbench_nodes n ON e.nodeId=n.id
            WHERE n.projectId=? AND e.kind='delivery' AND substr(e.createdAt,1,10)=?""",(node["projectId"],date)).fetchone()[0]+1
        space = resolve_space(db, node)
        names = rules.run("delivery-names",{"name":project["name"],"shopType":space.get("shopType",project["shopType"]),
            "space":space,"date":date,"revision":revision_no})
        folder = names["folder"]
        image_ids = [picture["url"].rsplit("/",1)[-1] for picture in images]
        marks = ",".join("?" for _ in image_ids)
        total_images = db.execute(f"SELECT coalesce(sum(length(data)),0) FROM stage_files WHERE id IN ({marks})",image_ids).fetchone()[0]
        if sum(map(len,parts.values())) + total_images > 128*1024*1024:
            raise ApiError(413,"PAYLOAD_TOO_LARGE","交付文件超过 128 MB")
        out = BytesIO()
        with ZipFile(out,"w") as archive:
            archive.writestr(folder+"/"+names["full"],parts["full.pdf"])
            archive.writestr(folder+"/"+names["show"],parts["show.pdf"])
            archive.writestr(folder+"/平面图.png",parts["plan.png"])
            if "plan.svg" in parts:
                archive.writestr(folder+"/平面图.svg",parts["plan.svg"])
            if display_export:
                archive.writestr(folder+"/展陈方案.pptx",parts["display.pptx"])
                archive.writestr(folder+"/展陈清单.xlsx",parts["display.xlsx"])
            for index,(picture,camera) in enumerate(zip(images,views,strict=True),1):
                file = db.execute("SELECT data FROM stage_files WHERE id=?",(picture["url"].rsplit("/",1)[-1],)).fetchone()
                name = rules.run("safe-file",json.loads(camera["camera"])["name"])["name"]
                archive.writestr(f"{folder}/效果图/{index:02d}-{name}-材质.png",file["data"])
        value = {"id":uid,"nodeId":node_id,"createdAt":now,"folderName":folder,"archivePath":None,
            "fullPdf":keep(names["full"],"application/pdf",parts["full.pdf"]),
            "showPdf":keep(names["show"],"application/pdf",parts["show.pdf"]),
            "zip":keep(folder+".zip","application/zip",out.getvalue()),"displayPpt":display_export["pptx"] if display_export else None,
            "pages":{"full":pages_full,"show":pages_show},"views":len(views)}
        db.execute("INSERT INTO stage_exports VALUES (?,?,?,?,?)",(uid,node_id,kind,json.dumps(value,ensure_ascii=False),now))
        return value


@router.get("/nodes/{nodeId}/deliveries")
def deliveries(request: Request,nodeId: ResourceId):
    with request.app.state.db.connect() as db:
        node_row(db,nodeId)
        return {"nodeId":nodeId,"deliveries":records(db,nodeId,"delivery")}


@router.post("/nodes/{nodeId}/compiled/{kind}",status_code=201)
async def save_compiled(request: Request,nodeId: ResourceId,kind: Literal["display","delivery"],
    renders: str, revision: int=0, full: int|None=None, show: int|None=None):
    return await run_in_threadpool(archive_compiled,request,nodeId,kind,await bytes_limited(request,MAX_ARCHIVE),
        revision,renders,full,show)

