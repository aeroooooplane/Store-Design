# API 说明

更新：2026-10-09。完整接口以运行中的 OpenAPI 文档为准：启动后访问 <http://127.0.0.1:3001/api/docs>，机器可读版本提交在 [apps/api/openapi.json](../apps/api/openapi.json)。

## 约定

| 项 | 规则 |
|---|---|
| 前缀 | `/api/v1` |
| 格式 | JSON，UTF-8；请求体上限 5 MB |
| 时间 | ISO 8601，带时区 |
| 尺寸 | 米（3 位小数）；界面显示毫米 |
| 身份 | 开发阶段无需登录；每个请求的操作者为 `visitor` |
| 请求编号 | 响应头 `x-request-id`；客户端可传入安全格式的同名头以串联日志 |
| 限流 | 全局每分钟 300 次（`RATE_LIMIT_MAX`），写接口每分钟 60 次 |

## 乐观锁

可修改的资源带 `revision`，读取和写入响应都返回 `ETag: "<revision>"`。写接口必须带 `If-Match: "<revision>"`：

- 缺少 → `428 REVISION_REQUIRED`
- 版本已过期（其他人先改了）→ `409 REVISION_CONFLICT`，`details.currentRevision` 给出最新版本
- 成功 → `revision + 1`

## 错误格式

```json
{ "error": { "code": "VALIDATION_FAILED", "message": "请求体校验失败", "details": [{ "location": "body", "path": "/name", "message": "..." }], "requestId": "..." } }
```

| code | HTTP | 含义 |
|---|---|---|
| VALIDATION_FAILED | 400 | 参数、请求体或 JSON 格式不合法 |
| BUDGET_EXCEEDED | 402 | 当日 AI 预算已用完（后续阶段） |
| FORBIDDEN | 403 | 无权限（接入用户系统后） |
| NOT_FOUND | 404 | 资源或接口不存在 |
| REVISION_CONFLICT | 409 | 版本冲突 |
| INVALID_STATE | 409 | 资源状态不允许此操作，例如修改回收站中的项目 |
| PAYLOAD_TOO_LARGE | 413 | 请求体过大 |
| REVISION_REQUIRED | 428 | 缺少 If-Match |
| RATE_LIMITED | 429 | 请求过于频繁 |
| INTERNAL | 500 | 服务器内部错误（不返回堆栈） |

## 已实现接口（第一阶段骨架）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/health` | 运行状态与数据库连通性 |
| GET | `/projects` | 列表：`q` 名称搜索（按字面匹配）、`status=active\|deleted\|all`、`page`、`pageSize≤100` |
| POST | `/projects` | 新建：`name`、`shopType`（side_hall / island / zone）、`market` 默认 domestic、`siStyle` 默认 SI1.0；拒绝未知字段 |
| GET | `/projects/{id}` | 详情（含回收站中的项目） |
| PATCH | `/projects/{id}` | 修改名称、铺位形态、市场、SI 风格；需 If-Match |
| DELETE | `/projects/{id}` | 移入回收站（软删除）；需 If-Match |
| POST | `/projects/{id}/restore` | 从回收站恢复；需 If-Match |

删除与恢复写入审计表 `audit_events`。

## 修改接口后

```powershell
pnpm api:openapi   # 重新导出 openapi.json 并生成前端类型 apps/web/src/api/schema.d.ts
```

CI 会检查这两个文件与代码一致。
