# 影石门店空间设计工作台

用于门店空间录入（手动或上传简图识别）、自动排布、平面编辑、三维效果、多视角渲染、双 PDF 交付和展陈方案，并带设计助理（工具调用）。界面采用影石品牌风格（见界面规范）；SI1.0／SI2.0 是《店铺形象设计标准》，模型的真实材质独立于网页主题。

## 入口

- [协作看板](docs/collab-board.md)：Claude 与 Codex 并行开发的分工、登记、热点文件和待决问题，开工前先读、收工前更新。
- [文档导航与阅读地图](docs/README.md)：先读哪些、哪些不用读。
- [架构](docs/architecture.md)、[需求与决策记录](docs/requirements.md)、[数据模型](docs/data-model.md)、[API 说明](docs/api.md)、[界面规范](docs/design-system.md)。
- [多电脑同步与协作](docs/sync-and-collaboration.md)：分支、LFS 与资源提交。
- [OneDrive 资源库接入](docs/onedrive-resources.md)：从 GitHub 获取代码后，在每台电脑连接本机同步的资源库。
- [资源使用说明](资源库/00_资源索引/资源使用说明.md)、[模型库指引](资源库/04_模型库/README.md)。

代码是 pnpm Monorepo：`apps/web`（React + Vite + Three.js）、`apps/api`（Fastify）、`packages/shared`（共享校验、规划器与几何）、`database`（Drizzle schema 与 SQL 迁移）。第一代静态网页 `demo/` 已于 2026-10-13 归档（见 [docs/archive/INDEX.md](docs/archive/INDEX.md)），其中的 SketchUp → GLB 转换工具移到了 [tools/su-convert](tools/su-convert/README.md)。

## 本机开发

**环境**：Node.js 24 及以上。pnpm 通过 Node 自带的 corepack 提供，首次执行一次 `corepack enable pnpm`（无管理员权限时用 `corepack enable --install-directory "$env:APPDATA\npm" pnpm`）。

```powershell
pnpm install                # 安装依赖
copy .env.example .env      # 首次：复制环境变量模板，按需填写（.env 不提交）
pnpm db:migrate             # 初始化 / 升级数据库
pnpm library:refresh        # 模型库补充效果图或平面图后刷新清单与对应关系（见 资源库/04_模型库/README.md）
pnpm library:apply-table    # 回读用户改过的 资源库/模型选用表.xlsx（改名、停用、意见），再 pnpm library:table 重新生成
pnpm catalog:white          # 生成白模轻量版（已是最新的会跳过；网页模型更新后重跑）
pnpm catalog:finish         # 生成材质轻量版（三维材质视图与渲染用，不入库，每台机器/服务器各生成一次；之后再跑 pnpm catalog:import 挂接）
pnpm catalog:import         # 从资源库导入模型目录（先按 docs/onedrive-resources.md 接入 OneDrive）
pnpm display:import          # 导入展陈规则（资源库/10_产品与陈列/展陈规则.xlsx 更新后重跑）
pnpm display:bodies          # 模型库里中岛桌、带托盘边柜更新后，重新生成展陈三维用的真实桌体（写进资源库，属于资源发布，由资源发布负责人运行）
# 本地识别回归（apps/web 下）：node src/scripts/local-regression.ts <图纸 PDF 目录> --limit 15 --pages 6
pnpm dev                    # 同时启动 API（127.0.0.1:3001）和网页（127.0.0.1:5173）
```

- 网页：<http://127.0.0.1:5173/>；API 文档：<http://127.0.0.1:3001/api/docs>。
- 数据库：默认 `DATABASE_URL=pglite://./data/pglite`，是嵌入式 PostgreSQL，无需安装，数据在 `data/`（不提交）。PGlite 只允许一个进程打开：迁移或导入目录前先停掉 `pnpm dev`。部署时改为 `postgres://用户:密码@主机:5432/库名`，再执行 `pnpm db:migrate`。
- 修改表结构：编辑 `database/schema/` 后执行 `pnpm db:generate` 生成迁移 SQL，检查后提交，再 `pnpm db:migrate`。
- 修改接口或 shared 中的 schema：执行 `pnpm api:openapi`，重新导出 OpenAPI 文档并生成前端类型（CI 会检查两者与代码一致）。

| 命令 | 作用 |
|---|---|
| `pnpm test` | 全部单元与集成测试（API 测试使用内存数据库） |
| `pnpm typecheck` | 严格模式类型检查 |
| `pnpm lint` / `pnpm format` / `pnpm format:check` | 代码检查 / 统一格式 / 格式检查 |
| `pnpm check` | lint + 类型检查 + 测试（不含格式检查），提交前执行 |
| `pnpm build` | 构建网页（`apps/web/dist`） |

新建工作区按[协作看板](docs/collab-board.md)第 5 节：每个任务一个 worktree 和带 `claude/` 或 `codex/` 前缀的分支，建好后运行 `tools/connect-onedrive-resources.ps1` 接入资源库。main 已没有 LFS 管理的文件，检出很快；GitHub 的 LFS 额度已用完，不要把 PDF、GLB 等 LFS 类型的文件提交进 Git（见看板第 7 节）。

部署（第一阶段）：准备 PostgreSQL 16+，设置 `.env` 中的 `DATABASE_URL`、`NODE_ENV=production`、`WEB_ORIGIN`，执行 `pnpm install --frozen-lockfile && pnpm db:migrate && pnpm build`，用 `pnpm --filter @store/api start` 启动 API，网页 `dist` 由反向代理托管，并把 `/api` 转发到 API。**当前没有登录，只能部署在受信任的内网**，上线前须接入用户系统（见[架构第 9 节](docs/architecture.md)）。

已知提示：`openapi-typescript` 声明的 peer 依赖为 TypeScript 5，在本项目的 TypeScript 6 下实测生成正常，安装时的 peer 警告可以忽略。

## 当前能力

| 功能 | 状态 |
|---|---|
| 项目 | 列表、导入导出（含旧版项目 JSON v2）、SI 风格与市场切换 |
| 空间 | 多边形空间（含异形店）、入口与开放边、障碍物；上传简图识别（矢量 PDF 本地识别；图片与扫描件可选云端视觉模型，默认关闭）后校对生成 |
| 方案 | 三种策略自动排布、平面编辑（吸附、撤销重做、任意角度旋转）、墙面与吊顶构件（LOGO、画面、灯箱墙贴，带安装高度）、空心隔板、碰撞与边界检查、按阶段分层的历史树 |
| 三维效果 | 白模 / 材质外观切换、三维拖拽、默认 8 视角与增删 |
| 渲染与交付 | 浏览器按视角渲染材质图（过期检测）；双 PDF、交付目录 ZIP 与归档 |
| 展陈方案 | 按《展陈指引》为中岛桌、带托盘边柜生成陈列，三维桌体预览，导出可编辑 PPT；入口在渲染阶段的“展陈”页签和首页的“展陈方案” |
| 设计助理 | 对话 + 工具调用（放置、移动、生成方案、改空间、视角等），可撤销 |
| 模型库 | 目录以 `资源库/04_模型库/manifest.json` 为准（2026-11-03：91 项，模型库里有 64 个网页模型 `model.glb`）；名称与停用以 `资源库/模型选用表.xlsx` 为准 |

尚未具备：用户登录；Blender 正式渲染与 AI 增强图。

## 资源库

```text
资源库/
├─00_资源索引/            资源入口与历史索引
├─01_各门店原图纸/        门店原始 PDF
├─02_各门店平面图/、03_各门店效果图/
├─04_模型库/              模型目录（manifest.json 为唯一索引）
├─05_店铺形象设计标准/    SI1.0／SI2.0 手册
├─06_生成流程文档/、07_平面简图/、08-skill/（双 PDF 交付规则来源）
├─09_门店档案/            门店档案（含 45 家金标准）
├─10_产品与陈列/          展陈规则.xlsx、托盘照片、指引原图与展陈桌体
├─11_logo/                品牌与联名 LOGO 源文件
├─90_处理过程与审核/      清洗与审核过程数据
└─99_历史归档/
```

原始 PDF、PPTX、SKP、GLB 等资源通过 OneDrive 同步；Git 保存代码和少量测试样本。每台电脑先按 [OneDrive 资源库接入](docs/onedrive-resources.md) 建立本机连接，再运行模型入库。
