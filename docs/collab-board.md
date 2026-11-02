# AI 协作看板（Claude + Codex 并行开发）

> 两个 AI 同时在本仓库工作。**开工前先读本文件，收工前更新本文件。** 它是唯一的协调中心，替代之前由秘书窗口口头传达的方式。
> 只写现在有效的信息，过期条目及时删除。背景、环境与坑见 [交接说明](handover-codex-20261019.md)；资源库规则见 [OneDrive 资源库接入](onedrive-resources.md)；提交与历史保护见根目录 AGENTS.md。
> 创建：2026-11-02（Claude 起草，Claude 与 Codex 共同维护）。

## 1. 当前快照（每次收工时更新）

| 项目 | 状态 |
|---|---|
| main | `2156a485`（PR #167） |
| 开放 PR | #156 识别：校验边界闭合候选并减少家具假凹口（草稿，Codex） |
| 任务清单 | GitHub Issues #137–#152（模型补齐、S2 单凳、识别、UI 细修、展陈本地识别、金标准修订审核页复查），以 Issue 状态为准，本文件不重复 |
| 下一个迁移编号 | `0017`（已用到 0016） |
| 资源版本 | 模型 `models-20261030-12`，展陈 `display-20261030-rev4095`（见 `resources.lock.json`） |
| 资源发布负责人 | Codex（10-30 起实际承担，待用户确认，见 Q2） |
| 主工作区 | `D:\text demo`：用户的网页 5173、接口 3001 在这里运行，AI 不在这里切分支或提交 |

## 2. 默认分工（用户可随时调整，见 Q1）

按“谁正在做、谁需要和用户多轮确认”划分，不按时间划分。

| 区域 | 目录 / 文件 | 默认主责 | 依据 |
|---|---|---|---|
| 识别 | `apps/api/src/modules/recognition/`、`apps/web/src/features/recognition/`、`tools/recognition/`、`docs/recognition-*` | Codex | #156 进行中；Issues #139–#141 |
| 模型库与资源发布 | `资源库/04_模型库`、`tools/su-convert/`、`tools/connect-onedrive-resources.ps1`、`resources.lock.json`、`catalog:*` 与 `display:bodies` 脚本 | Codex | 10-30 资源发布；Issues #137、#138 |
| UI 细修 | `apps/web/src/styles/`，各 features 的样式与布局 | Codex | Issues #142–#149 |
| 排布与规划 | `packages/shared/src/planner/`、`apps/api/src/modules/layouts/`、`apps/api/src/modules/agent/` | Claude | 规则类，需要和用户多轮确认 |
| 金标准与门店档案 | `tools/store-archive/`、`docs/store-drawing-archive-plan.md`、门店档案 | Claude | 45 家金标准的画法规则由 Claude 窗口建立 |
| 编辑器新功能与几何 | `apps/web/src/features/workbench/`（不含样式）、`features/viewer3d/`、`packages/shared/src/{mounting,geometry}/` | Claude | 与 UI 细修同目录，热点文件先登记（第 4 节） |
| 展陈 | `packages/shared/src/display/`、`apps/api/src/modules/displays/`、`apps/web/src/features/display/` | 共同，先登记 | Codex 近期合并 #159；Issues #151、#152 |
| 交付导出 | `apps/api/src/modules/deliveries/`、`packages/shared/src/delivery/`、`plan-export.ts` | 共同，先登记 | UI 细修 #143 会碰前端部分 |
| 数据结构与迁移 | `packages/shared/src/schemas/`、`database/migrations/` | 谁需要谁登记 | 见第 5 节第 5 条 |

## 3. 进行中的工作（开工前登记，完成后删除该行）

| 日期 | 谁 | 分支 / PR | 目的 | 触及的共用文件 | 占用迁移号 | 状态 |
|---|---|---|---|---|---|---|
| 2026-11-02 | Codex | `codex/collab-board-20261102` | 接入并行协作规则，核对认领和收工记录 | 仅 `docs/collab-board.md`；不占用第 4 节业务热点 | 无 | 登记后进行看板维护 |
| 2026-11-02 | Codex | `feat/recognition-openings` / #156 | 识别：校验边界闭合候选、减少家具假凹口，48 家开发集复评 | 无（限 recognition、tools/recognition、docs/recognition-*） | 无 | 草稿评审中 |

## 4. 共用热点文件（改动前必须在第 3 节登记）

同一时间只有一方登记；对方当天不改同一文件，需要时在第 6 节提问或等待合并。

- 工作台与编辑器：`apps/web/src/features/workbench/{Workbench.tsx,PlanEditor.tsx,PlanView.tsx,editor-state.ts,plan-export.ts}`、`workbench/plan-editor/{PropertiesPanel.tsx,usePlanDrag.ts,useNodeActions.ts}`、`apps/web/src/features/viewer3d/white-scene.ts`
- 共用几何与结构：`packages/shared/src/schemas/layout.ts`、`packages/shared/src/mounting/index.ts`
- 交付：`apps/api/src/modules/deliveries/{service.ts,pdf.ts}`
- 样式入口：`apps/web/src/styles/{tokens,app,workbench,display}.css`
- 依赖与迁移：`package.json`、`pnpm-lock.yaml`、`database/migrations/meta/_journal.json`
- 资源锁：`resources.lock.json`
- 生成文件（不手工合并）：`apps/api/openapi.json`、`apps/web/src/api/schema.d.ts`

## 5. 协作规则

1. **开工与收工。** 开工前 `git fetch`，读本文件和未关闭的 Issue，在第 3 节登记任务；登记后才动共用文件。收工前推送分支、更新第 1、3 节、清掉自己的未提交改动，并在第 8 节记一行。
2. **分支与工作区。** 新分支加 AI 前缀：`claude/<主题>`、`codex/<主题>`（已有分支名不改）。每个任务一个 worktree：`git worktree add "D:/text demo-worktrees/<名>" -b <分支> origin/main`，随后在该 worktree 运行 `powershell -NoProfile -ExecutionPolicy Bypass -File tools/connect-onedrive-resources.ps1`。不在主工作区切分支或提交；合并后可用 `git merge --ff-only origin/main` 同步主工作区。
3. **提交与 PR。** 遵守 AGENTS.md：标题“类型(范围)：具体改动”，标题、正文、合并说明用简体中文。提交 PR 前本地跑 `pnpm check` 和 `pnpm format:check`（与 CI 一致）。一个功能一个分支一个 PR，不顺带提交别人的改动或无关文件。
4. **合并。** 各自合并自己的 PR。条件：CI 通过；改动只在认领目录或已登记的共用文件内；正文写清改动、原因、验证方法和已知限制。草稿 PR 不合并。冲突由后合并者把最新 main 合入自己的分支后解决并重跑 CI，不 rebase、不强推已推送分支。生成文件冲突时合并 main 后运行 `pnpm api:openapi` 重新生成，不手工合并。合并后更新第 1 节。
5. **数据库迁移编号。** 需要迁移的任务在第 3 节登记“占用 00NN”，生成迁移时使用该编号。两个 PR 撞号时，后合并者重新生成为下一个编号（含 `meta/_journal.json` 和 snapshot）。
6. **依赖变更。** `package.json`、`pnpm-lock.yaml` 的改动单独一个 PR，尽快合并并登记。对方合并后，继续工作前先把 main 合入并运行 `pnpm install`。
7. **资源库（OneDrive 共享目录）。** `资源库` 是各 worktree 共用的目录连接，任何一方写入，另一方立即可见，所以日常开发、测试、识别一律只读。转换产物（DAE、GLB）、缓存、截图、临时清单写到 worktree 之外的独立输出目录。需要新增或替换模型、展陈素材、`manifest.json` 时，交给资源发布负责人，按 [单机发布顺序](onedrive-resources.md) 发布并更新 `resources.lock.json`；依赖新资源的代码 PR 在资源发布并验证之后才合并。
8. **测试服务与进程。** 主工作区的 5173/3001 只给用户使用。AI 的测试服务用独立端口和独立的 PGlite 数据目录（不要指向主工作区的 `data/pglite`，进程被强杀会损坏数据库）：Claude 用 3010–3059 / 5180–5239，Codex 用 3060–3109 / 5240–5299。启动前用 `netstat` 确认端口空闲。只停自己启动的进程，并按进程树停：找到带 `--watch` 的 `pnpm --filter @store/api dev` 父进程再结束，只杀监听端口的子进程会被它重新拉起。任务结束时关掉自己的测试服务。依赖或迁移变化需要重启主工作区服务时，先告知用户。
9. **向用户提问。** 需要用户决定的问题写进第 6 节：编号、问题、选项、推荐、提出者、日期。用户答复后，提问者把结论移到第 7 节并按结论执行。可逆的工作不等答复，按推荐继续；不可逆的操作（删数据、改写历史、停用户正在用的服务）等答复。
10. **交叉评审（默认开启，见 Q5）。** 开 PR 后对方 AI 可审查并在 PR 评论里列出问题。只有正确性问题（逻辑会出错、数据可能损坏、违背已确认规则）算阻塞；风格和重构建议只记录，由 PR 作者决定。Claude 可用 `/code-review`。
11. **禁止事项。** 不强推、不改写已推送历史、不直接推 main（一律走 PR）；不提交 `.env`、密钥、个人路径或账号信息；不删除或改动对方的分支、worktree 和开放 PR；不把共用文件的改动混进无关的 PR。

## 6. 待用户决定的问题（不答复时按推荐执行，不可逆操作除外）

| 编号 | 问题 | 选项 | 推荐 | 提出者 / 日期 |
|---|---|---|---|---|
| Q1 | 第 2 节的目录分工是否按默认执行？ | A 按默认；B 调整（告知哪些目录换人） | A | Claude / 2026-11-02 |
| Q2 | 谁担任资源发布负责人（唯一有权写入共享 `资源库` 的人）？ | A Codex；B Claude；C 用户本人 | A（10-30 已实际承担） | Claude / 2026-11-02 |
| Q3 | `AGENTS.md`、`CLAUDE.md`、`.github/copilot-instructions.md` 目前是本机未入库文件，新建的 worktree、另一台电脑和 CI 里都没有它们，是否入库？此前有“不顺带提交这些文件”的约束，需要用户明确放开。 | A 入库（单独一个小 PR）；B 保持本地，每个 worktree 手工复制 | A | Claude / 2026-11-02 |
| Q4 | 金标准 3b（其余约 460 家门店全量结构化）由谁做、何时做？ | A 暂缓，等 #156 之后再定；B Claude；C Codex | A | Claude / 2026-11-02 |
| Q5 | 是否开启交叉评审（每个 PR 由对方 AI 审一遍）？ | A 开启；B 不开启 | A | Claude / 2026-11-02 |

## 7. 已决定

- 2026-11-02：用户决定 Claude 与 Codex 并行开发，以本看板协调。
- 2026-10-19 及之前的业务与规则决定见 [交接说明第 6 节](handover-codex-20261019.md)（云端识别默认关闭、柱与管井扣可用面积而后加构件只避让、坐凳按单件、后场只出平面与避让等）。

## 8. 变更记录

| 日期 | 谁 | 内容 |
|---|---|---|
| 2026-11-02 | Claude | 创建看板：快照、分工、登记表、热点文件、规则、5 个待决问题 |
