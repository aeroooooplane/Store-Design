# 架构说明

更新：2026-10-09。第一期已实现：shared、database；api 的项目、模型目录与文件、历史节点、共享草稿、项目导入导出、排布生成与校验；web 的项目列表与项目工作台（历史树、多边形空间录入、三种方案生成与选用、平面编辑与草稿自动保存、三维白模与三维拖拽、白模视角）。浏览器渲染保存与交付按分期继续实现。需求见 [requirements.md](requirements.md)，数据表见 [data-model.md](data-model.md)。重构前的实际架构见 [归档](archive/20261009-before-refactor/architecture.md)。

## 1. 总体结构

```text
浏览器 apps/web ──REST/JSON──▶ apps/api ──▶ PostgreSQL
  React + Three.js              Fastify          （database/ 管理 schema 与迁移）
  只通过 API 访问数据            │
                                ├──▶ 文件存储（STORAGE_ROOT，默认指向 资源库/ 与 data/files/）
                                ├──▶ 任务队列（jobs 表）──▶ services/worker（Python：识别、PDF、Blender）
                                └──▶ 外部大模型（DeepSeek / 通义千问 / 可选境外），密钥仅在后端
```

浏览器不连接数据库，也不持有任何密钥。三维白模与预览渲染在浏览器中执行（这是可视化，不是业务逻辑）；渲染结果上传到后端保存。

## 2. 目录与模块边界

```text
apps/
  web/                React 前端
    src/app/          路由、布局壳、Provider
    src/api/          由 OpenAPI 生成的类型和请求客户端（唯一的数据通道）
    src/features/     projects / workbench（历史树、空间录入、方案生成、平面编辑）/
                      viewer-3d / cameras / renders / delivery / recognition / agent /
                      assets / settings
    src/components/   通用 UI
    src/styles/       沿用 tokens.css 的瑞士风格
  api/                Fastify 后端
    src/config/       环境变量（zod 校验，启动时失败即退出）
    src/plugins/      db、错误处理、安全头、限流、OpenAPI、存储、请求 ID
    src/modules/<领域>/  routes.ts / service.ts / repository.ts / schemas.ts / *.test.ts
    src/ai/           模型适配层、价格表、预算账本
packages/
  shared/             前后端共享：zod 校验规则、类型、纯函数领域逻辑
    src/schemas/      Space、Layout、Item、Camera、Project 导入导出、API DTO
    src/geometry/     多边形运算、碰撞、包含、间距
    src/planner/      4 策略自动排布、软硬约束、让步记录
    src/assets/       资产契约（刚体变换、禁止镜像拉伸、正面方向）
database/             Drizzle schema、SQL 迁移、种子与目录导入脚本
services/
  worker/             Python 任务执行器：本地识别（OCR+OpenCV）、PDF 合成、后期 Blender
docs/                 本文档、需求、数据模型、API 说明、ADR
legacy/demo/          旧版，功能对齐前并行保留
tools/  资源库/        原样保留；资源库 由 API 通过白名单读取
```

**依赖方向**：`web → shared`，`api → shared + database`，`database → shared`（仅类型）。`shared` 不依赖任何运行环境（无 DOM、无 Node API），保证前端即时校验与后端权威校验使用同一份代码。

`services/worker` 使用 Python，因为 PaddleOCR、OpenCV、Blender 只有 Python 生态成熟。它不直接对外提供接口，只从 `jobs` 表领取任务、写回结果。

## 3. 后端模块

| 模块 | 职责 |
|---|---|
| health | 数据库、存储、worker 心跳检查 |
| projects | 项目增删改查、软删除与恢复、乐观锁 |
| nodes | 历史节点树、隐藏/恢复、复制为分支 |
| drafts | 编辑草稿保存与冲突检测 |
| spaces | 空间校验（多边形闭合、自交、障碍物在内） |
| layouts | 4 策略生成、校验、让步说明 |
| cameras | 默认 8 视角生成、增删改 |
| renders | 渲染图上传、按节点与视角查询 |
| deliveries | 双 PDF 与归档目录生成（任务）、下载 |
| imports | 旧版项目 JSON v2 导入、项目导出 |
| uploads / recognition | 简图上传、识别任务、结果确认（第二期） |
| agent | 对话会话、工具调用、撤销（第三期） |
| ai | 模型列表、全站设置、预算查询 |
| assets / artworks | 模型库与灯箱画面（只读，画面可联网补充） |
| catalog | 门店、来源资料、案例、SI 标准（只读） |
| files | 按 ID 流式读取已登记文件 |
| jobs | 任务状态查询 |

统一错误格式：`{ "error": { "code", "message", "details"?, "requestId" } }`。所有写接口要求 `If-Match: <revision>`，冲突返回 409 并附当前版本信息。

## 4. 关键数据流

### 4.1 生成布局
1. 前端提交空间（或引用根节点）与参数 → `POST /layouts/generate`。
2. 后端用 `packages/shared/src/planner` 生成方案（尽量多放 / 按面积推荐 / 尽量少放；“参照相似门店”待清洗数据），每个方案附校验结果与让步说明；不落库。算法：识别可靠墙的轴向边，离主入口最远的为后墙；收银台靠后墙转角；后墙预留配件柜带；中岛桌在避开入口缓冲与主通道的区域按两个朝向试排（尽量多放取全部可行位置，其余策略取最均匀的若干个）；最后沿墙放配件柜并与中岛桌保持通道。旋转约定与旧版一致（90° 时正面 +Z 转向 −X）。
3. 用户选中一个 → `POST /projects/:id/nodes` 创建 plan 节点，后端再次校验。

### 4.2 编辑与白模
平面编辑或三维拖拽都修改同一份 Layout（草稿）。前端每次操作调用 `shared` 做即时校验；保存时后端权威校验。确认后创建 white 节点，后端生成默认 8 个相机。

网页工作台（`apps/web/src/features/workbench`）的草稿规则：停止操作 800 ms 后自动保存到项目唯一的共享草稿，同一时间只发一个请求，保存途中的修改留待下一次保存；版本冲突时停止自动保存，由用户载入最新草稿。草稿属于其他节点时，当前节点只读，需先“转到草稿”或丢弃草稿。“保存为新版本”创建 edit 节点，“确认白模”创建 white 节点（存在错误时不可确认），成功后删除草稿。选中的节点记录在地址栏 `?node=`，刷新后保持。

三维白模（`apps/web/src/features/viewer3d`，Three.js）与平面共用同一份布局：在三维中拖动道具即在地面平面上移动（10 mm 吸附），平面与三维随时切换。场景由 `packages/shared/src/scene` 的确定性几何生成：地面为空间多边形；入口与开放边不建墙；背向入口的墙为全高，其余墙截到 0.7 m 以便看清室内（与旧版一致）；中岛店不建墙；障碍物按多边形拉伸。模型按底部中心放在道具中心，旋转与旧版一致（90° 时正面 +Z 转向 −X），缺失或加载失败的模型以带轮廓的方框代替并提示。白模材质一律为哑光白：透明度 ≥ 0.4 的面板按实体显示，低于 0.4 的玻璃保持半透明且不投影；双面绘制并用平面着色，避免 SketchUp 导出的反面与反向法线造成破洞和发黑。视角缩略图用同一场景、同一渲染器按视角相机渲染，逐张渲染不阻塞页面。

历史树（`HistoryTree`）画成自上而下的树状图，位于编辑区上方、可收起：根节点为项目（深棕），一级为空间（深绿），其下的方案、编辑、白模为浅黄绿；父节点底部以细的深灰平滑曲线分叉、箭头指向子节点顶部，正中的子节点为直线；相邻叶节点上下错落；当前节点及其子节点用绿色虚线椭圆圈出。布局为整齐树（子树按需占宽、居中、连线不交叉），样式全部集中在 `tree-layout.ts` 的 `TREE_STYLE`（方向、颜色、尺寸、间距、曲线、箭头、虚线圈），以后调整格式只改这一处。

平面图（`PlanView`）按门店图纸样式绘制：墙体为边界外侧的斜交叉填充墙带（与三维白模同一组墙段，转角斜接，入口与开放边断开，中岛店不画墙），边界画红色租赁线，柱子同样填充；每条边外侧有尺寸链（在入口与开放边端点处分段，单位毫米）；道具用品类图库的 SVG 平面图按真实尺寸绘制并按模型正面方向与道具旋转对齐，没有平面图的画成方块（占位为虚线带叉）；标注名称与 H 高度；左下角标注面积与层高。SVG 符号以内联方式绘制以保持线宽，载入时只保留基本图形与绘图属性，不保留脚本、链接、样式或事件属性。

添加模型：按项目 SI 风格列出软装道具，信息化物料、品牌标识、非标陈列两种风格都列出，环境设施不列出；卡片显示品类图库中的效果图（缺少时显示 SketchUp 预览并标注）。没有网页模型的模型以真实尺寸的占位方框加入（平面与三维），有网页模型后无需改布局即可显示真实模型。项目页顶部可随时切换 SI 风格，只影响之后的自动排布和添加模型。挂墙类（广告机、LOGO 等）目前仍从地面起算高度，待增加安装高度后修正。

三维加载性能：原始网页模型多达 250 万面、35 MB，白模加载其轻量版（`网页模型/<资产>/white.glb`，全部 38 件合计约 3 MB）；每件模型的不透明部件与玻璃部件分别合并为一个网格并共用材质，一件道具只需一两次绘制；GLB 在 Web Worker 中解码；阴影只在场景内容变化时重算；三维代码在用户停留在平面时预先加载。

### 4.3 渲染
浏览器按节点的相机列表渲染白模图与材质图（同一场景、同一相机，只切换材质），逐张上传。后端记录布局签名与相机签名；布局或相机变化后旧图标记为过期，不覆盖。

### 4.4 交付
`POST /deliveries` 创建任务 → worker 读取冻结的节点、渲染图与平面，按双 PDF 规则生成两份 PDF 与目录结构 → 写入 `data/files/` 并复制到 `ARCHIVE_ROOT` → 前端下载 ZIP。归档目录同名时追加 `_修订02`，不覆盖旧版。

### 4.5 识别（第二期）
上传 → 创建识别任务 → worker 本地识别 → 不合格时 api 调用所选大模型 → 结果存为识别草稿（带置信度）→ 前端重绘带尺寸的平面供校对 → 确认后生成根节点。

### 4.6 Agent（第三期）
前端发送消息与平面截图 → api 组织上下文并调用模型 → 模型请求工具 → api 执行工具（复用各模块的 service，与人工操作走同一校验）→ 每次修改生成新节点并记录 `agent_actions` → 结果流式返回。撤销即切回上一节点。

## 5. AI 适配层

- 接口：`chat(messages, tools, images)`，各厂商实现一个适配器；DeepSeek 与通义千问均使用其官方兼容接口。
- 模型清单与单价放在 `apps/api/src/ai/models.json`（随代码版本管理，价格变化时修改）；密钥来自环境变量。未配置密钥或未开启开关的模型不出现在前端列表。
- 每次调用前检查当日预算余额，调用后按实际 token 记账；超额返回 `402 BUDGET_EXCEEDED`。

## 6. 安全

- CORS 只放行前端来源；安全响应头；生产环境不返回堆栈。
- 请求体：JSON 5MB；上传 20MB；渲染图单张 10MB。
- 写接口与 AI 接口限流。
- 文件只能按登记过的 ID 读取，路径经过 realpath 校验，不能越出存储根目录（沿用旧版白名单做法）。
- 目录数据（模型库、门店资料、SI 标准）无写接口，只能命令行导入。
- 当前无登录，所有接口公开；这是开发期的已知限制，部署前必须加入用户系统（见需求第 13 节）。

## 7. 配置

全部通过环境变量提供，仓库只提交 `.env.example`：

| 变量 | 用途 |
|---|---|
| `DATABASE_URL` | PostgreSQL 连接 |
| `API_PORT`、`WEB_ORIGIN` | 服务端口与允许的前端来源 |
| `STORAGE_ROOT`、`RESOURCE_ROOT`、`ARCHIVE_ROOT` | 文件存储、资源库、交付归档目录 |
| `DEEPSEEK_API_KEY`、`DASHSCOPE_API_KEY` | 国内模型密钥 |
| `ENABLE_OVERSEAS_MODELS`、`ANTHROPIC_API_KEY` | 境外模型开关与密钥（默认关闭） |
| `AI_DAILY_BUDGET_CNY` | 每日预算，默认 50 |

## 8. 技术决定

| 决定 | 理由 |
|---|---|
| Fastify + zod + fastify-type-provider-zod | 校验规则与 OpenAPI 同源，减少重复定义 |
| Drizzle | SQL 优先，迁移为可读 SQL，放在 `database/` |
| 布局存 JSONB，不拆道具表 | 历史快照不可变、整体读写、兼容旧项目 JSON；以后需要统计再加派生表 |
| 渲染在浏览器 | 无需 GPU 服务器即可上线；Blender 在第四期作为 worker 任务加入 |
| 任务队列用 PostgreSQL 表 | 3 人规模不需要 Redis；`SELECT … FOR UPDATE SKIP LOCKED` 领取任务 |
| Python worker 独立 | OCR、OpenCV、Blender 依赖 Python；与 Node 服务解耦 |
| PDF 由 worker 用无头 Chromium 将 HTML 打印为 PDF | 中文排版可控，两份 PDF 共用同一模板与图片 |
| Node 24 直接运行 TypeScript（类型擦除），不设构建步骤 | 后端与脚本无需编译产物；`tsc` 只做类型检查。代码限定为可擦除语法（`erasableSyntaxOnly`），导入写 `.ts` 扩展名 |
| 开发与测试默认使用 PGlite | 本机未安装 PostgreSQL 也能开发；PGlite 是编译为 WebAssembly 的 PostgreSQL 17，迁移文件与正式库完全相同。部署时 `DATABASE_URL` 改为 `postgres://` |
| TypeScript 固定 6.0.x | typescript-eslint 8 尚不支持 TypeScript 7 |

## 9. 用户系统扩展点

当前不做登录，但以下位置已为接入用户系统预留，接入时不需要改动业务模块的函数签名：

| 位置 | 现在 | 接入后 |
|---|---|---|
| `apps/api/src/context/actor.ts` 的 `resolveActor` | 每个请求都是 `{ kind: 'visitor' }` | 校验会话或令牌，返回 `{ kind: 'user', userId }` |
| `apps/api/src/context/policy.ts` 的 `authorize` | 全部放行 | 按项目归属判断，不满足时抛 `FORBIDDEN` |
| 服务层 | 每个服务函数接收 `RequestContext`，读写前先调用 `authorize` | 不变 |
| `audit_events.actor_kind` | 记录 `visitor` | 记录 `user`，并通过迁移增加操作人字段 |
| `projects` 表 | 无归属字段 | 迁移增加归属字段并回填 |
| `app_settings` | 全站设置 | 新增 `user_settings` 覆盖全站默认值 |

请求体使用严格校验（拒绝未知字段），因此客户端无法自行传入归属或用户编号。

## 10. 本地开发

见根目录 [README](../README.md) 的“重构版开发”一节。CI（`.github/workflows/ci.yml`）依次执行 lint、格式检查、类型检查、测试、OpenAPI 一致性检查与前端构建。
