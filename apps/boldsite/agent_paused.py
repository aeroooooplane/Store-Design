"""Expose the existing availability contract while model access is intentionally paused."""
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Request

from contract import ApiError, ResourceId, project_row

router = APIRouter(prefix="/workbench/v1")
MESSAGE = "线上设计助理暂未接入模型服务，本轮不启用模型调用。"


def budget():
    return {"day": datetime.now(timezone(timedelta(hours=8))).date().isoformat(),
            "limitCny": 0, "spentCny": 0, "remainingCny": 0, "exceeded": False}


@router.get("/ai")
def overview():
    return {"models": [], "settings": {"agentModel": None, "recognitionModel": "local",
            "recognitionFallback": None, "recognitionCloud": False}, "budget": budget()}


@router.get("/ai/budget")
def ai_budget():
    return budget()


@router.patch("/ai/settings")
def update_settings():
    raise ApiError(400, "VALIDATION_FAILED", MESSAGE)


@router.get("/projects/{projectId}/agent/sessions")
def sessions(request: Request, projectId: ResourceId):
    with request.app.state.db.connect() as db:
        project_row(db, projectId)
    return []


@router.post("/projects/{projectId}/agent/sessions")
def create_session(request: Request, projectId: ResourceId):
    with request.app.state.db.connect() as db:
        project_row(db, projectId)
    raise ApiError(400, "VALIDATION_FAILED", MESSAGE)
