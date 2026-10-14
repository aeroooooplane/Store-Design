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
| BUDGET_EXCEEDED | 402 | 当日 AI 预算已用完（北京时间 0 点重置） |
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
| GET | `/files/{fileId}` | 按编号读取已登记文件（GLB、预览图等），支持 `If-None-Match` 返回 304；模型库文件的地址带内容哈希 `?v=`，与当前文件一致时按一年缓存（`immutable`），文件更新后地址随之改变；文件只是未下载的 LFS 指针时返回 404，`details.reason = "lfs_pointer"` |

### 历史节点、草稿、导入导出

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/projects/{id}/nodes` | 历史树（节点摘要，按创建顺序；`includeHidden=true` 含隐藏节点） |
| POST | `/projects/{id}/nodes` | 新建节点。方案只能建在空间下、白模只能建在方案（或旧的编辑节点）下、渲染只能建在白模下；`sourceNodeId` 标明复制来源，白模副本与渲染据此沿用视角。空间节点须为合法多边形（自动转为顺时针、毫米精度）；其他节点继承最近的空间祖先。模型必须存在且保持真实尺寸，没有网页模型的（如信息化物料）只能以 `placeholder: true` 引用，否则 400；越界、重叠等问题随结果返回，白模与渲染节点不允许有错误级问题 |
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

### 渲染图与交付

| 方法 | 路径 | 说明 |
|---|---|---|
| PUT | `/nodes/{id}/renders/{cameraId}/{mode}` | 上传浏览器渲染的一张视角图（请求体为 PNG，`mode` 为 material；white 为旧的白模图，仍可上传但不再列出、下载或交付）；只限渲染节点 |
| GET | `/nodes/{id}/renders` | 每个视角每种模式最新一张，`stale` 表示布局、所用模型文件或视角位姿已变 |
| GET | `/nodes/{id}/renders/archive` | 当前（未过期）渲染图打包为 ZIP |
| POST | `/nodes/{id}/deliveries` | 生成交付：请求体 `{ planPng, planSvg?, display? }`，`planPng` 为浏览器绘制的编号平面图；带 `display`（同 `/nodes/{id}/display/export` 的请求体）时一并生成展陈方案 PPT 与展陈清单，放进交付目录 `04_展陈方案/`。返回完整版与展示版 PDF、展陈方案 PPT（可空）、交付目录 ZIP 的下载地址 |
| GET | `/nodes/{id}/deliveries` | 该渲染节点的历次交付（新的在前） |

签名在服务端计算：布局签名含空间、铺位形态、布局、SI、市场与所用模型文件哈希；视角签名含位置、目标与视场角（改名不算）。交付要求每个视角的材质图都已渲染且未过期，否则返回 409（`details` 给出缺失与过期张数）。PDF 用随附的思源黑体子集（Noto Sans SC，GB2312 常用字）。

### 自动排布

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/layouts/generate` | 输入空间、铺位形态、SI 风格，返回“尽量多放 / 按面积推荐 / 尽量少放”候选布局（不保存）。收银台靠后墙，中岛桌避开入口缓冲与主通道并保留通道，配件柜沿墙。通道 1.2 m、间距 0.9 m、入口缓冲（边厅 1.2 m / 中岛与专区 1.0 m）是指导值，放不下时逐级让步并记录在 `planning.relaxations` 与 `planning.note`；`notes` 说明缺少模型、放不下等情况 |
| POST | `/layouts/validate` | 返回全部问题（越界、重叠、压障碍物或入口、超高、模型尺寸不符），供编辑器实时提示 |

模型按项目 SI 风格选择：同风格优先，其次通用款；中岛桌优先普通款，收银优先收银台/收银桌；同一长度的配件柜只用一个款式。“按面积推荐”的桌数暂沿用旧版经验公式（每约 18 ㎡ 一张），待清洗数据整理出规则后替换。

模型目录只读，由 `pnpm catalog:import` 从资源库导入或刷新（可重复运行，GLB 哈希须与转换记录一致才会挂接）。`name` 为模型选用表中的名称（未改名时为手册名称加变体），`retired` 为停用（模型选用表标为删除：自动排布不再选用，网页添加列表不显示，已有布局照常引用）。每件模型带分类 `category`（软装道具 / 信息化物料 / 品牌标识 / 非标陈列 / 环境设施，可作为 `GET /assets?category=` 过滤条件）、品类图库中的效果图 `productImage`（`productImageMatch` 为 exact 同款或 approximate 同类参考）和平面图 `planSymbol`（SVG，1 单位 = 1 毫米，正面朝下；以 `content-security-policy: default-src 'none'` 返回）。模型库位于 `资源库/04_模型库`，导入只读其 `manifest.json`（见该目录 README）。每件模型另有 `whiteGlb`：由 `pnpm catalog:white` 生成的白模轻量版（去掉贴图、法线和 UV，合并部件并简化到约 4 万面，外形尺寸偏差不超过 5 mm），只有记录中的源文件哈希与当前 `model.glb` 一致时才挂接；三维白模优先加载它。`finishGlb` 为材质轻量版：由 `pnpm catalog:finish` 生成（同材质部件合并为一次绘制；面积小于 0.01 ㎡ 且贴图不超过 256 px 的碎片贴图改为平均色写入顶点颜色；去掉法线后合并顶点，超过 25 万面的模型在 0.2% 误差内减面；贴图缩到 1024 px；SketchUp 正反两层面的材质标记 `extras.frontOnly`；外形尺寸偏差不超过 5 mm），记录源文件哈希，与当前 `model.glb` 一致才挂接；材质视图与渲染优先加载它，没有时退回完整模型。渲染图的布局签名包含它的哈希。

### AI 设置与预算

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/ai` | 可用模型（只列出已配置密钥的；境外模型须开启 `ENABLE_OVERSEAS_MODELS`）、当前设置与今日额度 |
| PATCH | `/ai/settings` | 修改 Agent 模型、平面识别模型、识别失败后的兜底模型（全站统一；每项都校验用途与可用性，兜底须联网且能看图，不能与识别模型相同） |
| GET | `/ai/budget` | 今日额度：上限、已用、剩余、是否用完 |

模型清单与估算单价在 `apps/api/src/ai/models.ts`；调用统一走 `ai/chat.ts`（DeepSeek、通义千问为 OpenAI 兼容格式，Claude 为官方接口），调用前检查当日额度，调用后按厂商返回的 token 数记入 `ai_usage`；超额返回 402，厂商失败返回 502 `UPSTREAM_FAILED` 且不记账。本地识别不经过此层、不计费。

### 上传识别（第二期）

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/projects/{id}/uploads` | 上传平面简图：请求体为 PNG 或 JPEG 原始字节（20 MB 内，边长 8192 px 内），查询参数 `originalName`、`page`；PDF 由浏览器用 pdf.js 按页转成 PNG 再上传 |
| GET | `/projects/{id}/uploads` | 项目最近 20 张简图 |
| POST | `/uploads/{id}/recognize` | 识别。`method` 省略时按设置：平面识别模型为“本地识别”则先本地（需要浏览器提取的 `vector`：矢量 PDF 页面的文字、线段、矩形与颜色），不合格时自动改用“识别失败后”的模型；可带 `crop`（图上框选的区域，像素）和 `calibration`（用户指定的已知长度）。返回本次 `run` 与被替代的本地尝试 `attempted` |
| GET | `/uploads/{id}/runs` | 一张简图的识别记录（最新在前） |
| GET | `/recognition-runs/{id}` | 一次识别的结果 |
| POST | `/recognition-runs/{id}/confirm` | 用户校对后的空间（可带保留的道具布局）生成来源为 `recognition` 的根空间节点；同一记录只能确认一次 |

识别结果 `draft`：`space`（边界、入口、障碍物、层高可空）、`items`（图上文字、对应模型、用途、分类 现状/新增需求/区域外、位置尺寸、置信度、说明）、`scale`（比例来源与每像素毫米数、是否交叉核对）、`pending`（待人工确认事项）、`confidence`、`notes`。失败判定（需求 4.2）：比例无法标定、边界不闭合、整体置信度低于 0.6；失败的记录仍保留草稿，用户校准后可重试或直接手动录入。

### 展陈方案

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/display-rules/current` | 现行展陈规则（版本、产品、托盘、版式），未导入时 404 |
| GET | `/nodes/{id}/display` | 渲染节点的展陈方案：按指引编号的中岛桌与边桌、各槽位产品（含用户修改）、平面与每个视角效果图上的标签位置（由视角投影算出）、历次导出 |
| PUT | `/nodes/{id}/display` | 保存修改 `{ orientation, landscapeEnd, slots, modules }`，带 `If-Match` |
| POST | `/nodes/{id}/display/export` | 生成展陈方案 PPT 与展陈清单 Excel：请求体 `{ planPng, planViewBox }` 为浏览器绘制的无编号平面图及其范围（米） |
| GET / POST | `/display-tasks` | 上传式展陈任务（工作流 2）列表与新建 `{ name, market, siStyle }` |
| GET / PATCH / DELETE | `/display-tasks/{id}` | 任务详情、修改（入口、桌子、标签位置、槽位修改，带 `If-Match`）、删除（软删除） |
| PUT | `/display-tasks/{id}/{plan|render}` | 上传平面图或效果图（PNG/JPEG 原始字节，查询参数 `originalName`、`page`，带 `If-Match`） |
| POST | `/display-tasks/{id}/detect` | 识别桌子：矢量 PDF 页带浏览器提取的 `vector` 时本地找“中岛桌”标注与桌面外框，否则用视觉模型；效果图由视觉模型框桌、程序按远近与左右对号。返回更新后的任务 |
| POST | `/display-tasks/{id}/export` | 按任务生成展陈方案 PPT 与清单 |

任务不建正式项目；`state`（入口、桌子、修改）与工作流 1 的数据结构一致，以后可加“转为项目”。

### Agent 对话（第三期）

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/projects/{id}/agent/sessions` | 新建对话（可带标题；默认取第一句话前 30 字） |
| GET | `/projects/{id}/agent/sessions` | 项目的对话列表（最近的在前，最多 100 条） |
| GET | `/agent/sessions/{id}/messages` | 对话的全部消息：`role` 为 user / assistant / tool，assistant 消息带 `toolCalls` 与执行记录 `actions`（工具名、输入、结果、状态、生成的节点、撤销时间），以及模型、token 数与费用 |
| POST | `/agent/sessions/{id}/messages` | 发消息：`text`（4000 字内）、`nodeId`（当前看的节点，修改从它开始）、`selectedItemIds`、`planPng`（平面截图 base64，4 MB 内；随消息保存，只交给能看图的模型）。服务端带着项目状态调用所选的 Agent 模型，模型通过工具修改项目，每次修改生成 `origin = agent` 的新节点；返回 `userMessage`、最终的 `reply` 和应切换到的 `currentNodeId`。没有可用模型 400，超额 402，模型失败 502（用户消息保留） |
| POST | `/agent/actions/{id}/undo` | 撤销一次修改：隐藏它生成的节点，或删除它添加的视角 / 恢复它删除的视角；已撤销或没有可撤销改动的动作返回 409 |

工具清单与说明在 `apps/api/src/modules/agent/tools.ts`（get_state、list_models、generate_plans、place_item、move_item、rotate_item、remove_item、validate、set_style（在方案或三维效果阶段切换 SI 时按映射表换道具并另存新节点）、edit_space（层高、矩形宽深、入口、加柱子，生成新的空间节点）、confirm_white（进入三维效果）、start_render、list_views / add_view / remove_view（三维效果或渲染节点的视角，撤销即删除或恢复）、export_project）；参数由 zod 定义并导出为 JSON Schema 交给模型，执行前再校验一次，校验失败或工具抛出的业务错误都作为失败结果回给模型继续处理。

## 修改接口后

```powershell
pnpm api:openapi   # 重新导出 openapi.json 并生成前端类型 apps/web/src/api/schema.d.ts
```

CI 会检查这两个文件与代码一致。
