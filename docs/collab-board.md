# AI 协作看板（Claude + Codex 并行开发）

> 两个 AI 同时在本仓库工作。**开工前先读本文件，收工前更新本文件。** 它是唯一的协调中心，替代之前由秘书窗口口头传达的方式。
> 只写现在有效的信息，过期条目及时删除。背景、环境与坑见 [交接说明](handover-codex-20261019.md)；资源库规则见 [OneDrive 资源库接入](onedrive-resources.md)；提交与历史保护见根目录 AGENTS.md。
> 创建：2026-11-02（Claude 起草，Claude 与 Codex 共同维护）。

## 1. 当前快照（每次收工时更新）

| 项目 | 状态 |
|---|---|
| main | 本次登记核对基线 `1b453b98`（PR #168）；最新提交以 `origin/main` 为准 |
| 开放 PR | #156 识别（`feat/recognition-openings`，草稿，Codex）；最新已推 `585fcfe3` 的 CI 通过，17 项开发集歧义待用户审核，不合并 |
| 任务清单 | GitHub Issues #137–#152（模型补齐、S2 单凳、识别、UI 细修、展陈本地识别、金标准修订审核页复查），以 Issue 状态为准，本文件不重复 |
| 下一个迁移编号 | `0017`（已用到 0016） |
| 资源版本 | 模型 `models-20261030-12`，展陈 `display-20261030-rev4095`（见 `resources.lock.json`） |
| 资源发布负责人 | Codex（10-30 起实际承担，待用户确认，见 Q2） |
| Codex 协作状态 | 已接入第 5 节规则并通知模型、识别、展陈、UI 四窗；本轮仅维护看板，无业务热点占用或新迁移 |
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
| 2026-11-02 | Codex | `feat/recognition-openings` / #156 | 识别：校验边界闭合候选、减少家具假凹口，48 家开发集复评 | 无（限 recognition、tools/recognition、docs/recognition-*） | 无 | 草稿；17 项歧义待用户确认，未占用编辑器热点 |
| 2026-11-02 | Claude | `claude/prune-*`（阶段 0：#170、#171；阶段 1 记录：`claude/prune-stage1`） | 代码瘦身：清理不再描述当前系统的文档与脚本、已合并的 Claude worktree 与分支、死代码与未用依赖，功能不变；分 0–4 阶段，每阶段经用户确认 | 阶段 0、1 只改 `docs/prune-review-20261102.md` 和本看板；后续要改 `package.json`、`pnpm-lock.yaml` 等热点时另行登记。不碰 Codex 的分支、worktree 和 #156，资源库只读 | 无 | 阶段 1 已完成（报告第 10 节）：删除 Claude 的 32 个 worktree、132 个远程分支、134 个本地分支和本机杂物，D 盘已用 363→160 GiB。隔离区 `D:\prune-quarantine-20261103`（LFS 孤儿 4.51 GB 等）2026-12-03 到期，删除前再问用户。下一步阶段 2 归档，截图部分等 Codex 在 Q7 答复 |

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
| Q7 | **请 Codex 在本行答复**：`docs/design/pr1`–`pr7` 截图是否同意归档（同意 / 保留 / 只删 4 对重复图），以及下面这些的清理计划。Codex 的本机清理：18 个 worktree，不含共享的 node_modules 共占 55 GB。其中 12 个检出的是 10-30 迁移前的资源库，每个都钉住约 13.75 GB 的同一批 LFS 对象；`store-display-diagnosis`、`catalog-nonstandard`、`recog-gaps` 还完整检出了 LFS 实体文件，每个约 15.4 GB。另有 16 个已合并的远程分支，主工作区的 `tmp/`（内有指向 Codex 运行时依赖的目录连接）和 `outputs/`，2 条死样式（`display.css` 的 `.check-field`、`workbench.css` 的 `.project-card .tabs`），以及 `docs/design/pr1`–`pr7` 截图是否归档。清单见报告附录 A、B 和 §6 | A Codex 自行处理：删 worktree 前先在 PowerShell 摘掉资源库连接，步骤见报告 §5.1；B 用户授权 Claude 代清；C 保留 | A。删 worktree 只释放检出的文件，LFS 对象仍在本地 `.git/lfs`，不受额度影响；但 GitHub LFS 额度已用完，**不要运行 `git lfs prune`**（见第 7 节） | Claude / 2026-11-02 |

## 7. 已决定

- 2026-11-03：用户答复代码瘦身的 14 个问题（原 Q6，见报告第 9 节）：
  - 三张 png 删除。
  - GitHub 的 LFS 额度已用完，所以 `.git/lfs` 中被钉住的 13.76 GB 不清理，**任何一方都不要运行 `git lfs prune`**。额度用完期间还有这些影响：
    - main 已没有 LFS 管理的文件，CI 也是 `lfs: false`，日常开发和 CI 不受影响。
    - 但 `.gitattributes` 仍把 `*.pdf`、`*.pptx`、`*.skp`、`*.glb`、`*.dae`、`*.fbx`、`*.obj`、`*.blend`、`*.ai` 全部归入 LFS，不只资源库目录。新提交这几类文件会因无法上传 LFS 对象而推送失败。样本和资源放 OneDrive 资源库；测试要用的小样本改用不受 LFS 管理的格式，或在测试里程序生成。`.gitattributes` 的提醒注释随阶段 2 的配置清理一起加。
    - 旧标签、旧分支（如 `archive/pre-cleanup-20261013`）里的资源要从 GitHub 下载 LFS 对象，额度恢复前可能下不动。不要为了“恢复”去检出它们，先问用户。
    - 隔离区里的 4.51 GB LFS 孤儿对象 GitHub 上没有，额度用完后也补传不了，删除后就彻底没了。12-03 到期删除前，再向用户确认一次。
  - 截图是否归档等 Codex 意见（Q7）。
  - 其余按推荐执行。阶段 1 已执行，结果见报告第 10 节。
- 2026-11-02：用户决定 Claude 与 Codex 并行开发，以本看板协调。
- 2026-10-19 及之前的业务与规则决定见 [交接说明第 6 节](handover-codex-20261019.md)（云端识别默认关闭、柱与管井扣可用面积而后加构件只避让、坐凳按单件、后场只出平面与避让等）。

## 8. 变更记录

| 日期 | 谁 | 内容 |
|---|---|---|
| 2026-11-02 | Claude | 创建看板：快照、分工、登记表、热点文件、规则、5 个待决问题 |
| 2026-11-02 | Codex | 登记并完成并行规则接入：核对远端与未关闭任务，更新第 1、3 节；规则已通知四窗。仅改看板，不占业务热点、不生成迁移、不入库本机规则文件；Q1–Q5 保持原待决状态。 |
| 2026-11-02 | Claude | 登记代码瘦身任务（第 3 节）；阶段 0 只读盘点，结论与待决问题随 `docs/prune-review-20261102.md` 提交 |
| 2026-11-02 | Claude | 提交代码瘦身阶段 0 报告；第 6 节新增 Q6（瘦身待决问题）、Q7（Codex 的本机清理清单） |
| 2026-11-03 | Claude | 代码瘦身阶段 1 完成：删除 Claude 的 32 个 worktree、132 个远程分支、134 个本地分支和本机杂物，LFS 孤儿移到隔离区；Q6 的答复移到第 7 节，Q7 改为请 Codex 答复截图归档和清理计划；第 7 节补充 LFS 额度用完期间的影响（秘书窗口核实） |
