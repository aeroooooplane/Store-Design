from typing import Annotated, Literal
from uuid import uuid4

from fastapi import APIRouter, Header, Query, Request
from pydantic import AfterValidator, BaseModel, ConfigDict, model_validator

from contract import ApiError, ResourceId, current_revision, project_row, with_revision
from storage import timestamp

router = APIRouter(prefix="/api/v1")

ShopType = Literal["side_hall", "island", "zone"]
Market = Literal["domestic", "overseas"]
SiStyle = Literal["SI1.0", "SI2.0"]


def normalized_text(value, minimum, maximum):
    value = value.strip()
    if not minimum <= len(value.encode("utf-16-le")) // 2 <= maximum:
        raise ValueError(f"长度须在 {minimum}–{maximum} 个字符之间")
    return value


Name = Annotated[str, AfterValidator(lambda value: normalized_text(value, 1, 100))]
Search = Annotated[str, AfterValidator(lambda value: normalized_text(value, 0, 100))]


class ProjectCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: Name
    shopType: ShopType
    market: Market = "domestic"
    siStyle: SiStyle = "SI1.0"


class ProjectUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: Name | None = None
    shopType: ShopType | None = None
    market: Market | None = None
    siStyle: SiStyle | None = None

    @model_validator(mode="after")
    def require_fields(self):
        fields = self.model_dump(exclude_unset=True)
        if not fields or None in fields.values():
            raise ValueError("至少修改一个字段，字段值须有效")
        return self


@router.get("/projects")
def list_projects(
    request: Request,
    q: Search = "",
    status: Literal["active", "deleted", "all"] = "active",
    page: Annotated[int, Query(ge=1, le=10000)] = 1,
    pageSize: Annotated[int, Query(ge=1, le=100)] = 20,
):
    states = {"active": "deletedAt IS NULL", "deleted": "deletedAt IS NOT NULL", "all": "1"}
    query = f"FROM projects WHERE {states[status]} AND instr(casefold(name), ?) > 0"
    with request.app.state.db.connect() as db:
        total = db.execute("SELECT count(*) " + query, (q.casefold(),)).fetchone()[0]
        rows = db.execute(
            "SELECT * " + query + " ORDER BY updatedAt DESC, id DESC LIMIT ? OFFSET ?",
            (q.casefold(), pageSize, (page - 1) * pageSize),
        )
        items = [dict(row) for row in rows]
    return {"items": items, "total": total, "page": page, "pageSize": pageSize}


@router.post("/projects", status_code=201)
def create_project(request: Request, payload: ProjectCreate):
    now = timestamp()
    params = {**payload.model_dump(), "id": str(uuid4()), "now": now}
    with request.app.state.db.connect(write=True) as db:
        row = db.execute("""
            INSERT INTO projects (id, name, shopType, market, siStyle, createdAt, updatedAt)
            VALUES (:id, :name, :shopType, :market, :siStyle, :now, :now) RETURNING *
        """, params).fetchone()
    return with_revision(row, 201)


@router.get("/projects/{projectId}")
def get_project(request: Request, projectId: ResourceId):
    with request.app.state.db.connect() as db:
        return with_revision(project_row(db, projectId))


def write_project(request, project_id, header, changes, *, restoring=False):
    revision = current_revision(header)
    with request.app.state.db.connect(write=True) as db:
        project = project_row(db, project_id)
        if project["revision"] != revision:
            raise ApiError(409, "REVISION_CONFLICT", "项目已被其他人修改，请刷新后再操作", {
                "currentRevision": project["revision"],
            })
        if (project["deletedAt"] is not None) != restoring:
            message = "项目不在回收站中" if restoring else "项目在回收站中，请先恢复"
            raise ApiError(409, "INVALID_STATE", message)
        # Only field names from ProjectUpdate or the fixed deletedAt field reach this statement.
        assignments = ", ".join(f"{field} = ?" for field in changes)
        row = db.execute(
            f"""UPDATE projects SET {assignments}, revision = revision + 1, updatedAt = ?
                WHERE id = ? RETURNING *""",
            (*changes.values(), timestamp(), project_id),
        ).fetchone()
    return with_revision(row)


@router.patch("/projects/{projectId}")
def update_project(
    request: Request, projectId: ResourceId, payload: ProjectUpdate, if_match: Annotated[str | None, Header()] = None
):
    return write_project(request, projectId, if_match, payload.model_dump(exclude_unset=True))


@router.delete("/projects/{projectId}")
def delete_project(request: Request, projectId: ResourceId, if_match: Annotated[str | None, Header()] = None):
    return write_project(request, projectId, if_match, {"deletedAt": timestamp()})


@router.post("/projects/{projectId}/restore")
def restore_project(request: Request, projectId: ResourceId, if_match: Annotated[str | None, Header()] = None):
    return write_project(request, projectId, if_match, {"deletedAt": None}, restoring=True)
