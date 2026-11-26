import json
from typing import Annotated, Literal
from uuid import uuid4

from fastapi import APIRouter, Body, Header, Request
from fastapi.responses import JSONResponse, Response

from contract import ApiError, ResourceId, current_revision, invalid, missing, project_row
from storage import timestamp

router = APIRouter(prefix="/workbench/v1")
REVISION_HEADER = Annotated[str | None, Header()]
SUMMARY = ("id", "parentId", "kind", "name", "strategy", "siStyle", "origin", "importedFrom", "createdAt")
MAX_NODES = 500


def node_row(db, node_id):
    row = db.execute("SELECT * FROM workbench_nodes WHERE id = ?", (node_id,)).fetchone()
    if row is None:
        raise missing("节点")
    return row


def summarize(row):
    return {**{name: row[name] for name in SUMMARY}, "hidden": row["hiddenAt"] is not None}


def node_detail(row):
    return {
        **summarize(row),
        "projectId": row["projectId"],
        "space": json.loads(row["space"]) if row["space"] is not None else None,
        "layout": json.loads(row["layout"]) if row["layout"] is not None else None,
    }


def resolve_space(db, parent):
    current = parent
    for _ in range(MAX_NODES):
        if current["space"] is not None:
            return json.loads(current["space"])
        if current["parentId"] is None:
            break
        current = node_row(db, current["parentId"])
    raise ApiError(409, "INVALID_STATE", "节点缺少所属空间")


@router.get("/projects/{projectId}/nodes")
def list_nodes(request: Request, projectId: ResourceId, includeHidden: Literal["true", "false"] = "false"):
    with request.app.state.db.connect() as db:
        project_row(db, projectId)
        rows = db.execute(
            "SELECT * FROM workbench_nodes WHERE projectId = ? AND (? OR hiddenAt IS NULL) ORDER BY seq",
            (projectId, int(includeHidden == "true")),
        ).fetchall()
    return {"projectId": projectId, "nodes": [summarize(row) for row in rows]}


@router.get("/nodes/{nodeId}")
def get_node(request: Request, nodeId: ResourceId):
    with request.app.state.db.connect() as db:
        return node_detail(node_row(db, nodeId))


@router.post("/projects/{projectId}/nodes", status_code=201)
def create_node(request: Request, projectId: ResourceId, payload: Annotated[dict, Body()]):
    rules = request.app.state.rules
    checked = rules.run("node", payload)
    node = checked["node"]
    if node["kind"] in {"white", "render"} or "sourceNodeId" in node:
        raise ApiError(501, "INTERNAL", "完整三维和复制流程仍待接入")
    parent_id = node["parentId"]
    space, layout = node.get("space"), node.get("layout")
    issues = checked["issues"]
    with request.app.state.db.connect(write=True) as db:
        project_row(db, projectId, active=True)
        total = db.execute("SELECT count(*) FROM workbench_nodes WHERE projectId = ?", (projectId,)).fetchone()[0]
        if total >= MAX_NODES:
            raise ApiError(409, "INVALID_STATE", "项目节点已达上限 500，请导出备份后新建项目")
        parent = node_row(db, parent_id) if parent_id else None
        if parent and parent["projectId"] != projectId:
            raise missing("父节点")
        if node["kind"] == "plan" and (not parent or parent["kind"] != "space"):
            raise invalid("方案只能建在空间下")
        if layout is not None:
            layout_space = space if space is not None else resolve_space(db, parent)
            issues += rules.run("layout", {"space": layout_space, "layout": layout})["issues"]
        now = timestamp()
        row = db.execute("""
            INSERT INTO workbench_nodes (id, projectId, parentId, kind, name, strategy, siStyle, origin,
                space, layout, createdAt)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *
        """, (
            str(uuid4()), projectId, parent_id, node["kind"], node["name"], node.get("strategy"),
            node.get("siStyle"), "generator" if node["kind"] == "plan" else "user",
            json.dumps(space, ensure_ascii=False) if space is not None else None,
            json.dumps(layout, ensure_ascii=False) if layout is not None else None, now,
        )).fetchone()
        db.execute("UPDATE projects SET updatedAt = ? WHERE id = ?", (now, projectId))
    return {"node": node_detail(row), "issues": issues}


@router.patch("/nodes/{nodeId}")
def rename(request: Request, nodeId: ResourceId, payload: Annotated[dict, Body()]):
    name = request.app.state.rules.run("rename", payload)["name"]
    with request.app.state.db.connect(write=True) as db:
        row = node_row(db, nodeId)
        project_row(db, row["projectId"], active=True)
        changed = db.execute("UPDATE workbench_nodes SET name = ? WHERE id = ? RETURNING *", (name, nodeId)).fetchone()
    return node_detail(changed)


@router.post("/nodes/{nodeId}/{action}")
def visibility(request: Request, nodeId: ResourceId, action: Literal["hide", "restore"]):
    with request.app.state.db.connect(write=True) as db:
        row = node_row(db, nodeId)
        project_row(db, row["projectId"], active=True)
        hidden_at = (row["hiddenAt"] or timestamp()) if action == "hide" else None
        changed = db.execute("UPDATE workbench_nodes SET hiddenAt = ? WHERE id = ? RETURNING *", (hidden_at, nodeId)).fetchone()
    return node_detail(changed)


@router.post("/layouts/generate")
def layouts(request: Request, payload: Annotated[dict, Body()]):
    return request.app.state.rules.run("generate", payload)


@router.post("/layouts/validate")
def validate(request: Request, payload: Annotated[dict, Body()]):
    return request.app.state.rules.run("validate", payload)


def draft_json(row):
    return {**dict(row), "layout": json.loads(row["layout"])}


def draft_rows(db, project_id):
    return db.execute(
        "SELECT * FROM workbench_drafts WHERE projectId = ? ORDER BY updatedAt DESC, baseNodeId",
        (project_id,),
    ).fetchall()


def draft_conflict(row):
    return ApiError(
        409, "REVISION_CONFLICT",
        "草稿已被其他窗口修改，请刷新后再保存" if row else "草稿已不存在，请刷新后再保存",
        {"currentRevision": row["revision"] if row else None},
    )


@router.get("/projects/{projectId}/drafts")
def drafts(request: Request, projectId: ResourceId):
    with request.app.state.db.connect() as db:
        project_row(db, projectId)
        return {"drafts": [draft_json(row) for row in draft_rows(db, projectId)]}


@router.get("/projects/{projectId}/draft")
def latest_draft(request: Request, projectId: ResourceId):
    with request.app.state.db.connect() as db:
        project_row(db, projectId)
        rows = draft_rows(db, projectId)
        if not rows:
            raise missing("草稿")
        data = draft_json(rows[0])
    return JSONResponse(data, headers={"ETag": f'"{data["revision"]}"'})


@router.put("/projects/{projectId}/draft")
def save_draft(request: Request, projectId: ResourceId, payload: Annotated[dict, Body()], if_match: REVISION_HEADER = None):
    rules = request.app.state.rules
    draft = rules.run("draft", payload)
    base_id, layout = draft["baseNodeId"], draft["layout"]
    expected = current_revision(if_match) if if_match is not None else None
    with request.app.state.db.connect(write=True) as db:
        project_row(db, projectId, active=True)
        base = node_row(db, base_id)
        if base["projectId"] != projectId:
            raise missing("草稿所基于的节点")
        prior = db.execute(
            "SELECT * FROM workbench_drafts WHERE projectId = ? AND baseNodeId = ?", (projectId, base_id),
        ).fetchone()
        if prior and expected is None:
            raise ApiError(428, "REVISION_REQUIRED", "已有草稿，请带上 If-Match 版本号保存", {
                "currentRevision": prior["revision"],
            })
        if expected is not None and (prior is None or prior["revision"] != expected):
            raise draft_conflict(prior)
        issues = rules.run("layout", {"space": resolve_space(db, base), "layout": layout})["issues"]
        row = db.execute("""
            INSERT INTO workbench_drafts (projectId, baseNodeId, layout, revision, updatedAt)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(projectId, baseNodeId) DO UPDATE SET
                layout = excluded.layout, revision = excluded.revision, updatedAt = excluded.updatedAt
            RETURNING *
        """, (projectId, base_id, json.dumps(layout, ensure_ascii=False), (expected or 0) + 1, timestamp())).fetchone()
    data = draft_json(row)
    return JSONResponse({"draft": data, "issues": issues}, headers={"ETag": f'"{data["revision"]}"'})


@router.delete("/projects/{projectId}/draft", status_code=204)
def delete_draft(request: Request, projectId: ResourceId, baseNodeId: ResourceId | None = None, if_match: REVISION_HEADER = None):
    expected = current_revision(if_match)
    with request.app.state.db.connect(write=True) as db:
        project_row(db, projectId, active=True)
        rows = draft_rows(db, projectId)
        if baseNodeId is None and len(rows) > 1:
            raise ApiError(409, "REVISION_CONFLICT", "请指定要丢弃草稿的节点")
        row = next((draft for draft in rows if baseNodeId is None or draft["baseNodeId"] == baseNodeId), None)
        if not row or row["revision"] != expected:
            raise draft_conflict(row)
        db.execute("DELETE FROM workbench_drafts WHERE projectId = ? AND baseNodeId = ?", (projectId, row["baseNodeId"]))
    return Response(status_code=204)

