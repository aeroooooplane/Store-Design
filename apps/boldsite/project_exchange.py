import json
from urllib.parse import quote
from uuid import uuid4

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool

from contract import ApiError, ResourceId, invalid, project_row
from storage import timestamp
from workbench import MAX_NODES

router = APIRouter(prefix="/workbench/v1")


def invalid_constant(value):
    raise ValueError("JSON 数字无效")


@router.get("/projects/{projectId}/export")
def export_project(request: Request, projectId: ResourceId):
    with request.app.state.db.connect() as db:
        project = project_row(db, projectId)
        rows = db.execute("SELECT * FROM workbench_nodes WHERE projectId = ? ORDER BY seq", (projectId,)).fetchall()
        if not rows:
            raise ApiError(409, "INVALID_STATE", "项目还没有任何节点，无需导出")
        info = {key: project[key] for key in ("name", "shopType", "market", "siStyle")}
        if project["storeType"] is not None:
            info["storeType"] = project["storeType"]
        nodes = []
        for row in rows:
            node = {key: row[key] for key in ("id", "parentId", "kind", "name", "strategy", "siStyle", "origin", "importedFrom")}
            node.update(space=json.loads(row["space"]) if row["space"] else None,
                        layout=json.loads(row["layout"]) if row["layout"] else None,
                        hidden=row["hiddenAt"] is not None)
            if row["sourceNodeId"] is not None:
                node["sourceNodeId"] = row["sourceNodeId"]
            nodes.append(node)
        drafts = [{"baseNodeId": row["baseNodeId"], "layout": json.loads(row["layout"])}
                  for row in db.execute("SELECT * FROM workbench_drafts WHERE projectId = ? ORDER BY updatedAt DESC, baseNodeId", (projectId,))]
    payload = {"format": "store-design-project", "schemaVersion": 1, "exportedAt": timestamp(),
               "project": info, "nodes": nodes, "draft": drafts[0] if drafts else None}
    if len(drafts) > 1:
        payload["drafts"] = drafts
    payload = request.app.state.rules.run("project-export", payload)
    filename = quote(info["name"] + ".store-design.json", safe="")
    return JSONResponse(payload, headers={"Content-Disposition": "attachment; filename*=UTF-8''" + filename,
                                          "Cache-Control": "no-store"})


def save_import(request, plan):
    if not 1 <= len(plan["nodes"]) <= MAX_NODES:
        raise invalid(f"节点数须在 1–{MAX_NODES} 之间")
    project_id, now, ids = str(uuid4()), timestamp(), {}
    with request.app.state.db.connect(write=True) as db:
        project = db.execute("""
            INSERT INTO projects (id,name,shopType,storeType,market,siStyle,createdAt,updatedAt)
            VALUES (?,?,?,?,?,?,?,?) RETURNING *
        """, (project_id, plan["name"], plan["shopType"], plan.get("storeType"),
              plan["market"], plan["siStyle"], now, now)).fetchone()
        for node in plan["nodes"]:
            node_id = str(uuid4())
            parent_id = ids.get(node["parentRef"]) if node["parentRef"] is not None else None
            if node["parentRef"] is not None and parent_id is None:
                raise invalid("节点父引用无效")
            db.execute("""
                INSERT INTO workbench_nodes (id,projectId,parentId,kind,name,space,layout,strategy,
                    siStyle,origin,importedFrom,hiddenAt,createdAt)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
            """, (node_id, project_id, parent_id, node["kind"], node["name"],
                  json.dumps(node["space"], ensure_ascii=False) if node["space"] is not None else None,
                  json.dumps(node["layout"], ensure_ascii=False) if node["layout"] is not None else None,
                  node["strategy"] if node["kind"] == "plan" else None, node["siStyle"], node["origin"],
                  node["importedFrom"], now if node["hidden"] else None, now))
            ids[node["ref"]] = node_id
        for node in plan["nodes"]:
            source = ids.get(node.get("sourceRef"))
            if source and source != ids[node["ref"]] and node["origin"] != "recognition":
                db.execute("UPDATE workbench_nodes SET sourceNodeId = ? WHERE id = ?", (source, ids[node["ref"]]))
        drafts = [plan.get("draft"), *plan.get("additionalDrafts", [])]
        imported_draft = False
        for draft in drafts:
            if draft is not None and draft["baseRef"] in ids:
                db.execute("""INSERT INTO workbench_drafts (projectId,baseNodeId,layout,revision,updatedAt)
                              VALUES (?,?,?,1,?)""",
                           (project_id, ids[draft["baseRef"]], json.dumps(draft["layout"], ensure_ascii=False), now))
                imported_draft = True
    return {"project": dict(project), "nodesImported": len(ids), "draftImported": imported_draft,
            "format": plan["format"], "warnings": plan["warnings"]}


@router.post("/projects/import", status_code=201)
async def import_project(request: Request):
    raw = await request.body()
    if len(raw) > 5 * 1024 * 1024:
        raise invalid("文件超过 5 MB，无法导入")
    try:
        payload = json.loads(raw, parse_constant=invalid_constant)
    except (ValueError, UnicodeDecodeError):
        raise invalid("这不是有效的项目文件") from None
    return await run_in_threadpool(import_payload, request, payload)


def import_payload(request, payload):
    plan = request.app.state.rules.run("project-import", payload)
    return save_import(request, plan)
