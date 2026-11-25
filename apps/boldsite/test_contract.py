import asyncio
import json
import os
import tempfile
import unittest
from io import BytesIO
from pathlib import Path
from unittest.mock import patch
from urllib.parse import urlsplit
from uuid import uuid4

from app import app
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
SPEC = json.loads((ROOT / "apps/api/openapi.json").read_text(encoding="utf-8"))["paths"]
PREFIX = "/svc/test-application"


class PilotContractTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.directory = self.enterContext(tempfile.TemporaryDirectory())
        self.enterContext(patch.dict(os.environ, {"DATA_DIR": self.directory}))
        await self.enterAsyncContext(app.router.lifespan_context(app))

    async def request(self, method, target, *, root="", payload=None, body=b"", headers=None):
        url = urlsplit(target)
        headers = dict(headers or {})
        if payload is not None:
            headers["content-type"] = "application/json"
            body = json.dumps(payload).encode()
        scope = {
            "type": "http",
            "asgi": {"version": "3.0"},
            "method": method,
            "scheme": "http",
            "root_path": root,
            "path": url.path,
            "query_string": url.query.encode(),
            "headers": [(k.encode(), v.encode()) for k, v in headers.items()],
        }
        messages = []
        received = False

        async def receive():
            nonlocal received
            if received:
                return {"type": "http.disconnect"}
            received = True
            return {"type": "http.request", "body": body}

        async def send(message):
            messages.append(message)

        await app(scope, receive, send)
        response = messages[0]
        raw = b"".join(message.get("body", b"") for message in messages[1:])
        found = {k.decode(): v.decode() for k, v in response["headers"]}
        value = json.loads(raw) if found.get("content-type") == "application/json" else raw
        return response["status"], found, value

    def response_keys(self, path, method, status, actual):
        response = SPEC[path.replace("/workbench/v1/", "/api/v1/", 1)][method]["responses"][str(status)]
        schema = response["content"]["application/json"]["schema"]
        if schema.get("type") == "array":
            schema = schema["items"]
        self.assertEqual(set(actual), set(schema["properties"]))

    async def create(self):
        road = "/workbench/v1/projects"
        code, headers, project = await self.request(
            "POST", PREFIX + road, payload={"name": "  虚构 100%_ 店  ", "shopType": "zone"}
        )
        self.assertEqual(code, 201)
        self.assertEqual(headers["etag"], '"1"')
        self.assertEqual(project["name"], "虚构 100%_ 店")
        self.assertEqual((project["market"], project["siStyle"]), ("domestic", "SI1.0"))
        self.response_keys(road, "post", 201, project)
        return "/workbench/v1/projects/" + project["id"], project

    async def test_proxy_paths_and_health(self):
        health = "/workbench/v1/health"
        for path, root in [(health, ""), (PREFIX + health, ""), (PREFIX + health, PREFIX), (health, PREFIX)]:
            status, _, value = await self.request("GET", path, root=root)
            self.assertEqual(status, 200)
            self.assertEqual((value["status"], value["database"]), ("ok", "ok"))
            self.response_keys(health, "get", 200, value)
        status, headers, _ = await self.request("GET", PREFIX + "?sample=1")
        self.assertEqual((status, headers["location"]), (307, PREFIX + "/?sample=1"))

    async def test_project_search_revisions_and_recycle_bin(self):
        road, project = await self.create()
        for query, total in [("?q=100%25_", 1), ("?q=_店", 0), ("?status=deleted", 0)]:
            status, _, result = await self.request("GET", "/workbench/v1/projects" + query)
            self.assertEqual((status, result["total"]), (200, total))
            self.response_keys("/workbench/v1/projects", "get", 200, result)
        for value, expected in [(None, 428), ('"0"', 400), ('"2"', 409)]:
            status, _, result = await self.request(
                "PATCH", road, payload={"name": "旧页面"}, headers={"if-match": value} if value else {}
            )
            self.assertEqual(status, expected)
            self.assertTrue(result["error"]["requestId"])
        responses = await asyncio.gather(*(
            self.request("PATCH", road, payload={"name": name}, headers={"if-match": '"1"'})
            for name in ["窗口 A", "窗口 B"]
        ))
        self.assertEqual(sorted(status for status, _, _ in responses), [200, 409])
        saved = next(value for status, _, value in responses if status == 200)
        self.assertEqual(saved["revision"], 2)
        self.assertEqual((await self.request("GET", road))[2], saved)
        status, _, deleted = await self.request("DELETE", road, headers={"if-match": '"2"'})
        self.assertEqual(status, 200)
        self.assertIsNotNone(deleted["deletedAt"])
        status, _, revived = await self.request("POST", road + "/restore", headers={"if-match": '"3"'})
        self.assertEqual((status, revived["revision"], revived["deletedAt"]), (200, 4, None))
        self.assertEqual(revived["id"], project["id"])

    async def test_pilot_gateway_post_preserves_revision_guard(self):
        road, _ = await self.create()
        payload = {"siStyle": "SI2.0"}
        missing, _, _ = await self.request("POST", road + "/save", payload=payload)
        self.assertEqual(missing, 428)
        ok, headers, saved = await self.request("POST", road + "/save?ifMatch=%221%22", payload=payload)
        self.assertEqual((ok, headers["etag"], saved["revision"], saved["siStyle"]), (200, '"2"', 2, "SI2.0"))
        conflict, _, _ = await self.request("POST", road + "/save?ifMatch=1", payload=payload)
        self.assertEqual(conflict, 409)
        status, _, project = await self.request("POST", road + "/trash?ifMatch=2")
        self.assertEqual(status, 200)
        self.assertIsNotNone(project["deletedAt"])
        status, _, project = await self.request("POST", road + "/restore?ifMatch=3")
        self.assertEqual(status, 200)
        self.assertIsNone(project["deletedAt"])


    async def test_validation(self):
        project = {"name": " ", "shopType": "zone"}
        self.assertEqual((await self.request("POST", "/workbench/v1/projects", payload=project))[0], 400)
        self.assertEqual((await self.request("GET", "/workbench/v1/projects?pageSize=0"))[0], 400)
        self.assertEqual((await self.request("GET", "/workbench/v1/projects/invalid"))[0], 400)
        self.assertEqual((await self.request("GET", "/workbench/v1/projects/" + str(uuid4())))[0], 404)
        road, _ = await self.create()
        for fields in ({}, {"name": None}, {"unknown": 1}):
            self.assertEqual((await self.request("PATCH", road, payload=fields, headers={"if-match": "1"}))[0], 400)

    async def test_upload_and_file_contract(self):
        road, project = await self.create()
        route = PREFIX + road + "/uploads"
        png = BytesIO()
        Image.new("RGB", (640, 80), "white").save(png, format="PNG")
        data = png.getvalue()
        headers = {"content-type": "image/png"}
        status, _, upload = await self.request(
            "POST", route + "?originalName=%E5%81%87%E5%9B%BE.pdf&page=2", body=data, headers=headers
        )
        self.assertEqual(status, 201)
        self.assertEqual((upload["projectId"], upload["page"], upload["width"], upload["height"]),
                         (project["id"], 2, 640, 80))
        self.response_keys("/workbench/v1/projects/{projectId}/uploads", "post", 201, upload)
        self.assertEqual((await self.request("GET", route))[2], [upload])
        self.assertEqual((await self.request("POST", route, headers=headers, body=b"bad PNG"))[0], 400)
        self.assertEqual((await self.request("POST", route, headers=headers, body=b"x" * (20 * 1024 * 1024 + 1)))[0],
                         413)
        address = PREFIX + upload["url"]
        status, response, downloaded = await self.request("GET", address)
        self.assertEqual((status, response["content-type"], downloaded), (200, "image/png", data))
        self.assertTrue(response["content-disposition"].endswith(".png"))
        self.assertEqual((await self.request("GET", address, headers={"if-none-match": response["etag"]}))[0], 304)
        status, response, thumbnail = await self.request("GET", address + "?w=160")
        self.assertEqual((status, response["content-type"]), (200, "image/webp"))
        with Image.open(BytesIO(thumbnail)) as image:
            self.assertEqual(image.size, (160, 20))
