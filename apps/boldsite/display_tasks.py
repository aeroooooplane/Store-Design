import hashlib
import json
from typing import Annotated, Literal
from uuid import uuid4

from fastapi import APIRouter, Body, Header, Query, Request
from fastapi.responses import Response
from starlette.concurrency import run_in_threadpool

from contract import ApiError, ResourceId, current_revision, invalid, missing
from render_stage import bytes_limited, file_headers, image_data
from stage_delivery import MAX_ARCHIVE, OFFICE, unpack_archive
from storage import timestamp

router = APIRouter(prefix="/workbench/v1")
REVISION = Annotated[str | None, Header()]


def json_text(value):
    return json.dumps(value, ensure_ascii=False)


def task_row(db, task_id):
    row = db.execute("SELECT * FROM display_tasks WHERE id=? AND deletedAt IS NULL", (task_id,)).fetchone()
    if not row:
        raise missing("展陈任务")
    return row


def check_revision(row, expected):
    if row["revision"] != expected:
        raise ApiError(409, "REVISION_CONFLICT", "展陈任务已被修改，请刷新后再保存", {"revision": row["revision"]})


def save(db, row, fields):
    values = {**dict(row), **fields, "revision": row["revision"] + 1, "updatedAt": timestamp()}
    return db.execute("""
        UPDATE display_tasks SET name=:name,market=:market,siStyle=:siStyle,revision=:revision,
            state=:state,plan=:plan,render=:render,updatedAt=:updatedAt
        WHERE id=:id RETURNING *
    """, values).fetchone()


def exports_for(db, task_id):
    return [json.loads(row[0]) for row in db.execute("""
        SELECT payload FROM display_task_exports WHERE taskId=? ORDER BY createdAt DESC, rowid DESC LIMIT 10
    """, (task_id,))]


def summary(row):
    return {name: row[name] for name in ("id","name","market","siStyle","updatedAt")}


def detail(db, row):
    return {**summary(row), "createdAt":row["createdAt"], "revision":row["revision"],
        **{key:json.loads(row[key]) if row[key] is not None else None for key in ("plan","render","state")},
        "exports":exports_for(db, row["id"])}


@router.get("/display-tasks")
def list_tasks(request: Request):
    with request.app.state.db.connect() as db:
        rows=db.execute("SELECT * FROM display_tasks WHERE deletedAt IS NULL ORDER BY updatedAt DESC,id LIMIT 200").fetchall()
        return [{**summary(row), "tables":len(json.loads(row["state"])["tables"]),
            "exported":bool(db.execute("SELECT 1 FROM display_task_exports WHERE taskId=? LIMIT 1",(row["id"],)).fetchone())
            } for row in rows]


@router.post("/display-tasks", status_code=201)
def create_task(request: Request, body: Annotated[dict, Body()]):
    data=request.app.state.rules.run("display-task-create",body)
    with request.app.state.db.connect(write=True) as db:
        now=timestamp()
        row=db.execute("""INSERT INTO display_tasks (id,name,market,siStyle,state,createdAt,updatedAt)
            VALUES (?,?,?,?,?,?,?) RETURNING *""",
            (str(uuid4()),data["name"],data["market"],data["siStyle"],json_text(data["state"]),now,now)).fetchone()
        return detail(db,row)


@router.get("/display-tasks/{taskId}")
def get_task(request: Request, taskId: ResourceId):
    with request.app.state.db.connect() as db:
        return detail(db, task_row(db,taskId))


@router.patch("/display-tasks/{taskId}")
def update_task(request: Request, taskId: ResourceId, body: Annotated[dict,Body()], if_match: REVISION=None):
    expected=current_revision(if_match)
    values=request.app.state.rules.run("display-task-update",body)
    if "state" in values:
        values["state"]=json_text(values["state"])
    with request.app.state.db.connect(write=True) as db:
        row=task_row(db,taskId)
        check_revision(row,expected)
        return detail(db,save(db,row,values))


@router.post("/display-tasks/{taskId}/detect")
def detect_task(request: Request, taskId: ResourceId, body: Annotated[dict, Body()],
    if_match: REVISION=None):
    expected = current_revision(if_match)
    # Compute outside the transaction, then check the revision again before saving.
    with request.app.state.db.connect() as db:
        row = task_row(db, taskId)
        check_revision(row, expected)
        task = detail(db, row)
        if not task["plan"]:
            raise ApiError(409, "INVALID_STATE", "请先上传平面图")
        plan_id = task["plan"]["url"].rsplit("/", 1)[-1]
        vector_name = "vector-" + plan_id + ".json"
        saved_vector = db.execute("""SELECT data FROM display_task_files
            WHERE taskId=? AND name=? ORDER BY rowid DESC LIMIT 1""",
            (taskId, vector_name)).fetchone()
    data = dict(body)
    if "vector" not in data and saved_vector:
        data["vector"] = json.loads(saved_vector["data"])
    result = request.app.state.rules.run("display-task-detect", {"request": data, "task": task})
    state = {**task["state"], **{key: result[key] for key in ("tables", "entrance", "recognition")},
        "detection": {"method": result["method"], "notes": result["notes"], "at": timestamp()}}
    with request.app.state.db.connect(write=True) as db:
        row = task_row(db, taskId)
        check_revision(row, expected)
        if "vector" in data:
            store_file(db, taskId, vector_name, "application/json", json_text(data["vector"]).encode("utf-8"))
        return detail(db, save(db, row, {"state": json_text(state)}))


@router.delete("/display-tasks/{taskId}",status_code=204)
def delete_task(request: Request, taskId: ResourceId):
    with request.app.state.db.connect(write=True) as db:
        task_row(db,taskId)
        db.execute("UPDATE display_tasks SET deletedAt=? WHERE id=?",(timestamp(),taskId))
    return Response(status_code=204)


def store_file(db, task_id, name, mime, content):
    sha=hashlib.sha256(content).hexdigest()
    db.execute("""INSERT OR IGNORE INTO display_task_files (id,taskId,name,mime,sha,data)
        VALUES (?,?,?,?,?,?)""",(str(uuid4()),task_id,name,mime,sha,content))
    file_id=db.execute("SELECT id FROM display_task_files WHERE taskId=? AND name=? AND mime=? AND sha=?",
        (task_id,name,mime,sha)).fetchone()["id"]
    return {"url":"/workbench/v1/display-task-files/"+file_id,"name":name,"bytes":len(content)}


def save_picture(request, task_id, which, expected, name, page, mime, content):
    content,width,height=image_data(content,["PNG"] if mime=="image/png" else ["JPEG"],8000)
    with request.app.state.db.connect(write=True) as db:
        row=task_row(db,task_id)
        check_revision(row,expected)
        picture=store_file(db,task_id,name or ("平面图" if which=="plan" else "效果图"),mime,content)
        state=json.loads(row["state"])
        if which=="plan":
            state.update(tables=[], detection=None, recognition=None)
        else:
            state["tables"]=[{**table,"render":None} for table in state["tables"]]
        metadata={"url":picture["url"],"width":width,"height":height,"originalName":name,"page":page}
        return detail(db,save(db,row,{which:json_text(metadata),"state":json_text(state)}))


@router.put("/display-tasks/{taskId}/{which}")
async def upload_picture(request: Request, taskId: ResourceId, which: Literal["plan","render"],
    originalName: Annotated[str | None, Query(max_length=200)]=None,
    page: Annotated[int | None, Query(gt=0)]=None, if_match: REVISION=None):
    expected=current_revision(if_match)
    mime=request.headers.get("content-type","").split(";")[0].strip()
    if mime not in {"image/png","image/jpeg"}:
        raise invalid("请选择 PNG 或 JPEG 图片")
    content=await bytes_limited(request,20*1024*1024)
    return await run_in_threadpool(save_picture,request,taskId,which,expected,originalName,page,mime,content)


@router.get("/display-task-files/{fileId}")
def read_file(request: Request,fileId: ResourceId,
    if_none_match: Annotated[str | None, Header()]=None):
    with request.app.state.db.connect() as db:
        row=db.execute("""SELECT f.* FROM display_task_files f JOIN display_tasks t ON t.id=f.taskId
            WHERE f.id=? AND t.deletedAt IS NULL""",(fileId,)).fetchone()
        if not row:
            raise missing("展陈文件")
    etag='"'+row["sha"]+'"'
    headers={**file_headers(row["name"],not row["mime"].startswith("image/")),
             "ETag":etag,"Cache-Control":"private, no-cache"}
    if if_none_match==etag:
        return Response(status_code=304,headers=headers)
    return Response(row["data"],media_type=row["mime"],headers=headers)


def archive_task(request, task_id, expected, version, content):
    root=request.app.state.catalog.display_rules
    if not root or version!=root["version"]:
        raise ApiError(409,"REVISION_CONFLICT","展陈规则已更新，请重新生成")
    parts=unpack_archive(content,"display")
    with request.app.state.db.connect(write=True) as db:
        row=task_row(db,task_id)
        check_revision(row,expected)
        if not row["plan"] or not json.loads(row["state"])["tables"]:
            raise invalid("请先上传平面图并保存至少一个桌位")
        title = request.app.state.rules.run("display-task-export-name", row["name"])["name"]
        now=timestamp()
        payload={
            "pptx":store_file(db,task_id,title+"展陈方案.pptx",OFFICE+"presentationml.presentation",parts["display.pptx"]),
            "xlsx":store_file(db,task_id,title+"展陈清单.xlsx",OFFICE+"spreadsheetml.sheet",parts["display.xlsx"]),
            "ruleVersion":version,"createdAt":now,
        }
        db.execute("INSERT INTO display_task_exports VALUES (?,?,?,?)",(str(uuid4()),task_id,json_text(payload),now))
        save(db,row,{})
        return payload


@router.post("/display-tasks/{taskId}/compiled",status_code=201)
async def export_task(request: Request, taskId: ResourceId, revision: Annotated[int,Query(ge=1)],
    ruleVersion: Annotated[str,Query(min_length=1,max_length=100)]):
    return await run_in_threadpool(archive_task,request,taskId,revision,ruleVersion,await bytes_limited(request,MAX_ARCHIVE))
