# 文档导航与阅读地图

更新：2026-10-13。本页是人和 AI 协作者的共同入口：先读什么、按任务读什么、哪些不用读。

## 1. 改代码前先读（约 2.5 万 token）

1. [architecture.md](architecture.md)：模块职责、数据流、各阶段的实际行为与实测数据。
2. [requirements.md](requirements.md)：需求与 §14 决策记录（最新决定以此为准）。
3. [data-model.md](data-model.md)：数据表与 JSONB 结构。
4. [api.md](api.md)：接口约定（字段细节以代码中的 zod schema 为准）。
5. [design-system.md](design-system.md)：界面样式入口（改界面时）。

规则：提交说明与 PR 用简体中文（见主工作区的 AGENTS.md）；改了路由或 shared schema 要跑 `pnpm api:openapi`；提交前跑 `pnpm check` 和 `pnpm format:check`。

## 2. 按任务找代码

| 任务 | 从这里开始 |
|---|---|
| 接口、校验、错误格式 | `apps/api/src/app.ts`、`apps/api/src/plugins/`、`packages/shared/src/schemas/` |
| 历史节点与阶段（空间 → 方案 → 三维效果 → 渲染） | `apps/api/src/modules/nodes/`、`apps/web/src/features/workbench/tree.ts` |
| 自动排布 | `packages/shared/src/planner/` |
| 平面编辑、草稿、撤销、吸附 | `apps/web/src/features/workbench/`（`PlanEditor.tsx`、`editor-state.ts`、`snap.ts`） |
| 三维与渲染外观 | `apps/web/src/features/viewer3d/`（`white-scene.ts`、`render-look.ts`） |
| 模型目录、白模与材质轻量版 | `apps/api/src/modules/assets/`、`资源库/04_模型库/manifest.json`、`tools/library/` |
| 简图识别 | `apps/api/src/modules/recognition/`、`apps/web/src/features/recognition/` |
| 设计助理 | `apps/api/src/modules/agent/`、`apps/api/src/ai/`、`apps/web/src/features/agent/` |
| 交付 PDF | `apps/api/src/modules/deliveries/`、`packages/shared/src/delivery/` |
| 数据表与迁移 | `database/schema/`、`database/migrations/*.sql` |

## 3. 不用读（搜索默认跳过）

仓库根目录的 `.ignore` 让基于 ripgrep 的搜索（Claude Code 的 Grep、VS Code 搜索等）默认跳过下列内容；需要时显式指定路径即可搜索。

| 内容 | 原因 | 需要信息时改看 |
|---|---|---|
| `apps/api/openapi.json`、`apps/web/src/api/schema.d.ts` | 生成物（约 2.7 万行） | `packages/shared/src/schemas/`、各模块 `routes.ts` |
| `database/migrations/meta/` | drizzle 快照（每份约 2000 行） | `database/schema/` |
| `资源库/90_处理过程与审核/`、`资源库/00_资源索引/历史目录/`、`资源库/01_各门店原图纸/`、`资源库/09_门店档案/`、`资源库/99_历史归档/`、`tools/data-cleaning/` | 数据与过程记录，文本合计约 4000 万 token，代码不引用 | [store-drawing-archive-plan.md](store-drawing-archive-plan.md)、[资源使用说明](../资源库/00_资源索引/资源使用说明.md) |
| `tmp/`、`output/`、`docs/archive/` | 历史中间件与归档 | — |

## 4. 专项文档

| 主题 | 文档 |
|---|---|
| 多电脑同步、分支与 LFS | [sync-and-collaboration.md](sync-and-collaboration.md) |
| 门店图纸整理（另一窗口负责） | [store-drawing-archive-plan.md](store-drawing-archive-plan.md) |
| 架构评审与清理计划 | [architecture-review-20261013.md](architecture-review-20261013.md) |
| SI 标准阅读与命名依据 | [si-standards-review-20261001.md](si-standards-review-20261001.md)、[模型库指引](../资源库/04_模型库/README.md) |
| PDF 清洗与来源 | [pdf-cleaning.md](pdf-cleaning.md)、[si-source-recovery.md](si-source-recovery.md)、[data-preparation-next-steps.md](data-preparation-next-steps.md) |
| 待收集资料 | [input-materials.md](input-materials.md) |

## 5. 历史记录

2026-09 至 10-04 的旧版（`demo/`）开发记录、训练实验和资料盘点已从 main 归档，清单与恢复命令见 [archive/INDEX.md](archive/INDEX.md)。仍原地保留的历史文档：[pdf-cleaning.md](pdf-cleaning.md)、[si-source-recovery.md](si-source-recovery.md)、[data-preparation-next-steps.md](data-preparation-next-steps.md)、[si-standards-review-20261001.md](si-standards-review-20261001.md)（有脚本引用）。

文件保留看实际引用、唯一性和可恢复性，不按目录名称或最后修改时间判断。
