# 影石门店空间设计工作台

用于门店平面调整、三维预览和多角度概念效果图。界面采用瑞士风格：黑白灰、清晰网格、左对齐排版；SI1.0／SI2.0 是门店设计标准，模型的真实材质独立于网页主题。

## 日常入口

- [多电脑同步与协作](docs/sync-and-collaboration.md)：本轮合并后的另一台电脑更新步骤、分支与LFS文件协作。
- [启动与使用](demo/README.md)：固定本机地址、备份、平面编辑、效果输出。
- [文档导航](docs/README.md)：当前说明、模型资料与历史记录。
- [实际架构](docs/architecture.md)：前端、本地文件服务、离线工具与数据边界。
- [界面规范](docs/design-system.md)：颜色、字体、网格、交互与维护入口。
- [整理记录](docs/maintenance-20261004.md)：本轮调整、保留理由及删除清单。

## 重构版开发（进行中）

新版采用 pnpm Monorepo：`apps/web`（React + Vite）、`apps/api`（Fastify）、`packages/shared`（共享校验与几何）、`database`（Drizzle schema 与 SQL 迁移）。需求、架构与数据表见 [需求确认](docs/requirements.md)、[架构](docs/architecture.md)、[数据模型](docs/data-model.md)、[API 说明](docs/api.md)。下文“本机运行”仍是旧版 `demo/` 的用法，新版功能对齐前两者并行。

**环境**：Node.js 24 及以上。pnpm 通过 Node 自带的 corepack 提供，首次执行一次 `corepack enable pnpm`（无管理员权限时用 `corepack enable --install-directory "$env:APPDATA\npm" pnpm`）。

```powershell
pnpm install                # 安装依赖
copy .env.example .env      # 首次：复制环境变量模板，按需填写（.env 不提交）
pnpm db:migrate             # 初始化 / 升级数据库
pnpm catalog:import         # 从资源库导入模型目录（需先 git lfs pull 网页模型）
pnpm dev                    # 同时启动 API（127.0.0.1:3001）和网页（127.0.0.1:5173）
```

- 网页：<http://127.0.0.1:5173/>；API 文档：<http://127.0.0.1:3001/api/docs>。
- 数据库：默认 `DATABASE_URL=pglite://./data/pglite`，是嵌入式 PostgreSQL，无需安装，数据在 `data/`（不提交）。部署时改为 `postgres://用户:密码@主机:5432/库名`，再执行 `pnpm db:migrate`。
- 修改表结构：编辑 `database/schema/` 后执行 `pnpm db:generate` 生成迁移 SQL，检查后提交，再 `pnpm db:migrate`。
- 修改接口：执行 `pnpm api:openapi`，重新导出 OpenAPI 文档并生成前端类型。

| 命令 | 作用 |
|---|---|
| `pnpm test` | 全部单元与集成测试（API 测试使用内存数据库） |
| `pnpm typecheck` | 严格模式类型检查 |
| `pnpm lint` / `pnpm format` | 代码检查 / 统一格式 |
| `pnpm check` | lint + 类型检查 + 测试，提交前执行 |
| `pnpm build` | 构建网页（`apps/web/dist`） |

部署（第一阶段）：准备 PostgreSQL 16+，设置 `.env` 中的 `DATABASE_URL`、`NODE_ENV=production`、`WEB_ORIGIN`，执行 `pnpm install --frozen-lockfile && pnpm db:migrate && pnpm build`，用 `pnpm --filter @store/api start` 启动 API，网页 `dist` 由反向代理托管，并把 `/api` 转发到 API。**当前没有登录，只能部署在受信任的内网**，上线前须接入用户系统（见[架构第 9 节](docs/architecture.md)）。

已知提示：`openapi-typescript` 声明的 peer 依赖为 TypeScript 5，在本项目的 TypeScript 6 下实测生成正常，安装时的 peer 警告可以忽略。

## 当前能力

| 功能 | 当前状态 |
|---|---|
| 空间与平面 | 矩形空间、四方案比较、拖动／旋转／增删、碰撞和边界检查、历史分支 |
| 三维与效果 | 同一布局的白模与八视角概念渲染；可比较两套 SI 参考环境 |
| 模型库 | 90 个单件 SKP 与 271 张预览/图例图片已补齐，哈希校验通过 |
| 网页摆放资产 | 22 项 GLB 清单；本机缺少实体，补传前不能按清单数量计算可用模型 |
| SI 依据 | 新增两份 PDF 共 320 页；旧 360 页阅读记录另存。SI1.0 封面笔误已按用户确认更正 |
| 交付与恢复 | 平面 SVG／PNG、八视角 ZIP、项目 JSON 备份与导入；浏览器本地保存 |

实际门店边界、墙柱、入口及材质仍须按图核对。当前没有自动 PDF/CAD 户型还原、完整施工图、云同步或照片级渲染验收。

## 本机运行

在自己的仓库根目录执行。首次安装依赖后构建并启动：

```powershell
cd demo
npm.cmd ci
npm.cmd run build
npm.cmd run preview -- --host 127.0.0.1 --port 64071 --strictPort
```

工作台：<http://127.0.0.1:64071/>；模型库：<http://127.0.0.1:64071/model-library/>。日常沿用这个地址，浏览器项目按主机和端口隔离；换地址或换电脑前导出项目 JSON。

原始门店 PDF 保存在 `资源库/01_各门店原图纸/`，工具默认读取此目录；可用 `resources.local.json` 显式覆盖来源。正式 PDF、PPTX、SKP、GLB 等通过 Git LFS 跟踪，需提交实际文件后才能跨电脑同步。`dist` 只是网页构建，仍需本地文件服务和素材目录。

## 资源库（2026-10-09）

详见[资源入口与实际可用状态](资源库/00_资源索引/资源使用说明.md)、[模型查找和补传](资源库/00_资源索引/道具文件查找与补传.md)、[切分及训练标注方法](资源库/06_生成流程文档/02_平面图与效果图提取.md)。

```text
资源库/
├─00_资源索引/
├─01_各门店原图纸/
├─02_各门店平面图/
├─03_各门店效果图/
├─04_软装道具模型/
├─05_店铺形象设计标准/
├─06_生成流程文档/
├─90_处理过程与审核/
└─99_历史归档/
```

每店平面与效果 PDF 目录已建立，尚未批量生成；候选页须核对门店、版本和用途。418份原始PDF已恢复到01目录并逐份核对SHA-256，外部原件仍保留。
