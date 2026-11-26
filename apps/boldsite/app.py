import logging
import os
import sqlite3
import sys
from contextlib import asynccontextmanager
from pathlib import Path
from secrets import token_urlsafe

ROOT = Path(__file__).resolve().parent
vendor = ROOT / "vendor"
if vendor.is_dir():
    sys.path.insert(0, str(vendor))

import uvicorn
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException

from catalog import Catalog, router as catalog
from contract import ApiError, FullWorkbenchTransport, ServicePrefix, error_response, invalid, missing
from drawings import router as drawings
from projects import router as projects
from rules import Rules
from workbench import router as workbench
from render_stage import router as render_stage
from stage_delivery import router as stage_delivery
from display_tasks import router as display_tasks

FULL_WORKBENCH = (ROOT / "workbench-mode.txt").is_file()
from storage import configured_database
from storage_gate import StorageBusy

ROOT_ASSETS = {
    "favicon.ico",
    "favicon.svg",
    "icon-192.png",
    "icon-512.png",
    "icon-maskable-512.png",
    "apple-touch-icon.png",
    "manifest.webmanifest",
}


@asynccontextmanager
async def lifespan(app):
    app.state.db = configured_database()
    app.state.db.initialize()
    app.state.catalog = Catalog(ROOT / "catalog")
    if FULL_WORKBENCH:
        app.state.db.initialize_workbench()
        app.state.rules = Rules(ROOT / "workbench-rules.js", app.state.catalog.items)
    yield


app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None, redirect_slashes=False)
if FULL_WORKBENCH:
    app.state.workbench_write_token = token_urlsafe(32)
    app.add_middleware(FullWorkbenchTransport, token=app.state.workbench_write_token)
    app.include_router(workbench)
    app.include_router(render_stage)
    app.include_router(stage_delivery)
    app.include_router(display_tasks)
app.add_middleware(ServicePrefix)
app.include_router(projects)
app.include_router(drawings)
app.include_router(catalog)


@app.exception_handler(ApiError)
async def handle_api_error(request: Request, error: ApiError):
    return error_response(request, error)


@app.exception_handler(StorageBusy)
async def handle_storage_busy(request: Request, error: StorageBusy):
    response = error_response(request, ApiError(503, "STORAGE_BUSY", str(error)))
    response.headers["Retry-After"] = "1"
    return response



@app.exception_handler(RequestValidationError)
async def handle_validation(request: Request, error: RequestValidationError):
    return error_response(request, invalid("请求参数或内容无效"))


@app.exception_handler(HTTPException)
async def handle_http_error(request: Request, error: HTTPException):
    code = "NOT_FOUND" if error.status_code == 404 else "VALIDATION_FAILED"
    return error_response(request, ApiError(error.status_code, code, "路径或请求方法无效"))


@app.exception_handler(Exception)
async def handle_unexpected(request: Request, error: Exception):
    return error_response(request, ApiError(500, "INTERNAL", "服务暂时无法处理该请求"))


@app.get("/workbench/v1/health")
def health(request: Request):
    status, database = "ok", "ok"
    try:
        with request.app.state.db.connect() as db:
            db.execute("SELECT revision FROM projects LIMIT 1").fetchone()
    except (sqlite3.Error, StorageBusy):
        logging.getLogger(__name__).exception("SQLite health check failed")
        status, database = "degraded", "unavailable"
    return {"status": status, "version": "0.1.0", "database": database}


@app.get("/")
def index():
    return FileResponse(ROOT / "index.html", headers={"cache-control": "no-cache"})


@app.get("/{name}")
def root_asset(name: str):
    if name not in ROOT_ASSETS or not (ROOT / name).is_file():
        raise missing("文件")
    return FileResponse(ROOT / name)


if (ROOT / "static").is_dir():
    app.mount("/static", StaticFiles(directory=ROOT / "static"), name="static")


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("CAPort", "9000")), workers=1)
