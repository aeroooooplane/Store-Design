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

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/assets` | 模型目录：`q` 按编号或名称搜索、`function` 用途、`placeable=true|false`、`siFamily`；每项含占地尺寸 `footprint`（米）、正面方向 `front`、GLB 与预览图链接 |
| GET | `/assets/{assetId}` | 单个模型 |
| GET | `/files/{fileId}` | 按编号读取已登记文件（GLB、预览图等），支持 `If-None-Match` 返回 304；文件只是未下载的 LFS 指针时返回 404，`details.reason = "lfs_pointer"` |

### 历史节点、草稿、导入导出

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/projects/{id}/nodes` | 历史树（节点摘要，按创建顺序；`includeHidden=true` 含隐藏节点） |
| POST | `/projects/{id}/nodes` | 新建节点。方案只能建在空间下、白模只能建在方案（或旧的编辑节点）下、渲染只能建在白模下；`sourceNodeId` 标明复制来源，白模副本与渲染据此沿用视角。空间节点须为合法多边形（自动转为顺时针、毫米精度）；其他节点继承最近的空间祖先。模型必须存在且保持真实尺寸，没有网页模型的（如信息化物料）只能以 `placeholder: true` 引用，否则 400；越界、重叠等问题随结果返回，白模确认与渲染节点不允许有错误级问题 |
| GET | `/nodes/{id}` | 节点详情（含空间与布局） |
| PATCH | `/nodes/{id}` | 重命名（节点内容不可修改） |
| POST | `/nodes/{id}/hide`、`/nodes/{id}/restore` | 在树图中隐藏 / 恢复，不删除 |
| GET / PUT / DELETE | `/projects/{id}/draft` | 共享编辑草稿；首次 PUT 不带 If-Match，之后必须带；过期版本 409 |
| POST | `/projects/import` | 导入项目文件为**新项目**：新格式或旧版工作台备份（v1/v2）。旧版矩形转多边形、左上角坐标转中心点、结构占位转障碍物；与当前模型不符的道具改为占位；逐条返回 `warnings` |
| GET | `/projects/{id}/export` | 导出全部节点（含隐藏）与草稿，格式 `store-design-project` v1 |

### 白模视角

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/nodes/{id}/cameras` | 白模节点的视角（按顺序；`includeDeleted=true` 含已删除） |
| POST | `/nodes/{id}/cameras` | 添加视角（名称、位置、目标点、视场角），来源记为 user；只限白模与渲染节点，每个节点最多 24 个 |
| PATCH | `/cameras/{id}` | 重命名或调整视角；调整了位置、目标或视场角的默认视角来源变为 user |
| DELETE | `/cameras/{id}`、POST `/cameras/{id}/restore` | 删除（可恢复）/ 恢复 |

新建白模节点时自动生成视角：沿用它所继续的上一个白模的有效视角（同一空间内），否则生成默认 8 个视角（正面鸟瞰、左前方、右前方、右后方、左后方、背面鸟瞰、顶部俯视、入口方向）。默认视角按主入口确定“前方”，矩形且入口在下边时与旧版位置完全一致；画面比例 3:2。视角修改暂不做乐观锁（后写入者生效）。

### 自动排布

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/layouts/generate` | 输入空间、铺位形态、SI 风格，返回“尽量多放 / 按面积推荐 / 尽量少放”候选布局（不保存）。收银台靠后墙，中岛桌避开入口缓冲与主通道并保留通道，配件柜沿墙。通道 1.2 m、间距 0.9 m、入口缓冲（边厅 1.2 m / 中岛与专区 1.0 m）是指导值，放不下时逐级让步并记录在 `planning.relaxations` 与 `planning.note`；`notes` 说明缺少模型、放不下等情况 |
| POST | `/layouts/validate` | 返回全部问题（越界、重叠、压障碍物或入口、超高、模型尺寸不符），供编辑器实时提示 |

模型按项目 SI 风格选择：同风格优先，其次通用款；中岛桌优先普通款，收银优先收银台/收银桌；同一长度的配件柜只用一个款式。“按面积推荐”的桌数暂沿用旧版经验公式（每约 18 ㎡ 一张），待清洗数据整理出规则后替换。

模型目录只读，由 `pnpm catalog:import` 从资源库导入或刷新（可重复运行，GLB 哈希须与转换记录一致才会挂接）。`name` 为模型选用表中的名称（未改名时为手册名称加变体），`retired` 为停用（模型选用表标为删除：自动排布不再选用，网页添加列表不显示，已有布局照常引用）。每件模型带分类 `category`（软装道具 / 信息化物料 / 品牌标识 / 非标陈列 / 环境设施，可作为 `GET /assets?category=` 过滤条件）、品类图库中的效果图 `productImage`（`productImageMatch` 为 exact 同款或 approximate 同类参考）和平面图 `planSymbol`（SVG，1 单位 = 1 毫米，正面朝下；以 `content-security-policy: default-src 'none'` 返回）。模型库位于 `资源库/04_模型库`，导入只读其 `manifest.json`（见该目录 README）。每件模型另有 `whiteGlb`：由 `pnpm catalog:white` 生成的白模轻量版（去掉贴图、法线和 UV，合并部件并简化到约 4 万面，外形尺寸偏差不超过 5 mm），只有记录中的源文件哈希与当前 `model.glb` 一致时才挂接；三维白模优先加载它，完整模型留给材质渲染。

## 修改接口后

```powershell
pnpm api:openapi   # 重新导出 openapi.json 并生成前端类型 apps/web/src/api/schema.d.ts
```

CI 会检查这两个文件与代码一致。
