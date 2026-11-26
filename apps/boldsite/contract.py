import re
from typing import Annotated
from urllib.parse import parse_qsl, quote, urlencode
from uuid import UUID, uuid4

from fastapi import Request
from fastapi.responses import JSONResponse
from pydantic import AfterValidator
from starlette.responses import RedirectResponse


class ApiError(Exception):
    def __init__(self, status, code, message, details=None):
        self.status = status
        self.code = code
        self.message = message
        self.details = details


def error_response(request: Request, error: ApiError):
    request_id = getattr(request.state, "request_id", None) or str(uuid4())
    data = {
        "code": error.code,
        "message": error.message,
        "requestId": request_id,
    }
    if error.details is not None:
        data["details"] = error.details
    return JSONResponse({"error": data}, status_code=error.status)


def invalid(message):
    return ApiError(400, "VALIDATION_FAILED", message)


def missing(what):
    return ApiError(404, "NOT_FOUND", f"{what}不存在")


def current_revision(header):
    if not header or not header.strip():
        raise ApiError(428, "REVISION_REQUIRED", "缺少 If-Match 版本号，请刷新后重试")
    match = re.fullmatch(r'(?:W/)?"?([0-9]{1,9})"?', header.strip())
    if not match or int(match[1]) < 1:
        raise invalid("If-Match 版本号格式无效")
    return int(match[1])


def with_revision(project, status=200):
    return JSONResponse(dict(project), status_code=status, headers={"ETag": f'"{project["revision"]}"'})


def project_row(db, project_id, *, active=False):
    row = db.execute("SELECT * FROM projects WHERE id = ?", (project_id,)).fetchone()
    if row is None:
        raise missing("项目")
    if active and row["deletedAt"] is not None:
        raise ApiError(409, "INVALID_STATE", "项目在回收站中，请先恢复")
    return row


def validate_uuid(value):
    if str(UUID(value)) != value.lower():
        raise ValueError("UUID 格式无效")
    return value.lower()


ResourceId = Annotated[str, AfterValidator(validate_uuid)]


class FullWorkbenchTransport:
    """Restore HTTP verbs and revisions carried through the site's GET/POST boundary."""

    def __init__(self, app, origin):
        self.app, self.origin = app, origin

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or not scope["path"].startswith("/workbench/v1/"):
            await self.app(scope, receive, send)
            return
        request = Request(scope)
        try:
            prefix = "/workbench/v1/"
            action = re.fullmatch(r"_write/(patch|put|delete)/(.+)", scope["path"][len(prefix):])
            if action and scope["method"] != "POST":
                raise invalid("请求方法无效")
            method = action[1].upper() if action else scope["method"]
            if method not in {"GET", "HEAD", "OPTIONS"} and request.headers.get("origin") != self.origin:
                raise ApiError(403, "FORBIDDEN", "工作台写请求必须来自本站")
            query = parse_qsl(scope["query_string"].decode("ascii"), keep_blank_values=True)
            revisions = [value for key, value in query if key == "__workbench_if_match"]
            headers = scope["headers"]
            if revisions:
                if (
                    len(revisions) != 1 or scope["method"] != "POST" or "if-match" in request.headers
                    or not re.fullmatch(r"[\x20-\x7e\t]{0,128}", revisions[0])
                ):
                    raise invalid("工作台版本参数无效")
                headers = [*headers, (b"if-match", revisions[0].encode("ascii"))]
                query = [(key, value) for key, value in query if key != "__workbench_if_match"]
            scope = {
                **scope, "method": method, "headers": headers, "query_string": urlencode(query).encode("ascii"),
                "path": prefix + action[2] if action else scope["path"],
            }
        except ApiError as error:
            await error_response(request, error)(scope, receive, send)
            return
        await self.app(scope, receive, send)



class ServicePrefix:
    """Normalize the HTTP scope while leaving the original browser URL in place."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] == "http":
            scope = {**scope, "state": {**scope.get("state", {}), "request_id": str(uuid4())}}
            path = scope["path"]
            prefix = re.match(r"^/svc/[^/]+(?=/|$)", path)
            if prefix:
                root = prefix[0]
                if path == root:
                    target = quote(root, safe="/") + "/"
                    if scope["query_string"]:
                        target += "?" + scope["query_string"].decode("latin-1")
                    await RedirectResponse(target)(scope, receive, send)
                    return
                scope["path"] = path[len(root):]
                scope["root_path"] = ""
            elif scope.get("root_path"):
                # Some proxies provide root_path but already forward a stripped route.
                scope["root_path"] = ""

        async def send_uncached_metadata(message):
            if message["type"] == "http.response.start":
                message["headers"] = [*message["headers"], (b"cache-control", b"no-store")]
            await send(message)

        path = scope.get("path", "")
        uncached = path.startswith("/workbench/v1/") and not path.startswith("/workbench/v1/files/")

        await self.app(scope, receive, send_uncached_metadata if uncached else send)
