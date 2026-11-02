# 代码瘦身盘点（2026-11-02，阶段 0）

> **只读盘点。** 没有删除或改动任何代码、依赖、数据库、资源库、worktree、分支和 LFS 对象。写入只有三处：扫描工具和实验仓库放在仓库外的临时目录；看板登记（PR #170）；本报告。
>
> - 基线：`origin/main` `5b9f6385`（PR #170）。代码扫描时为 `3936b018`（PR #169），两者代码相同，#170 只改看板。
> - 体积口径：1 GB = 10⁹ 字节，按文件字节合计（`du` 按磁盘块统计会略大）。token 估算：中文 1 字约 1 token，其余按 UTF-8 每 4 字节约 1 token。
> - 本机路径写成环境变量形式：`%USERPROFILE%`、`%LOCALAPPDATA%`、`%TEMP%`；OneDrive 资源库为 `%OneDrive%\门店生成工作台\资源库`。
> - 怎么读：第 0 节是结论，第 9 节是需要用户决定的问题，附录是逐项清单、命令和恢复方式。

## 0. 结论摘要

1. **代码本体已经很干净，能删的代码很少。**
   - 未使用的 npm 依赖 0 个，运行时循环依赖 0 处，package.json 脚本断链 0 处，`tsc --noUnusedLocals --noUnusedParameters` 0 条。
   - 真正没人用的只有 3 处转发导出、2 条死样式（在 Codex 的样式区）、eslint 忽略列表里 2 个不存在的目录。
   - 字面重复 0.57%，与 10-13 的 0.58% 持平。“同一规则写了多份”仍有 6 类，属于重构，不建议在瘦身里做。
2. **体积大头在本机，不在仓库；最大的一块是 worktree。** D 盘共 574 GB，已用 363 GB。
   - **51 个 worktree 合计 297 GB。** 其中 16 个完整检出了迁移前资源库的 LFS 实体文件，每个约 15.4 GB，合计 247 GB。这些是各自独立的副本（硬链接数为 1），删 worktree 就能释放。其余多数只检出了 LFS 指针，资源库约 0.4 GB。
   - 其中 node_modules 统计为 27 GB，但它们是 pnpm 全局仓库的硬链接（全局仓库实际只有 823 MB），删除不释放，可释放量不算这部分。
   - 已跟踪文件只有 1016 个、31.4 MB。
   - `.git` 约 21 GB：LFS 18.27 GB，对象库 2.69 GB。
   - 主工作区里可清理的本机内容约 2.9 GB：两个 Python 环境 1.7 GB，10-09 的模型转换中间产物 0.95 GB。
3. **`.git/lfs` 不能当成可随时重新下载的缓存来清。**
   - 现在执行 prune 只会删 1157 个对象、4.51 GB。其中 1155 个是**从未提交过的孤儿**：不被任何分支、标签、提交或暂存区引用，GitHub 上也没有，删了无法找回。这 1155 个里有 957 个（4.39 GB）在资源发布记录中找不到相同的哈希。
   - 另外 13.76 GB 被保留。**45 个 worktree 所在的分支仍包含 10-30 迁移前的资源库（不论是否下载了实体文件），每一个都单独引用着这同一批对象**：Claude 33 个，Codex 12 个，后者包括 #156 正在用的 `recog-gaps`。近 10 天有提交、而且分支内容里仍有资源库的分支也会钉住它们。
   - 所以**只删 Claude 的旧 worktree，LFS 几乎不释放**（7 个对象）。要再释放 12.78 GB，需要三个条件：45 个全部清掉、#156 的分支合入 main 去掉资源库、等“近期”窗口过期。这 12.78 GB 已逐个在 GitHub 上确认存在。
   - 3 个标签引用的全部 LFS 对象都已在 GitHub 上确认存在（`archive/pre-cleanup-20261013` 为 1088 个、13.74 GB）。
   - 本地 prune 不会释放 GitHub 的 LFS 存储额度。清掉的对象以后要用时需要重新下载，会消耗下载额度。
4. **worktree 共 51 个**（不含主工作区和本次新建的 `prune`）。
   - 27 个是 Claude 的：PR 已合并、没有未提交改动和未推送提交，被忽略的内容只有依赖、构建产物、本地测试库和 `.env` 副本。**可以删，可释放约 177.5 GB。**
   - 6 个需要用户决定：金标准审核页、识别打分缓存、3 个没有 PR 的 Claude worktree、1 个已被取代的 PDF 补传分支。按推荐处理（保留金标准那个）可再释放约 33 GB。
   - 18 个属于 Codex（不含 node_modules 共 55 GB），不动，清单写进看板第 6 节。
5. **删除 worktree 的安全性已实测**（§5.1）。
   - 本机 Git 2.55 删除 worktree 时不会穿过目录连接删到目标目录。但它删不掉连接本身，会留下只剩连接的残留目录，并且照样报告成功。
   - Claude 的 worktree 里，“资源库”都是 10-30 迁移前检出的真实目录，没有指向 OneDrive 的连接；pnpm 的连接全部指向 worktree 内部。
   - 主工作区 `tmp/` 里有一个连接指向 Codex 运行时的依赖目录，清理前必须先摘掉。
6. **远程分支 150 个（不含 main）。**
   - Claude 已合并的 130 个可删。附录 B 附了每个分支的提交号，GitHub 的 PR 页面也能一键恢复。
   - 非 Claude 和 Codex 的已合并分支 16 个、快照分支 1 个、未合并分支 3 个，都不动。
7. **搜索工具不会穿过资源库连接。**
   - `.gitignore` 的 `/资源库/` 已整体排除。只有“跟随链接并且不遵守忽略文件”同时满足时才会扫进去。
   - `.ignore` 里 5 条资源库子目录规则其实多余；显式搜索 `资源库` 时这些规则也不生效。
8. **需要用户决定的问题见第 9 节，共 14 个。** 没回复的按推荐处理；删除未跟踪文件、清理 LFS、删除远程分支这类不可逆操作，一律等用户确认。

## 1. 基线测量

| 项目 | 数值 | 来源 |
|---|---|---|
| 已跟踪文件 | 1016 个、31.4 MB、约 50.4 万行 | `git ls-files` |
| apps / packages / database 源码 | 含测试 356 个文件、65,060 行；TS/TSX 不含测试 248 个、43,047 行 | jscpd 口径 |
| 生成物 | 22 个、2.79 MB、约 71.6 万 token：`openapi.json` 1.27 MB、`schema.d.ts` 384 KB、迁移 35 个 1.0 MB | 均已在 `.ignore` |
| docs | 78 个：md 31 个 343 KB，json 18 个 213 KB，png 29 个 4.66 MB（占 docs 体积的 89%） | |
| tools | 406 个：`data-cleaning` 333 个 8.25 MB（其中 json 218 个 7.0 MB），其余 73 个 0.40 MB | |
| output | 17 个、0.85 MB | |
| 直接依赖 | 57 条：根 10、api 23、web 18、shared 1、database 5，其中 workspace 内部引用 4 条；`tools/su-convert` 是独立 npm 包，另有 7 条 | 各 `package.json` |
| 锁文件 | 724 个包 | `pnpm-lock.yaml` |
| `.git` | LFS 18.27 GB（2294 个对象）；对象库 2.69 GB（3 个 pack，29,176 个对象）；worktree 元数据 0.04 GB | `git count-objects -vH`、文件字节合计 |
| 分支与标签 | 本地 157 个（含本次的 `claude/prune-register`），远程 151 个（含 main），标签 3 个，stash 0 个 | |
| worktree | 52 个：主工作区加 51 个（不含本次新建的 `prune`）。51 个合计 297 GB，不含共享的 node_modules 为 270 GB；其中 16 个完整检出了资源库的 LFS 实体文件（每个约 15.4 GB，合计 247 GB），其余多数只有 LFS 指针 | `git worktree list`、`du`（逐个见附录 A） |
| 开工必读上下文 | 约 3.7 万 token：规则与协调 0.84 万，入门文档 2.88 万（阅读地图写的是 2.5 万） | 见 §7 |
| 全仓搜索噪声（遵守 `.ignore` / 不遵守） | `layout` 1,009 行 124 KB / 1,818 行 335 KB；`资源库` 253 行 60 KB / 4,700 行 1.17 MB；`asset` 2,222 行 286 KB / 5,957 行 777 KB | ripgrep |

工具全部装在仓库外的 `%TEMP%\prune-tools`，没有改仓库依赖：knip 6.44.1、depcheck 1.4.7、jscpd 5.4.2、madge 8.0.0。本机 Git 2.55.0.windows.3、git-lfs 3.7.1。

## 2. 代码层（apps、packages、database）

### 2.1 检查结果

| 检查 | 结果 | 与 10-13 对比 |
|---|---|---|
| knip | 未使用文件 17 个（apps 3、tools 14），未使用导出 58、类型 13，重复导出 1，未使用依赖 1（误报），没有未声明或无法解析的依赖 | 10-13 无未使用依赖，34 个“仅本文件使用”的导出 |
| depcheck | 只报 `@fontsource-variable/inter`，它在 `apps/web/src/styles/tokens.css:7` 用 CSS `@import` 引入，是误报 | 同 |
| madge | 只看运行时：4 个 workspace 全部 0；含类型导入时 shared 有 6 处，回边全是 `import type` | 10-13 的 2 处已消除 |
| jscpd | 不含测试 0.57%（29 处，每处不超过 16 行）；含测试 1.04%（64 处） | 0.58% |
| `tsc --noUnusedLocals --noUnusedParameters` | 4 个 workspace 都是 0 条 | — |
| package.json 脚本 | 6 个 package.json 的脚本指向的文件全部存在 | — |
| 动态引用 | 只有 `RecognitionPanel.tsx:199,237` 两处 `await import('./pdf-extract.ts')`，字符串是静态的，knip 能解析 | — |

10-13 的代码层旧项大多已处理：3 个死 hook、`show3d`、2 处循环依赖、D1、D2、D5。findNode 从 4 份减到 2 份。未处理的有 D3、D4 的 `placeAlong`、D6、`signedArea` 两份、M6。

### 2.2 可删除的候选（阶段 3）

| 对象 | 证据 | 建议 | 风险 | 归属 |
|---|---|---|---|---|
| `apps/api/src/modules/files/routes.ts:15` 转发的 `versionedFileUrl` | 唯一使用方 `assets/service.ts` 已直接从 `lib/file-url.ts` 导入；`deliveries/service.ts:29` 只导入 `fileUrl` | 删转发中的这一项 | 低，tsc 兜底 | 基础设施 |
| `apps/api/src/modules/agent/tools.ts:16` 转发的 `spaceNodeOf` | 其他文件 0 引用 | 删转发中的这一项 | 低 | Claude（设计助理） |
| `apps/api/src/modules/displays/common.ts:175` 转发的 `storeTitle` | 3 个使用方都直接从 `@store/shared` 导入 | 删转发中的这一项 | 低 | 展陈（共同区，先登记） |
| `eslint.config.js` 忽略列表的 `legacy/**`、`素材库/**` | `legacy/` 从未存在；`素材库/` 在主工作区只剩空目录树 | 删这 2 行 | 无 | 根配置 |
| `apps/web/src/styles/display.css:98` `.check-field` | ts/tsx/html 中找不到；10-29 改版（c6393b15）后不再使用 | 交 Codex | 低 | UI 样式（Codex，热点文件） |
| `apps/web/src/styles/workbench.css:839` `.project-card .tabs` | 同上；10-19 左栏改版（625a6580）后不再使用 | 交 Codex | 低 | UI 样式（Codex，热点文件） |

### 2.3 保留（knip 报出但仍在使用）

| 对象 | 证据 | 归属 |
|---|---|---|
| `apps/web/src/scripts/local-regression.ts` | `README.md:30` 和 4 份文档里有运行命令；识别回归工具 | 识别（Codex） |
| `apps/web/src/scripts/build-logo-models.ts` | LOGO 网页模型（含徕卡 880）的生成源；`importer.ts:68` 注释引用 | 模型库 |
| `apps/api/src/scripts/verify-display-release.ts` | `docs/display-tray-reconciliation-20261030.md:58` 有命令；展陈发布核验 | 展陈（Codex 写的） |
| `tools/su-convert/` 下 7 个文件 | workspace 外的独立 npm 包，knip 读不到它自己的脚本和动态 import，误报 | Codex（模型库） |
| 39 个只被测试引用的导出 | 给单元测试用的纯函数 | — |
| `DisplayTaskExportRequestSchema` 重复导出 | 带注释的语义别名，`displays/routes.ts` 在用 | 展陈 |

### 2.4 记录但不建议在瘦身中处理

- **60 个“只在本文件使用”的导出**：去掉 `export` 不减少行数，其中一半以上在 Codex 区域或热点文件。分布：识别 13、展陈 8、模型库脚本 8、交付 1、编辑器与三维 21、设计助理 3、基础设施 13、tools 1。
- **重复实现 6 类**：
  - 正反两层面检测：`viewer3d/back-layers.ts` 与 `assets/finish-models.ts`，展陈桌体里还有第三份材质缓存。
  - polylabel：`agent/tools/walls.ts` 与 `shared/geometry/interior.ts`。
  - 有向面积：`viewer3d/scene-geometry.ts` 与 `shared/geometry/polygon.ts`。
  - 顶点上限 200：`agent/tools/space.ts` 与 `workbench/space-form.ts`。
  - findNode：`nodes/repository.ts` 与 `deliveries/service.ts`。
  - 多边形包围盒：内联写了十余处。
  这些都属于搬家或改逻辑，不是零风险删除。
- **依赖声明位置（10-13 M6）**：`@gltf-transform/*`、`meshoptimizer` 仍在 api 的 devDependencies 里。

## 3. 已跟踪的文档、tools、output 与根配置

### 3.1 docs（逐文件见附录 C）

| 分组 | 文件 | 引用证据 | 建议 | 风险 | 涉及 Codex |
|---|---|---|---|---|---|
| 入口与架构 | `README.md`（根）、`docs/README.md`、`architecture.md` | 被根 README、`.ignore` 等引用 | **保留并订正**（§3.5） | 订正只改文字，不影响功能 | architecture 共同 |
| 当前规格 | `requirements`、`data-model`、`api`、`design-system`、`display-plan-requirements` | 根 README、代码注释（`deliveries/service.ts`） | 保留 | — | 共同 |
| 协作 | `collab-board`、`handover-codex-20261019`、`onedrive-resources`、`sync-and-collaboration` | 看板、本机 AGENTS.md | 保留；sync 需订正 | sync 由 Codex 改过，订正前在看板说明 | 是 |
| 异形店方案 | `irregular-shop-plan`、`phase2`、`phase3` | plan 被 `shapes.fixture.ts:1`、`real-shapes.fixture.ts:1` 引用；phase3 被交接说明引用，识别仍在做 | 保留 | — | phase3 是 |
| 金标准 | `store-drawing-archive-plan`（63 KB） | `tools/store-archive`、`register_legacy.py`、`.gitignore`、看板 | 保留 | — | 否 |
| 被脚本登记的历史文档 | `pdf-cleaning`、`si-source-recovery`、`data-preparation-next-steps` | `register_legacy.py:56,62,63` | 保留（10-13 结论；新证据见下） | 归档后脚本仍能运行，但登记结果会变成“缺失” | 否 |
| 被生成页面链接 | `si-standards-review-20261001` | `refresh-library.mjs:239` 生成的 `模型目录.html` 链接它 | 保留 | 删除会让生成页面出现断链 | 否 |
| 10-30 的 Codex 记录 | `boundary-walls`、`lightbox-wall-art`、`display-tray-reconciliation`、`model-review` 及 `reviews/`、`resource-release` 及 `evidence/`、`model-publication/`（18 个）、`design/pr8-responsive` | 注释、README 互相引用；`resources.lock.json:207` 的 `releaseManifest` 字段（无代码读取） | 保留，补进阅读地图 | — | 是 |
| UI 改版截图 | `docs/design/pr1`–`pr7`，29 张、4.66 MB，其中 4 对完全相同（0.48 MB） | 只有交接说明第 66 行和 `pr8-responsive.md:5` 用文字提到；PR 正文只写了路径，没有嵌图 | 用户决定（第 9 节 Q9） | 低：归档后文中提到的路径失效，可从标签恢复 | 是（UI 归 Codex） |
| 评审与归档 | `architecture-review-20261013`、`archive/INDEX.md` | docs/README、requirements | 保留；INDEX 在阶段 2 追加 | — | 否 |

**新证据**：`register_legacy.py` 的 `measure()`（第 210–213 行）遇到不存在的路径只返回 `{"exists": False}`，不报错。所以它对 3 份历史文档、`tools/training`、`output/` 的引用只是“登记”依赖：这些文件删除后脚本照常运行，只是登记结果变成“缺失”。是否据此改变 10-13 的“保留”结论，由用户决定。本报告默认不推翻。

### 3.2 tools（逐文件见附录 D）

| 子目录 | 文件数 / 大小 | 入口证据 | 建议 | 风险 | 涉及 Codex |
|---|---|---|---|---|---|
| `connect-onedrive-resources.ps1` | 1 / 2.1 KB | 看板、onedrive 文档 | 保留 | — | 是 |
| `library/` | 5 / 36.7 KB | 根 package.json 的 `library:*` 3 条 | 保留；`cutout-photo.mjs` 零入口，10-13 建议归档但没执行，收益 7 KB，建议保留 | — | 模型库 |
| `resource-library/`、`resource_library.py` | 5 / 5.7 KB | `paths.mjs` 被 su-convert 4 个脚本导入；`resource_library.py` 被 training 2 处、data-cleaning 的 `pipeline.py`、`export_store_pdfs.py` 通过 `sys.path` 导入 | 保留（用户规定先问；证据不支持删除） | 删除会让 su-convert 无法运行 | 是 |
| `sketchup/` | 6 / 21.5 KB | su-convert/README 引用 `export_selected.rb`；`inspect_archive.py` 会写资源库 | 保留 | — | 模型库上游 |
| `store-archive/` | 19 / 144 KB | README 和金标准文档；内部导入齐全 | 保留 | — | 否（Claude） |
| `su-convert/` | 11 / 93 KB | 独立 npm 包，10-30 还在用 | 保留 | — | 是 |
| `training/` | 26 / 105 KB | `register_legacy.py:83` 登记；`pdf-cleaning.md`。`verify-report.mjs` 依赖已删除的 demo，`train-layout.mjs` 往 `demo/src/generated` 写文件，另有 8 个文件零引用 | 用户决定（Q9）；建议保留已跟踪文件，只清本机环境（§6） | 归档后登记结果变成“缺失”；收益只有 105 KB | 否 |
| `data-cleaning/` | 333 / 8.25 MB | **`tools/store-archive/build_sources.py:25,67` 直接读取 `light-handoff-20261009-01/history/00_同步与文件清单.json`，没有存在检查，缺文件就崩溃**；另被 `register_legacy.py`、`store-drawing-archive-plan` 引用 | **保留**（不能整体删；已在 `.ignore` 中） | 整体删除会让金标准工具链崩溃 | 早期工作 |

其他事实：
- CI 不引用 tools；根 package.json 只用到 `tools/library` 的 3 个脚本。
- apps、packages、database 不引用仓库根的 `tools/`，grep 命中的都是 `agent/tools/`。
- 会写资源库、与“资源库只读”冲突的脚本只应由资源发布负责人运行：`tools/sketchup/inspect_archive.py`、`tools/training/build-report.mjs`、store-archive 的脚本（默认 `--out` 是 `资源库/09_门店档案`）、`tools/library` 的 refresh 和 apply。

### 3.3 output（17 个，0.85 MB）

| 文件或目录 | 文件数 | 引用 | 建议 | 风险 |
|---|---|---|---|---|
| `图纸上传核对-20261008/GitHub实体可用图纸-358份.txt` | 1 | `register_legacy.py:66`、`store-drawing-archive-plan.md:493` | 保留 | — |
| `图纸上传核对-20261008/` 其余 | 5 | 无 | 用户决定（Q9） | 低：10-08 的上传核对记录，可从标签恢复 |
| `图纸补传核对-20261008/` | 5 | 无 | 同上 | 同上 |
| `图纸补传完成复核-20261008/` | 5 | 无 | 同上 | 同上 |
| `图纸核对记录索引-20261008.txt` | 1 | 无 | 同上 | 同上 |

`register_legacy.py` 引用的另一个路径 `output/pdf/cleaned-v2` 本来就不存在，10-13 登记时已是“缺失”。

### 3.4 根配置中的失效规则

| 文件 | 规则 | 现状 | 建议 |
|---|---|---|---|
| `.gitignore` | 第 59–60、72–74、78–79、83–93 行，共 18 条 `资源库/...` 子规则 | 被第 44 行 `/资源库/` 整体覆盖，从不生效 | 删除，行为不变（Q10）；`finish.glb` 的说明挪到 docs |
| `.gitignore` | 第 55–56 行 `output/maintenance/...` | 目录已归档 | 删除 |
| `.gitignore` | `/output/pdf/`、`.resource-before-link`、`tools/sketchup/exports` | 目录不存在，但能防误提交 | 保留 |
| `.gitattributes` | 18 条 `资源库/...` 规则 | 不作用于任何跟踪文件。但 `git checkout <旧标签> -- <路径>` 恢复单个文件时用的是**当前**属性 | **保留**，加一行注释说明 |
| `.gitattributes` | 9 条全局 LFS 规则、`tools/data-cleaning/** -text` | 有效 | 保留 |
| `eslint.config.js` | `legacy/**`、`素材库/**` | 见 §2.2 | 删除 |
| `eslint.config.js` | `demo/**`、`tmp/**` | 主工作区的 `demo/`、`tmp/` 删除前还用得着 | 保留 |
| `.ignore` | 第 12–16 行 5 条资源库子目录规则 | 被 `.gitignore` 的 `/资源库/` 覆盖，多余 | 改写说明；加入 `docs/evidence/`、`docs/model-publication/`、`docs/reviews/`，它们是“asset”等搜索词噪声最大的文件（Q10） |

### 3.5 入口文档失真（阶段 2 订正）

- `docs/README.md` 的阅读地图停在 10-13：没有看板、交接说明、OneDrive 接入、10-30 的 Codex 文档。
- `architecture.md`：“展陈”“OneDrive”“displays”出现次数都是 0；第 189 行指向根 README 里已不存在的“重构版开发”一节。
- 根 `README.md`：
  - “目录 90 项，38 项有网页模型”，现在是 91 件。
  - “01_各门店原图纸（LFS）”。
  - “display:bodies 结果提交进资源库”。
  - `GIT_LFS_SKIP_SMUDGE` 的提示，main 里已经没有 LFS 文件。
  - 没有看板入口。
- `sync-and-collaboration.md` 写着 `git switch -c work/…`，与看板第 5 节第 2 条冲突（Codex 10-29 改的）。
- `input-materials.md` 后半段停在 10-08。
- `tools/store-archive/README.md:18` 把 `D:\text demo` 写成了 “D:” + 制表符 + “ext demo”（`\t` 被转义）。

## 4. `.git` 与 Git LFS

### 4.1 演练结果

| 命令（在 `prune` worktree 中运行） | 结果 |
|---|---|
| `git lfs prune --dry-run --verbose` | `2294 local objects, 1137 retained`。在非终端下运行时，逐对象清单只输出了最后一个对象，也没有体积汇总，所以体积由下面的复算给出 |
| `git lfs prune --dry-run --verify-remote --verify-unreachable --verbose` | `2 verified with remote, 1155 not on remote`，随后列出 1155 个“远端没有”的对象并停止。默认 `--when-unverified=halt`，什么都不会删 |

### 4.2 1155 个“远端没有”的对象是什么

| 检查 | 结果 |
|---|---|
| 体积 | 4.51 GB |
| 是否被可达提交引用（所有分支、远程分支、标签、HEAD） | **0 个** |
| 是否被不可达提交引用（`git fsck --unreachable --no-reflogs` 找到 56 个，日期 09-24 至 10-19） | 0 个 |
| 是否在任一 worktree 的暂存区 | 0 个 |
| 对象库里有没有指向它们的 LFS 指针 | 1144 个有（都是不可达的游离 blob），11 个没有 |
| 类型（按文件头） | ZIP 2 个 1.76 GB、GLB 42 个 1.06 GB、PNG 1083 个 0.64 GB、SKP 1 个 0.61 GB、PDF 22 个 0.42 GB、JPEG 5 个 |
| 哈希能否在资源发布记录或模型库 `manifest.json` 中找到 | 198 个（0.12 GB）能找到，是已发布资源的副本；**957 个（4.39 GB）找不到** |

结论：这些对象是 `git add` 或 LFS 过滤器处理过、最终没有进入任何提交的内容，对 Git 已无用途，所以 GitHub 上没有也正常。git-lfs 默认不验证这类对象，加 `--verify-remote` 也会直接删除。它们多半是被放弃的中间版本，但无法证明其中没有某个文件的唯一副本，所以建议先移出仓库隔离一段时间，再删除（Q7）。

### 4.3 被保留的 13.76 GB 被谁钉住

按 git-lfs 3.7.1 的规则复算保留集，结果与演练完全一致（1137 个）。规则如下：
- 当前检出与所有 worktree 的检出；
- 近期分支：`fetchrecentrefsdays` 7 天加 `pruneoffsetdays` 3 天，即 10-23 之后有提交的本地和远程分支，共 37 个；
- 未推送提交新增的对象；
- stash（本仓库为 0）。

**标签不在保留范围内。**

逐个计算每个 worktree 的检出所引用的对象：45 个检出了迁移前资源库的 worktree，每个都引用 1088–1129 个对象、13.74–13.75 GB，几乎是同一批；`pdf-upload-20261008` 例外，为 418 个、8.46 GB。也就是说，任何一个旧 worktree 单独存在，都能钉住几乎全部 13.76 GB。

| 情形 | 可再释放 |
|---|---|
| 只删 Claude 可删的 30 个 worktree | 7 个对象，约 0 GB |
| Claude 的 33 个全删，并等近期窗口过期（最晚的 10-30 分支 + 10 天，约 11-09） | 仍约 0 GB：Codex 的 12 个旧 worktree 每个都引用同一批对象 |
| 45 个全删，而且近期窗口内没有仍含资源库的分支（#156 的 `feat/recognition-openings` 需先合入 main） | **1070 个、12.78 GB**，已用 LFS 批量接口逐个确认 GitHub 上都有 |
| 剩余 | 约 0.98 GB，基本是 `upload/pdfs-20261008` 未推送提交带入的 60 份 PDF（0.97 GB，见 §5.2）；删除该分支后也可释放 |

Codex 的 12 个旧 worktree 分两处：
- `%USERPROFILE%\Documents\Codex` 下 9 个：`boundary-walls`、`catalog-ads`、`catalog-availability`、`catalog-s2-stool`、`lightbox-wall-art`、`store-display-diagnosis`、`store-display-trays`、`store-ui-camera-tab`、`store-ui-render`；
- `D:\text demo-worktrees` 下 3 个：`recog-gaps`、`electronic-sign`、`catalog-nonstandard`。

可见 LFS 的释放要等 Codex 的工作告一段落，不能单靠本次瘦身完成。

### 4.4 远端核对

逐个对象调用 GitHub LFS 批量接口（`operation: download`，只返回下载链接，不下载、不占带宽）：

| 集合 | 对象 | GitHub 上确认存在 |
|---|---|---|
| 标签 `archive/pre-cleanup-20261013` | 1088 个、13.74 GB | 1088 个 |
| 标签 `cleaning-full-run-02-20261009` | 994 个、12.24 GB | 994 个 |
| 标签 `cleaning-source-supplement-20261009` | 870 个、11.20 GB | 870 个 |
| §4.3 中可再释放的 1070 个 | 12.78 GB | 1070 个 |
| `upload/pdfs-20261008` 的 60 份 PDF | 0.97 GB | 60 个 |

### 4.5 风险

| 风险 | 说明 | 对策 |
|---|---|---|
| 孤儿对象不可恢复 | 4.51 GB 从未进入提交，GitHub 上没有 | 先移到仓库外隔离（Q7） |
| 推送用的裸仓库共用 LFS 存储 | `%LOCALAPPDATA%\store-design-push.git` 的 `lfs.storage` 指向主仓库的 `.git/lfs`，git-lfs 文档明确提醒这种情况“不要运行 prune”，因为主仓库看不到裸仓库的分支。现查裸仓库 152 个分支，不在 GitHub 上的提交只有 3 个，正好是主仓库那 3 个未推送提交（已受保留规则保护） | 每次 prune 前重查一次（附录 E 有命令） |
| 裸仓库共用对象库 | 它通过 `objects/info/alternates` 引用主仓库的 `.git/objects` | 删除分支后不要运行 `git gc --prune=now`；`.git/objects` 本次只统计、不处理 |
| GitHub 额度 | 本地 prune 不改变 GitHub 上的 LFS 存储和额度。`.gitignore:82` 记录过“LFS quota is full”。清掉的对象以后要从 GitHub 重新下载，会消耗下载额度；额度用尽时可能下载不了。本机 gh 令牌没有 `user` 权限，读不到用量 | 用户在 GitHub 的 Settings → Billing 页面查看 LFS 用量后再决定 |
| 对其他 worktree 的影响 | prune 会保留各 worktree 当前检出要用的对象。之后切换到旧分支时需要重新下载 | main 已无 LFS 文件，日常开发不受影响 |

**恢复方式**：`git lfs fetch origin <分支或标签>`，或检出时自动下载。从归档标签恢复单个文件用 `git checkout archive/pre-cleanup-20261013 -- <路径>`，会触发下载。

### 4.6 `.git/objects`

2.69 GB：3 个 pack、29,176 个对象，可达对象 18,928 个，其余是不可达的旧提交和中间对象。按要求只统计，不处理（不运行 `gc --prune`、不改写历史）。

## 5. worktree 与分支

### 5.1 删除 worktree 的安全性实验

实验在 `%TEMP%\prune-junction-test` 进行：临时仓库，连接只指向一次性目录，每个用例的目标目录里放两个哨兵文件，本机 Git 2.55.0.windows.3。连接用与接入脚本相同的 PowerShell `New-Item -ItemType Junction` 创建。

| 用例 | 结果 |
|---|---|
| 被忽略的连接 `资源库` + `git worktree remove` | 报告成功；**哨兵完好**；删掉了其他文件和 worktree 登记，但留下 worktree 目录和连接本身 |
| 同上 + `--force` | 同上 |
| 未被忽略的连接 + `remove` | 拒绝删除（“contains modified or untracked files”），什么都没删 |
| 未被忽略的连接 + `--force` | 报告成功；哨兵完好；残留目录和连接 |
| `node_modules\pkg` 是连接（模拟 pnpm） | 报告成功；哨兵完好；残留 `node_modules` |
| 残留目录用 `cmd /c rmdir /s /q` 清理 | 残留清除；**哨兵完好** |
| 先在 PowerShell 确认 `LinkType` 是 `Junction`，用 `cmd /c rmdir`（不带 `/s`）摘掉连接，再 `git worktree remove` | 干净删除，无残留；哨兵完好 |

另外两个发现：
- 在 Git Bash 里给 `cmd` 传中文路径会被转码，`mklink`、`rmdir` 找不到路径。所以摘连接一律在 PowerShell 里做。
- Windows PowerShell 5.1 的 `Remove-Item -Recurse` 删除连接时有穿透到目标目录的历史问题，本流程不用它。

现状：
- 只有 3 个 worktree 的“资源库”是指向 OneDrive 的连接，都是 Codex 的：`store-design-resource-migration`、`store-design-resource-release`、`codex-collab-board-20261102`。
- Claude 的 worktree 里，“资源库”都是迁移前检出的真实目录。
- pnpm 的连接：`prune` worktree 中 590 个，全部指向 worktree 内部（`enableGlobalVirtualStore` 未启用，store 在 `D:\.pnpm-store\v11`，文件是硬链接）。

**阶段 1 的删除步骤**（一次一个 worktree，任何一步不符合就跳过并记录）：

1. 复核：`git -C <wt> status --porcelain` 为 0 条；`--ignored` 只含 `node_modules`、`dist`、`data`、`.env`、`__pycache__`；分支已合并；无未推送提交。
2. 在 PowerShell 中列出 worktree 内全部连接，确认没有指向 worktree 外部的。“资源库”若是连接，用 `cmd /c rmdir` 摘掉。
3. `git worktree remove <wt>`（不加 `--force`）。
4. 有残留时用 `cmd /c rmdir /s /q <wt>` 清掉。
5. 开工前用同一方法测一次资源库文件数作为基线。发布记录为 23,633，本次用 ripgrep 显式统计为 23,822。每处理完一个就复测，不得少于基线；处理过带连接的 worktree 后，再运行接入脚本的哈希校验。发现任何减少立即停手。
6. 全部完成后运行 `git worktree prune`。

### 5.2 worktree 清单（51 个，逐项见附录 A）

**归属判断依据**：
- 分支前缀 `codex/`；
- PR 正文是否有 “Generated with Claude Code”（154 个 PR 中 135 个有）；
- 分支提交是否带 `Co-Authored-By: Claude`；
- 看板登记。

判断不了的当作对方的，不动。

| 类别 | 数量 | 内容 | 建议 |
|---|---|---|---|
| Claude，PR 已合并，可删 | 27 | `any-angle`、`any-angle-2`、`any-angle-2b`、`any-angle-3`、`any-angle-4`、`any-angle-5`、`area-later`、`display-plan`、`handover-docs`、`phase2-plan`、`phase3-plan`、`plan-wall-edit`、`real-shapes`、`recog-cloud`、`recog-dim`、`recog-ocr`、`recog-poly`、`recog-props`、`recog-trace`、`si-fix`、`si-switch`、`space-editor`、`split-agent-tools`、`split-recognition-local`、`split-white-scene`、`ui-work`、`unboxing-body` | 删除（Q1），可释放约 177.5 GB |
| 需要用户决定 | 6 | `drawing-archive-plan`、`recog-eval`、`architecture-review`、`system-tester`、`ui-design`、`pdf-upload-20261008` | 见下表（Q2） |
| Codex，不动 | 18 | `%USERPROFILE%\Documents\Codex` 下 14 个，`D:\text demo-worktrees` 下 4 个：`codex-collab-board-20261102`（#169）、`electronic-sign`（#153）、`catalog-nonstandard`（10 项未提交改动）、`recog-gaps`（检出 #156 的分支） | 写进看板第 6 节，由 Codex 自己清或等用户授权 |

`plan-wall-edit`、`system-tester`、`ui-work` 里各有一份 `.env` 副本（含密钥），删除 worktree 会一并删除副本，不影响主工作区的 `.env`。

| 需要决定的 worktree | 证据 | 被忽略内容 | 建议 | 风险 |
|---|---|---|---|---|
| `drawing-archive-plan`（`archive/stage3a-gold`，#130/#132/#135） | Claude，已合并 | `资源库/09_门店档案/_cache/`：972 个文件、213 MB，含第 1–9 批金标准审核页（12 个 HTML，含修订版）、gold 派生图 172 MB、页面特征 22.5 MB | 保留到金标准修订审核页复查结束（任务在 Issues 里未关闭） | 直接删除会丢掉用户正在用的审核页 |
| `recog-eval`（游离 HEAD `5f454347`，10-16） | 提交带 Claude 署名；已合并 | `_cache/`：66 个文件、0.5 MB（gold 缓存 65 个、`识别打分.json`） | 把 `_cache` 移到仓库外后删除 | 低：移出后打分结果仍在 |
| `architecture-review`（游离 HEAD `21a8ef88`） | 10-13 建立（评审报告第 240 行记载了这种建法），10-14 更新到 #82；无独有提交 | 依赖、构建产物、`data/`；`demo/` 里只剩旧 demo 的 node_modules（114 MB） | 按 Claude 的删除 | 低：没有独有提交，归属靠旁证 |
| `system-tester`（`chore/si-recheck`） | HEAD `a58477da` 正是交接说明第 4 节“系统测试师在 a58477da 上复测”的提交；无独有提交 | 依赖、`data/`、`.env` | 按 Claude 的删除 | 低：回归脚本在 `%LOCALAPPDATA%\store-design-regression`，不在这里 |
| `ui-design`（`design/ui-research`） | 10-16 建立，HEAD 是 #108 的合并；与 Claude 的 `ui-work`（`design/ui-layout`，#128）同属 UI 改版；无独有提交 | 无 | 按 Claude 的删除 | 低：没有独有提交，归属靠旁证 |
| `pdf-upload-20261008`（`upload/pdfs-20261008`，未合并、未推送） | 提交 `a04d4d8f` 与 main 历史中的 `d1cc7c5`（“upload 60 missing store drawing PDFs”）**树完全相同、父提交相同**；60 份 PDF 在 GitHub 上已确认 | 无 | 删除 worktree 和本地分支（未合并，要用 `-D`；恢复：`git branch upload/pdfs-20261008 a04d4d8f`） | 低：内容已在 main 历史和 GitHub 上 |

### 5.3 `D:\text demo-worktrees` 下的非 worktree 目录

| 目录 | 内容 | 大小 | 建议 | 风险 |
|---|---|---|---|---|
| `pdf-upload-clean-20261008` | 10-08 用于补传 PDF 的独立克隆（自带 `.git` 1.1 GB）。分支 `synced/pdfs-20261008` 已推送并进入 main 历史，未提交改动 0。里面有一个连接指向主工作区的 `demo\node_modules` | 2.1 GB | 先摘连接再删除 | 不先摘连接就用会穿透的工具删除，会删到主工作区的 `demo\node_modules` |
| `merge-qa-artifacts`、`resource-qa-results` | 10-08 旧版 demo 的 Playwright 结果 | 不到 0.1 MB | 删除 | 无 |
| `merge-vite-cache` | 10-08 的 Vite 依赖缓存 | 9.7 MB | 删除 | 无 |
| `node_modules` | 只有 `.pnpm-task-run-state-v1`（10-16） | 不到 0.1 MB | 删除 | 无，pnpm 会重建 |
| `展陈方案样例` | `七宝领展店-3桌竖版.pptx`（10-14） | 2.9 MB | 保留（像是给用户看的样例） | — |

### 5.4 分支

| 类别 | 数量 | 建议 |
|---|---|---|
| 远程，Claude 已合并（含 9 个 `archive/*` 分支：名字里的 archive 指“门店档案”，各有 PR，不是归档快照） | 130 | 删除（Q5），清单与提交号见附录 B |
| 远程，非 Claude 已合并（#1–#3 早期资源整理，#153–#167 Codex）+ `codex/collab-board-20261102` | 16 | 不动，写进看板 |
| 远程，快照 `snapshot/20261008`（10-08，无 PR） | 1 | 保留 |
| 远程，未合并：`feat/recognition-openings`（#156 草稿）、`ui/camera-tab`、`ui/responsive-workbench`（#160、#157 是压缩合并：内容已进 main，分支上的原提交不在 main 历史里，分支在合并后没有新提交） | 3 | 不动（Codex） |
| 本地，Claude 已合并 | 128 | 随 worktree 一起用 `git branch -d` 删除（只删已合并的）（Q6） |
| 本地，非 Claude 或 Codex | 18 | 不动 |
| 本地，已合并但归属待定 | 7 | `chore/regression-1019`、`fix/irregular-followups`：无 worktree、无独有提交，删除不丢提交。`chore/si-recheck`、`design/ui-research` 跟随 Q2。`feat/catalog-advertising-20261030`、`feat/catalog-nonstandard`、`fix/display-diagnosis` 被 Codex 的 worktree 检出，不动 |
| 本地，未合并：`upload/pdfs-20261008`（见 §5.2）、`feat/catalog-s2-stool`（Codex，未推送） | 2 | 前者跟随 Q2，后者不动 |

删除远程分支后，GitHub 的 PR 页面保留“恢复分支”按钮；也可以按附录 B 的提交号执行 `git push origin <提交号>:refs/heads/<分支>`。

## 6. 主工作区的未跟踪与被忽略内容

主工作区 `D:\text demo` 共 33 项。统计用 PowerShell 5.1 递归枚举（不跟随连接），并列出了每个目录内的连接。

| 对象 | 大小 / 文件数 | 来源与时间 | 能否重建 / 风险 | 建议（Q4） | 涉及 Codex |
|---|---|---|---|---|---|
| `demo/` | 107.5 MB / 3388（`node_modules` 105.8、`dist` 1.7） | 第一代网页；源码 10-13 已归档进标签，剩下的是构建产物和依赖 | 不需要重建 | 删除 | 否 |
| `leftdim.png`、`rightdim.png`、`tblA.png` | 各约 0.1 MB | 10-19 的截图，来源不明 | — | 用户决定 | ? |
| `outputs/model-name-cleanup-20261010/` | 0.3 MB / 1 | 10-10 模型命名清理输出，和 `tmp/model-name-cleanup` 是一组 | — | 问 Codex | 可能 |
| `tmp/` | 10.2 MB / 86 | 10-08 至 10-21：电子水牌备份与评审、交接 Issue 草稿、`pdfs/`、`model-name-cleanup/`。**`tmp/model-name-cleanup/node_modules` 是指向 Codex 运行时依赖目录的连接** | — | 不动，问 Codex；清理时先摘连接 | 是 |
| `tools/pdf-review/` | 69.8 MB / 569 | 只剩 09-23 的 `node_modules`，源码 10-13 已归档 | 不需要 | 删除 | 否 |
| `tools/training/.venv` | 1.41 GB / 22,585 | uv 建的 Python 3.11 训练环境（torch、diffusers 等），10-08 | `requirements*.txt` 可重建 | 删除 | 否 |
| `tools/training/runtime`、`uv.zip` | 41 MB、17 MB | uv 可执行文件和安装包（09-22）。本机的 uv 在 `%USERPROFILE%\.local\bin`，PATH 里没有 training | 可重新下载 | 删除 | 否 |
| `tools/data-cleaning/.venv` | 317 MB / 3964 | 用 Codex 运行时的 Python 3.12 建的 OCR 环境。`tools/store-archive/README.md:9` 已写明不要再借用它；门店档案改用 `%LOCALAPPDATA%\store-archive\venv` | `requirements.txt` 可重建 | 删除（data-cleaning 属先问目录） | 早期 Codex |
| `data/model-conversion/` | 953 MB / 133 | 10-09 模型转换中间产物：`dae-20261009.zip` 628 MB、`opt-test` 301 MB、`review*` 各约 7 MB、日志 | 有副本：这个 ZIP（659,043,148 字节）的 SHA256 与同目录 `parts-manifest.json` 的记录一致；OneDrive 资源库的 `90_处理过程与审核/模型拆分/dae-20261009/zip-parts/` 里有同一份清单和 10 个分卷，合计字节数相同。只比较了大小，没有读取 OneDrive 文件内容 | 删除 | 模型库（Codex 主责，知会） |
| `data/archive/` | 78 MB / 190 | 10-10 至 10-16 测试项目的交付归档（应用生成） | — | 保留（运行数据） | 否 |
| `data/pglite`、`data/files`、`data/codex-untracked-backup` | 58 MB、264 MB、8 MB | 本地数据库与文件 | — | **不动**（用户规定） | — |
| `素材库/` | 0 个文件 | 10-08 留下的空目录树 | — | 删除 | 否 |
| `output/web-qa/`、`apps/web/dist/` | 0.1 MB、1.2 MB | 10-09 截图、10-10 构建产物 | 可重建 | 删除 | 否 |
| 各处 `__pycache__` | 小 | Python 缓存 | 自动重建 | 删除 | 否 |
| `node_modules`（各处）、`.env`、`resources.local.json`、`资源库` 连接 | — | 用户正在使用 | — | **不动** | — |
| `AGENTS.md`、`CLAUDE.md`、`.github/copilot-instructions.md` | — | 用户的本机规则文件 | — | **不动** | — |

另外，主工作区以外还有本项目相关的本机目录：
- `%LOCALAPPDATA%\store-design-push.git`：推送用裸仓库，347 KB；
- `%LOCALAPPDATA%\store-archive\venv`；
- `%LOCALAPPDATA%\store-design-regression`：系统测试脚本；
- `%TEMP%\wb-driver`：浏览器核对。

这些都在用，本次不动。

## 7. 搜索噪声与资源库连接

实测在主工作区进行（只看文件名，深度不超过 3）。“资源库”连接指向 `%OneDrive%\门店生成工作台\资源库`。

| 方式 | 进入资源库的文件数 |
|---|---|
| `rg` 默认、`rg --no-ignore`、`rg --follow`（VS Code 默认就是这样）、`find`、不带 `-L` 的 `du`、PowerShell 5.1 `Get-ChildItem -Recurse` | 0 |
| `rg --no-ignore --follow` | 586 |
| `find -L` | 1,142 |

- 起作用的是 `.gitignore` 第 44 行 `/资源库/`。所以 `.ignore` 第 12–16 行那 5 条资源库规则是多余的。
- knip 和 jscpd 遵守 `.gitignore`、不跟随链接；madge、depcheck、tsc 只扫指定目录。本次扫描用的 `prune` worktree 本来就没有接入资源库。
- 显式指定 `资源库` 去搜时，`.ignore` 的子目录规则不生效，能看到 23,792 个文件（全部 23,822 个），其中 `90_处理过程与审核` 有 20,468 个。如果搜的是内容，还会让 OneDrive 把“仅在线”的文件下载到本机。
- 主工作区没有 `.vscode/settings.json`，仓库也没有 `.rgignore`。
- **没能核实**：VS Code 的文件监视、TypeScript 服务、Windows 索引遇到连接时的行为。

开工必读上下文（token 估算）：

| 类别 | 内容 | 约 token |
|---|---|---|
| 规则与协调 | AGENTS 1,049、CLAUDE 136、collab-board 3,481、handover 3,743 | 0.84 万 |
| 入门 | 根 README 2,082、docs/README 1,364、architecture 9,367、requirements 6,113、data-model 4,015、api 5,239、design-system 612 | 2.88 万 |
| 全部 docs | md 约 10.9 万，json 约 5.8 万 | — |

阶段 4 会用同样的口径复测。

## 8. 后续阶段的做法

| 阶段 | 做什么 | 前提 | 验证 |
|---|---|---|---|
| 1 低风险清理（只动本机，不改仓库） | 按 §5.1 的步骤删 Q1、Q2 同意的 worktree；`git worktree prune`；删 Q6 同意的本地分支；按 Q4 逐项清本机杂物；Q5、Q7、Q8 等用户确认后执行 | 用户答复第 9 节 | 每删一个都核对资源库文件数；主工作区的 dev 不受影响 |
| 2 文档与脚本归档 | 先建标签 `archive/pre-prune-20261102` 并推送；按 Q9 归档；按 Q10 改配置；按 Q11 订正入口文档；在 `docs/archive/INDEX.md` 追加恢复命令 | Q9–Q11 | `pnpm check`、`pnpm format:check`、`pnpm build`；全仓 grep 确认没有断链 |
| 3 死代码 | Q12：3 处转发导出（展陈那处先在看板登记）；eslint 两行合并在阶段 2 的配置 PR | Q12 | 同上，并跑表征测试 |
| 4 收尾 | 前后对比：已跟踪文件数、代码行数、依赖数、仓库与 `.git` 体积、开工必读上下文；浏览器烟雾测试（首页、工作台、三维、展陈、交付）；更新 INDEX 和看板 | — | — |

阶段 2、3 每批一个分支 `claude/prune-<批次>`、一个 PR，搬家和改逻辑分开。看板第 4 节的热点文件（如 `package.json`、`pnpm-lock.yaml`、样式入口文件）改动前先登记；`eslint.config.js`、`.gitignore`、`.ignore` 不在热点清单里。

## 9. 需要用户决定的问题

不答复的按推荐处理。**标“不可逆”的必须等确认。**

| 编号 | 问题 | 选项 | 推荐 |
|---|---|---|---|
| Q1 | Claude 的 27 个已合并 worktree（§5.2 第一行，可释放约 177.5 GB）是否删除？（不可逆：会删掉其中的本地测试库和 `.env` 副本） | A 按 §5.1 的步骤逐个删除；B 暂不删 | A |
| Q2 | 6 个需要决定的 worktree 怎么处理？ | 逐项见 §5.2 第二张表的“建议”列 | `drawing-archive-plan` 保留；`recog-eval` 把缓存移出后删；`architecture-review`、`system-tester`、`ui-design` 按 Claude 的删；`pdf-upload-20261008` 连同本地分支删。按推荐可再释放约 33 GB |
| Q3 | `D:\text demo-worktrees` 下 6 个非 worktree 目录怎么处理？（不可逆） | 逐项见 §5.3 的“建议”列 | 删前 5 个（`pdf-upload-clean` 先摘连接），保留 `展陈方案样例` |
| Q4 | 主工作区本机杂物怎么处理？（不可逆） | 逐项见 §6 的“建议”列 | `demo/`、`tools/pdf-review/`、`tools/training` 的 `.venv`/`runtime`/`uv.zip`、`素材库/`、`output/web-qa/`、`apps/web/dist/`、`__pycache__` 删除；三张 png 请你决定；`tmp/`、`outputs/` 问 Codex；`tools/data-cleaning/.venv` 删除；`data/model-conversion/` 删除（DAE 包在资源库有分卷副本）；`data/archive/` 保留 |
| Q5 | Claude 已合并的 130 个远程分支是否删除？（不可逆，但 PR 页面可恢复） | A 全部删除；B 保留 9 个 `archive/*`，删其余 121 个；C 不删 | A |
| Q6 | 本地已合并分支：Claude 的 128 个（被保留的 worktree 检出的分支除外），加 `chore/regression-1019`、`fix/irregular-followups`（无 PR、无独有提交） | A 用 `git branch -d` 删除；B 不删 | A |
| Q7 | LFS 中 1155 个孤儿对象（4.51 GB，从未提交，GitHub 上没有）怎么处理？（不可逆） | A 移到仓库外的隔离目录（同盘移动，不占额外空间），30 天内没人反映缺失再删除；B 直接 prune；C 不动 | A |
| Q8 | LFS 中被钉住的 13.76 GB 怎么处理？（不可逆，但 12.78 GB 可从 GitHub 重新下载） | A 等三个条件都满足后执行 `git lfs prune --verify-remote`：45 个旧 worktree 全部清掉（Codex 的 12 个由 Codex 处理）、#156 的分支合入 main、近期窗口过期；B 不动 | A。执行前请先在 GitHub 查看 LFS 下载额度 |
| Q9 | 阶段 2 归档范围？ | 逐项：`docs/design/pr1–pr7` 截图（Codex 区域）A 归档 / B 保留 / C 只删 4 对重复；`output/` 16 个无引用文件 A 归档 / B 保留；`tools/training` 已跟踪文件 A 保留 / B 归档；`tools/data-cleaning` 保留；3 份被登记的历史文档保留 | 截图：征得 Codex 同意后 A；output：A；training：A 保留 |
| Q10 | 根配置清理？ | A 删 `.gitignore` 20 条失效规则、删 eslint 2 行、改写 `.ignore`（删 5 条多余规则，加入 `docs/evidence/` 等）、`.gitattributes` 只加注释；B 不改 | A |
| Q11 | 入口文档订正（§3.5，其中 sync 与 architecture 涉及 Codex）？ | A 订正；B 不改 | A |
| Q12 | 删除 3 处无人使用的转发导出？ | A 删除；B 不删 | A |
| Q13 | 60 个“只在本文件使用”的导出和 6 类重复实现是否纳入瘦身？ | A 不纳入，只记录；B 只做 Claude 区域非热点文件的 22 个导出；C 全做 | A |
| Q14 | 交给 Codex 的事项：Codex 的 18 个 worktree、16 个已合并远程分支、`tmp/`、`outputs/`、2 条死样式、截图是否归档 | A 写进看板第 6 节，由 Codex 自行处理；B 你授权 Claude 代清 | A |

## 附录 A worktree 逐项

CX 表示位于 `%USERPROFILE%\Documents\Codex`，其余在 `D:\text demo-worktrees`。“LFS 钉住”是该 worktree 的检出所引用的本地 LFS 对象（§4.3）。体积括号内为不含 node_modules 的部分：node_modules 的文件是 pnpm 全局仓库的硬链接（实测同一文件有 33 个链接，全局仓库只有 823 MB），删除 worktree 不释放这部分。

| worktree | 分支 | 归属依据 | 已合并 | 未推送 | 未提交 | 被忽略内容 | 资源库 | LFS 钉住（个 / GB） | 体积 GB（不含 node_modules） | 建议 |
|---|---|---|---|---|---|---|---|---|---|---|
| CX: `store-design-resource-migration` | `chore/resources-onedrive` | #163 非 Claude | 是 | 0 | 0 | 迁移前备份目录、依赖、本地库、资源库连接 | 连接 | — | 1.38（0.50） | Codex，不动 |
| CX: `store-design-resource-release` | `chore/resource-release-20261030` | #164 非 Claude | 是 | 0 | 0 | 资源库连接 | 连接 | — | 0.04（0.04） | Codex，不动 |
| CX: `boundary-walls` | `feat/boundary-walls-20261030` | #162 非 Claude | 是 | 0 | 2 | 依赖、output/web-qa/ | 真实目录 | 1123 / 13.75 | 1.35（0.47） | Codex，不动 |
| CX: `catalog-ads` | `feat/catalog-advertising-20261030` | 无 PR；署名 0/1 | 是 | 0 | 120 | 依赖、本地库、output/web-qa/、材质轻量版 | 真实目录 | 1123 / 13.75 | 1.99（1.11） | Codex，不动 |
| CX: `catalog-availability` | `feat/catalog-availability-20261030` | #158 非 Claude | 是 | 0 | 2 | 依赖、本地库、output/web-qa/ | 真实目录 | 1123 / 13.75 | 1.39（0.51） | Codex，不动 |
| CX: `catalog-s2-stool` | `feat/catalog-s2-stool` | 无 PR；署名 0/1 | 否 | 1 | 207 | 依赖、本地库、output/web-qa/、材质轻量版 | 真实目录 | 1129 / 13.75 | 4.40（3.52） | Codex，不动 |
| CX: `lightbox-wall-art` | `feat/lightbox-wall-art-20261030` | #161 非 Claude | 是 | 0 | 2 | 依赖、本地库、output/pdf/、output/web-qa/ | 真实目录 | 1123 / 13.75 | 1.40（0.52） | Codex，不动 |
| CX: `release-record-advertising` | `docs/catalog-advertising-release-20261030` | #166 非 Claude | 是 | 0 | 2 | 无 | 无 | — | 0.04（0.04） | Codex，不动 |
| CX: `release-record-nonstandard` | `docs/catalog-nonstandard-release-20261030` | #165 非 Claude | 是 | 0 | 2 | 无 | 无 | — | 0.04（0.04） | Codex，不动 |
| CX: `release-record-s2` | `feat/catalog-s2-release-20261030` | #167 非 Claude | 是 | 0 | 2 | 无 | 无 | — | 0.04（0.04） | Codex，不动 |
| CX: `store-display-diagnosis` | `fix/display-diagnosis` | 无 PR；署名 0/1 | 是 | 0 | 3 | 依赖 | 真实目录 | 1123 / 13.75 | 15.47（15.47） | Codex，不动 |
| CX: `store-display-trays` | `fix/display-tray-catalog` | #159 非 Claude | 是 | 0 | 2 | 依赖、构建、本地库 | 真实目录 | 1123 / 13.75 | 0.46（0.46） | Codex，不动 |
| CX: `store-ui-camera-tab` | `ui/camera-tab` | #160 非 Claude | 压缩合并 | 0 | 2 | 依赖、构建 | 真实目录 | 1123 / 13.75 | 1.35（0.47） | Codex，不动 |
| CX: `store-ui-render` | `ui/responsive-workbench` | #157 非 Claude | 压缩合并 | 0 | 2 | 依赖、构建、本地库 | 真实目录 | 1123 / 13.75 | 1.35（0.47） | Codex，不动 |
| `any-angle` | `feat/any-angle-geometry` | #98 Claude | 是 | 0 | 0 | 依赖、构建、本地库 | 真实目录 | 1088 / 13.74 | 0.96（0.45） | Q1：删除 |
| `any-angle-2` | `feat/any-angle-rotate` | #100 Claude | 是 | 0 | 0 | 依赖、构建、本地库 | 真实目录 | 1088 / 13.74 | 0.96（0.45） | Q1：删除 |
| `any-angle-2b` | `feat/any-angle-rotate-ui` | #107 Claude | 是 | 0 | 0 | 依赖、构建、本地库 | 真实目录 | 1116 / 13.75 | 0.98（0.46） | Q1：删除 |
| `any-angle-3` | `feat/any-angle-planner` | #106 Claude | 是 | 0 | 0 | 依赖、本地库 | 真实目录 | 1116 / 13.75 | 0.96（0.44） | Q1：删除 |
| `any-angle-4` | `feat/any-angle-agent-import` | #104 Claude | 是 | 0 | 0 | 依赖、构建、本地库 | 真实目录 | 1116 / 13.75 | 0.96（0.45） | Q1：删除 |
| `any-angle-5` | `fix/legend-and-tilted-display` | #108 Claude | 是 | 0 | 0 | 依赖、本地库 | 真实目录 | 1116 / 13.75 | 0.96（0.44） | Q1：删除 |
| `architecture-review` | `(detached)` | 无 PR；署名 0/1 | 是 | 0 | 0 | 依赖、构建、本地库、demo/ | 真实目录 | 1088 / 13.74 | 1.18（0.67） | Q2：按 Claude 的删除 |
| `area-later` | `feat/area-added-later` | #133 Claude | 是 | 0 | 0 | 依赖、构建、本地库 | 真实目录 | 1121 / 13.75 | 16.36（15.48） | Q1：删除 |
| `catalog-nonstandard` | `feat/catalog-nonstandard` | 无 PR；署名 0/1 | 是 | 0 | 10 | 依赖、本地库、output/web-qa/、材质轻量版 | 真实目录 | 1123 / 13.75 | 16.61（15.73） | Codex，不动 |
| `codex-collab-board-20261102` | `codex/collab-board-20261102` | codex/ 前缀 | 是 | 0 | 0 | 依赖、本地库、资源库连接 | 连接 | — | 0.91（0.04） | Codex，不动 |
| `display-plan` | `feat/display-body-textures` | #119 Claude | 是 | 0 | 0 | 依赖、本地库 | 真实目录 | 1121 / 13.75 | 16.32（15.48） | Q1：删除 |
| `drawing-archive-plan` | `archive/stage3a-gold` | #135 Claude,#132 Claude,#130 Claude | 是 | 0 | 0 | 依赖、pycache、**09_门店档案/_cache/** | 真实目录 | 1121 / 13.75 | 4.34（3.83） | Q2：保留到审核页复查结束 |
| `electronic-sign` | `feat/electronic-sign-web` | #153 非 Claude | 是 | 0 | 0 | 依赖、材质轻量版 | 真实目录 | 1123 / 13.75 | 0.55（0.55） | Codex，不动 |
| `handover-docs` | `docs/codex-handover` | #136 Claude,#134 Claude,#131 Claude | 是 | 0 | 0 | 无 | 真实目录 | 1121 / 13.75 | 0.45（0.45） | Q1：删除 |
| `pdf-upload-20261008` | `upload/pdfs-20261008` | 无 PR；署名 0/1 | 否 | 1 | 0 | 无 | 无 | 418 / 8.46 | 1.12（1.12） | Q2：连同本地分支删除 |
| `phase2-plan` | `docs/irregular-phase2-plan` | #91 Claude | 是 | 0 | 0 | 无 | 真实目录 | 1088 / 13.74 | 0.44（0.44） | Q1：删除 |
| `phase3-plan` | `docs/irregular-phase3-plan` | #109 Claude | 是 | 0 | 0 | 无 | 真实目录 | 1116 / 13.75 | 0.44（0.44） | Q1：删除 |
| `plan-wall-edit` | `feat/plan-stage-wall-edit` | #92 Claude | 是 | 0 | 0 | .env、依赖、本地库 | 真实目录 | 1088 / 13.74 | 16.02（15.50） | Q1：删除 |
| `real-shapes` | `test/real-shapes-gold4` | #121 Claude | 是 | 0 | 0 | 依赖 | 真实目录 | 1121 / 13.75 | 16.35（15.47） | Q1：删除 |
| `recog-cloud` | `feat/recognition-cloud-switch` | #118 Claude | 是 | 0 | 0 | 依赖、构建、本地库 | 真实目录 | 1121 / 13.75 | 16.31（15.47） | Q1：删除 |
| `recog-dim` | `feat/recognition-dimensions` | #115 Claude | 是 | 0 | 0 | 依赖、构建、本地库 | 真实目录 | 1121 / 13.75 | 16.31（15.47） | Q1：删除 |
| `recog-eval` | `(detached)` | 无 PR；署名 1/1 | 是 | 0 | 0 | pycache、**09_门店档案/_cache/** | 真实目录 | 1088 / 13.74 | 0.44（0.44） | Q2：缓存移出后删除 |
| `recog-gaps` | `feat/recognition-openings` | #156 非 Claude | 否 | 0 | 0 | 依赖、构建、本地库 | 真实目录 | 1123 / 13.75 | 16.36（15.48） | Codex，不动 |
| `recog-ocr` | `feat/recognition-page-ocr` | #126 Claude | 是 | 0 | 0 | 依赖、构建、本地库 | 真实目录 | 1121 / 13.75 | 16.36（15.48） | Q1：删除 |
| `recog-poly` | `feat/recognition-polygon` | #114 Claude | 是 | 0 | 0 | 依赖、构建、本地库 | 真实目录 | 1121 / 13.75 | 0.96（0.45） | Q1：删除 |
| `recog-props` | `feat/recognition-props` | #116 Claude | 是 | 0 | 0 | 依赖、构建、本地库 | 真实目录 | 1121 / 13.75 | 16.31（15.47） | Q1：删除 |
| `recog-trace` | `feat/recognition-trace` | #112 Claude | 是 | 0 | 0 | 依赖、构建、本地库 | 真实目录 | 1116 / 13.75 | 0.98（0.46） | Q1：删除 |
| `si-fix` | `fix/si-switch-followups` | #129 Claude | 是 | 0 | 0 | 依赖、构建、本地库 | 真实目录 | 1121 / 13.75 | 16.36（15.48） | Q1：删除 |
| `si-switch` | `fix/si-switch-per-node` | #127 Claude | 是 | 0 | 0 | 依赖、构建、本地库 | 真实目录 | 1121 / 13.75 | 16.36（15.48） | Q1：删除 |
| `space-editor` | `feat/space-editor-irregular` | #75 Claude | 是 | 0 | 0 | 依赖、构建 | 真实目录 | 1088 / 13.74 | 0.96（0.45） | Q1：删除 |
| `split-agent-tools` | `feat/island-side-cabinets` | #83 Claude | 是 | 0 | 0 | 依赖、构建、本地库 | 真实目录 | 1088 / 13.74 | 0.96（0.44） | Q1：删除 |
| `split-recognition-local` | `feat/agent-irregular` | #72 Claude | 是 | 0 | 0 | 依赖、本地库 | 真实目录 | 1088 / 13.74 | 0.94（0.43） | Q1：删除 |
| `split-white-scene` | `fix/plan-annotations-irregular` | #81 Claude | 是 | 0 | 0 | 依赖、构建、本地库 | 真实目录 | 1088 / 13.74 | 0.96（0.45） | Q1：删除 |
| `system-tester` | `chore/si-recheck` | 无 PR；署名 0/1 | 是 | 0 | 0 | .env、依赖、本地库 | 真实目录 | 1121 / 13.75 | 16.44（15.56） | Q2：按 Claude 的删除 |
| `ui-design` | `design/ui-research` | 无 PR；署名 0/1 | 是 | 0 | 0 | 无 | 真实目录 | 1116 / 13.75 | 15.47（15.47） | Q2：按 Claude 的删除 |
| `ui-work` | `design/ui-layout` | #128 Claude | 是 | 0 | 0 | .env、依赖、本地库 | 真实目录 | 1121 / 13.75 | 16.11（15.55） | Q1：删除 |
| `unboxing-body` | `fix/unboxing-body-footprint` | #95 Claude | 是 | 0 | 0 | 依赖、构建、本地库 | 真实目录 | 1088 / 13.74 | 0.98（0.46） | Q1：删除 |

## 附录 B 远程分支逐项

### B.1 Claude 已合并（130 个，Q5 的删除对象）

| # | 分支 | PR | 最后提交 | 提交号 |
|---|---|---|---|---|
| 1 | `assets/glb-38-20261009` | #5 | 2026-10-09 | `ef2689d4` |
| 2 | `chore/codex-outputs-20261009` | #7 | 2026-10-09 | `b1c84070` |
| 3 | `phase1/catalog` | #8 | 2026-10-09 | `5619c1f2` |
| 4 | `phase1/nodes` | #9 | 2026-10-09 | `75c676dc` |
| 5 | `phase1/planner` | #10 | 2026-10-09 | `664564ba` |
| 6 | `phase1/web-workbench` | #11 | 2026-10-09 | `9e7c4dac` |
| 7 | `progress/cleaning-light-20261009` | #6 | 2026-10-09 | `3f69f9dd` |
| 8 | `refactor/phase1-skeleton` | #4 | 2026-10-09 | `fb1e0abc` |
| 9 | `fix/selection-race` | #21 | 2026-10-10 | `3546d124` |
| 10 | `phase1/3d-load-perf` | #13 | 2026-10-10 | `4355a43e` |
| 11 | `phase1/delivery` | #27 | 2026-10-10 | `9dcef469` |
| 12 | `phase1/editing-comfort` | #19 | 2026-10-10 | `f94f8702` |
| 13 | `phase1/history-tree` | #17 | 2026-10-10 | `b9602b37` |
| 14 | `phase1/library-images` | #18 | 2026-10-10 | `d4b22de3` |
| 15 | `phase1/library-selection` | #25 | 2026-10-10 | `83d65c19` |
| 16 | `phase1/model-library` | #14 | 2026-10-10 | `9df76327` |
| 17 | `phase1/model-picker` | #15 | 2026-10-10 | `376d82f8` |
| 18 | `phase1/plan-drawing` | #16 | 2026-10-10 | `a1217c9f` |
| 19 | `phase1/render` | #24 | 2026-10-10 | `bf901dbf` |
| 20 | `phase1/render-standards` | #26 | 2026-10-10 | `fe58b56d` |
| 21 | `phase1/stage-history` | #20 | 2026-10-10 | `232c6e35` |
| 22 | `phase1/tree-drag` | #23 | 2026-10-10 | `25889b13` |
| 23 | `phase1/white-model` | #12 | 2026-10-10 | `4c7871da` |
| 24 | `phase1/workbench-layout` | #22 | 2026-10-10 | `6477b365` |
| 25 | `archive/stage0-baseline` | #42 | 2026-10-12 | `7d3c58d7` |
| 26 | `docs/drawing-archive-plan` | #41 | 2026-10-12 | `83cca148` |
| 27 | `feat/render-material-only` | #36 | 2026-10-12 | `e341b8d1` |
| 28 | `feat/si-swap` | #38 | 2026-10-12 | `16eaa55f` |
| 29 | `feat/three-d-effect-stage` | #40 | 2026-10-12 | `416a94e3` |
| 30 | `fix/prop-back-layers` | #35 | 2026-10-12 | `a77d087a` |
| 31 | `fix/recognition-llm-coords` | #39 | 2026-10-12 | `8abe6ebf` |
| 32 | `fix/white-node-name` | #34 | 2026-10-12 | `e4991a79` |
| 33 | `perf/finish-models` | #37 | 2026-10-12 | `38f75c70` |
| 34 | `phase1/import-export-ai-settings` | #28 | 2026-10-12 | `edccc734` |
| 35 | `phase2/recognition-api` | #29 | 2026-10-12 | `f3d0963e` |
| 36 | `phase2/recognition-quality` | #30 | 2026-10-12 | `57ae7aa9` |
| 37 | `phase3/agent-api` | #31 | 2026-10-12 | `5c309d4d` |
| 38 | `phase3/agent-tools-2` | #33 | 2026-10-12 | `73ad40c5` |
| 39 | `phase3/agent-web` | #32 | 2026-10-12 | `13582eb1` |
| 40 | `archive/sources-in-git` | #43 | 2026-10-13 | `afb90ade` |
| 41 | `archive/stage1-labels` | #44 | 2026-10-13 | `e3b37dc2` |
| 42 | `archive/stage1-prescreen` | #45 | 2026-10-13 | `af4e3510` |
| 43 | `chore/archive-demo` | #50 | 2026-10-13 | `cca060b8` |
| 44 | `chore/archive-scripts` | #49 | 2026-10-13 | `536c6ce2` |
| 45 | `docs/archive-history` | #48 | 2026-10-13 | `e8415c78` |
| 46 | `docs/context-entry` | #47 | 2026-10-13 | `cb148e6e` |
| 47 | `fix/pdf-closepath` | #58 | 2026-10-13 | `29929bf1` |
| 48 | `perf/image-thumbnails` | #55 | 2026-10-13 | `48dd6a9e` |
| 49 | `perf/webgl-context` | #54 | 2026-10-13 | `bead2b4b` |
| 50 | `refactor/api-boundaries` | #57 | 2026-10-13 | `8ef661b7` |
| 51 | `refactor/light-model-common` | #56 | 2026-10-13 | `36b7d8cf` |
| 52 | `refactor/shared-node-rules` | #53 | 2026-10-13 | `dbea9881` |
| 53 | `refactor/split-agent-tools` | #59 | 2026-10-13 | `d114a914` |
| 54 | `refactor/split-recognition-local` | #60 | 2026-10-13 | `10675b1c` |
| 55 | `refactor/split-white-scene` | #61 | 2026-10-13 | `450a5dc6` |
| 56 | `review/architecture-20261013` | #46 | 2026-10-13 | `cb271fc6` |
| 57 | `test/characterization` | #51 | 2026-10-13 | `eb9b7809` |
| 58 | `test/shared-fixtures` | #52 | 2026-10-13 | `51d3292a` |
| 59 | `archive/stage1-decisions` | #78 | 2026-10-14 | `25094c8e` |
| 60 | `archive/stage2-fix` | #87 | 2026-10-14 | `f87cfd39` |
| 61 | `archive/stage2-ocr` | #86 | 2026-10-14 | `cb6bb9b1` |
| 62 | `archive/stage2-pages` | #84 | 2026-10-14 | `bcd77b20` |
| 63 | `chore/react-hooks-lint` | #66 | 2026-10-14 | `45139b5f` |
| 64 | `docs/display-plan-guide-answers` | #76 | 2026-10-14 | `3134e047` |
| 65 | `docs/display-plan-requirements` | #71 | 2026-10-14 | `e240347c` |
| 66 | `docs/irregular-shop-plan` | #70 | 2026-10-14 | `c4833ffc` |
| 67 | `docs/pending-feedback` | #67 | 2026-10-14 | `942c91b8` |
| 68 | `feat/agent-irregular` | #72 | 2026-10-14 | `3aaacca0` |
| 69 | `feat/display-page` | #85 | 2026-10-14 | `a75a4eae` |
| 70 | `feat/display-ppt` | #80 | 2026-10-14 | `ef778993` |
| 71 | `feat/display-rules` | #79 | 2026-10-14 | `a3b5af9b` |
| 72 | `feat/space-editor-irregular` | #75 | 2026-10-14 | `80d30bb7` |
| 73 | `feat/space-openings-and-planner` | #73 | 2026-10-14 | `85fec376` |
| 74 | `feat/views-and-plan-irregular` | #74 | 2026-10-14 | `af43b132` |
| 75 | `fix/agent-parent-and-gap` | #62 | 2026-10-14 | `f227e9be` |
| 76 | `fix/import-errors-and-transactions` | #63 | 2026-10-14 | `6f8bd58c` |
| 77 | `fix/plan-annotations-irregular` | #81 | 2026-10-14 | `ce1151a1` |
| 78 | `fix/plan-editor-move-deps` | #69 | 2026-10-14 | `052dfc4b` |
| 79 | `fix/planner-near-axis-and-island` | #82 | 2026-10-14 | `467f7fe5` |
| 80 | `fix/reject-legacy-kinds` | #65 | 2026-10-14 | `c0e7a95e` |
| 81 | `improve/recognition-boundary` | #68 | 2026-10-14 | `ccd101be` |
| 82 | `refactor/plan-editor-hooks` | #64 | 2026-10-14 | `e570358d` |
| 83 | `test/real-irregular-samples` | #77 | 2026-10-14 | `0619eea8` |
| 84 | `chore/rename-skill-v2` | #102 | 2026-10-15 | `b7438558` |
| 85 | `docs/irregular-phase2-plan` | #91 | 2026-10-15 | `911cf5ad` |
| 86 | `feat/any-angle-geometry` | #98 | 2026-10-15 | `dbcd9ee3` |
| 87 | `feat/any-angle-rotate` | #100 | 2026-10-15 | `91e1e76e` |
| 88 | `feat/display-3d` | #97 | 2026-10-15 | `d6d9cf28` |
| 89 | `feat/display-render-photos` | #89 | 2026-10-15 | `c34a2b94` |
| 90 | `feat/display-slot-board` | #88 | 2026-10-15 | `aed9f042` |
| 91 | `feat/embedded-screens` | #96 | 2026-10-15 | `a3ecf604` |
| 92 | `feat/hollow-partition` | #94 | 2026-10-15 | `e2dc36cf` |
| 93 | `feat/island-side-cabinets` | #83 | 2026-10-15 | `addfbbe4` |
| 94 | `feat/logo-models` | #99 | 2026-10-15 | `5281a452` |
| 95 | `feat/logo-resize` | #101 | 2026-10-15 | `f06ac8b7` |
| 96 | `feat/plan-spacing-dims` | #93 | 2026-10-15 | `d2e22630` |
| 97 | `feat/plan-stage-wall-edit` | #92 | 2026-10-15 | `12f52a71` |
| 98 | `fix/logo-wall-mount` | #90 | 2026-10-15 | `96eae391` |
| 99 | `fix/unboxing-body-footprint` | #95 | 2026-10-15 | `b80268de` |
| 100 | `design/ui-display` | #123 | 2026-10-16 | `5cfda616` |
| 101 | `design/ui-foundation` | #117 | 2026-10-16 | `2b2fc297` |
| 102 | `design/ui-home` | #122 | 2026-10-16 | `45651d28` |
| 103 | `design/ui-home-row` | #124 | 2026-10-16 | `456efe0b` |
| 104 | `design/ui-polish` | #125 | 2026-10-16 | `b5abe6d9` |
| 105 | `design/ui-workbench` | #120 | 2026-10-16 | `eb050994` |
| 106 | `docs/irregular-phase3-plan` | #109 | 2026-10-16 | `b38c888d` |
| 107 | `feat/any-angle-agent-import` | #104 | 2026-10-16 | `5f7e42cd` |
| 108 | `feat/any-angle-planner` | #106 | 2026-10-16 | `5ceb94e4` |
| 109 | `feat/any-angle-rotate-ui` | #107 | 2026-10-16 | `64261583` |
| 110 | `feat/display-3d-live` | #110 | 2026-10-16 | `078942d5` |
| 111 | `feat/display-body-textures` | #119 | 2026-10-16 | `5503b1d7` |
| 112 | `feat/display-real-bodies` | #113 | 2026-10-16 | `5b63afd6` |
| 113 | `feat/leica-880` | #103 | 2026-10-16 | `79c5aadb` |
| 114 | `feat/logo-drag-resize` | #105 | 2026-10-16 | `296c7ed6` |
| 115 | `feat/recognition-cloud-switch` | #118 | 2026-10-16 | `8f2c98d2` |
| 116 | `feat/recognition-dimensions` | #115 | 2026-10-16 | `fe6a0673` |
| 117 | `feat/recognition-page-ocr` | #126 | 2026-10-16 | `0a76535e` |
| 118 | `feat/recognition-polygon` | #114 | 2026-10-16 | `f796171c` |
| 119 | `feat/recognition-props` | #116 | 2026-10-16 | `cd7cb350` |
| 120 | `feat/recognition-trace` | #112 | 2026-10-16 | `9da24a12` |
| 121 | `fix/legend-and-tilted-display` | #108 | 2026-10-16 | `39d7c743` |
| 122 | `fix/si-switch-per-node` | #127 | 2026-10-16 | `06637316` |
| 123 | `fix/sibling-space-and-spacing` | #111 | 2026-10-16 | `ca2feec2` |
| 124 | `test/real-shapes-gold4` | #121 | 2026-10-16 | `586e6bfc` |
| 125 | `archive/stage3a-gold` | #135,#132,#130 | 2026-10-19 | `66cd8abb` |
| 126 | `design/ui-layout` | #128 | 2026-10-19 | `625a6580` |
| 127 | `docs/codex-handover` | #136,#134,#131 | 2026-10-19 | `5f4e6371` |
| 128 | `feat/area-added-later` | #133 | 2026-10-19 | `40104bbe` |
| 129 | `fix/si-switch-followups` | #129 | 2026-10-19 | `b5485360` |
| 130 | `docs/collab-board` | #168 | 2026-11-02 | `264c7373` |

### B.2 其他（不动）

| 分支 | 已合并 | 归属判断 | PR | 最后提交 | 提交号 |
|---|---|---|---|---|---|
| `feat/recognition-openings` | 否 | 非 Claude（Codex 或早期） | #156 | 2026-10-30 | `585fcfe3` |
| `ui/camera-tab` | 否 | 非 Claude（Codex 或早期） | #160 | 2026-10-30 | `40975fd4` |
| `ui/responsive-workbench` | 否 | 非 Claude（Codex 或早期） | #157 | 2026-10-30 | `63d829b7` |
| `organize/resources-20261008` | 是 | 非 Claude（Codex 或早期） | #1 | 2026-10-08 | `b5e9d4de` |
| `snapshot/20261008` | 是 | 快照（无 PR） | 无PR | 2026-10-08 | `7ccd220b` |
| `delivery/dae-38-assets-20261009` | 是 | 非 Claude（Codex 或早期） | #3 | 2026-10-09 | `59c5c771` |
| `progress/resources-20261009` | 是 | 非 Claude（Codex 或早期） | #2 | 2026-10-09 | `f1644663` |
| `feat/electronic-sign-web` | 是 | 非 Claude（Codex 或早期） | #153 | 2026-10-21 | `bc06725d` |
| `ui/delivery-polish` | 是 | 非 Claude（Codex 或早期） | #155 | 2026-10-29 | `c6393b15` |
| `ui/render-polish` | 是 | 非 Claude（Codex 或早期） | #154 | 2026-10-29 | `caa33856` |
| `chore/resource-release-20261030` | 是 | 非 Claude（Codex 或早期） | #164 | 2026-10-30 | `882d369e` |
| `chore/resources-onedrive` | 是 | 非 Claude（Codex 或早期） | #163 | 2026-10-30 | `98bda172` |
| `docs/catalog-advertising-release-20261030` | 是 | 非 Claude（Codex 或早期） | #166 | 2026-10-30 | `04d9eed3` |
| `docs/catalog-nonstandard-release-20261030` | 是 | 非 Claude（Codex 或早期） | #165 | 2026-10-30 | `b6160262` |
| `feat/boundary-walls-20261030` | 是 | 非 Claude（Codex 或早期） | #162 | 2026-10-30 | `0cf8891c` |
| `feat/catalog-availability-20261030` | 是 | 非 Claude（Codex 或早期） | #158 | 2026-10-30 | `9f0becd0` |
| `feat/catalog-s2-release-20261030` | 是 | 非 Claude（Codex 或早期） | #167 | 2026-10-30 | `7c93c635` |
| `feat/lightbox-wall-art-20261030` | 是 | 非 Claude（Codex 或早期） | #161 | 2026-10-30 | `90243b71` |
| `fix/display-tray-catalog` | 是 | 非 Claude（Codex 或早期） | #159 | 2026-10-30 | `765ace06` |
| `codex/collab-board-20261102` | 是 | Codex | #169 | 2026-11-02 | `0b2c3544` |

## 附录 C docs 逐文件

建议按 §3.1 的分组处理，本表是逐文件证据。“被引用”是在已跟踪文件中按文件名搜索的结果（不含 `tools/data-cleaning`）。10-08 的快照提交 `20ed7a9b` 不代表内容的真实日期。

| 文件 | 大小 | 新增 | 最后修改 | 被引用（已跟踪文件，不含 data-cleaning） |
|---|---|---|---|---|
| `docs/README.md` | 4.6 KB | 20ed7a9b 2026-10-08 | 088f3e87 2026-10-14 | 根 README.md:7、.ignore:3、architecture-review-20261013（脚本按文件名匹配到的其余“README.md”是别的文件） |
| `docs/api.md` | 16.8 KB | 582413cf 2026-10-09 | 5b63afd6 2026-10-16 | README.md、docs/README.md、docs/architecture-review-20261013.md、docs/display-plan-requirements.md |
| `docs/architecture-review-20261013.md` | 35.8 KB | 9fbe10f7 2026-10-13 | cb271fc6 2026-10-13 | docs/README.md、docs/archive/INDEX.md、docs/requirements.md |
| `docs/architecture.md` | 29.1 KB | 20ed7a9b 2026-10-08 | cca060b8 2026-10-13 | README.md、docs/README.md、docs/architecture-review-20261013.md、docs/archive/INDEX.md、docs/display-plan-requirements.md、docs/handover-codex-20261019.md |
| `docs/archive/INDEX.md` | 4.5 KB | e8415c78 2026-10-13 | cca060b8 2026-10-13 | README.md、docs/architecture-review-20261013.md、tools/sketchup/README.md、docs/README.md、docs/architecture.md |
| `docs/boundary-walls.md` | 1.9 KB | ef8d5252 2026-10-30 | ef8d5252 2026-10-30 | 无 |
| `docs/collab-board.md` | 11.2 KB | 264c7373 2026-11-02 | 9ad300af 2026-11-02 | 无 |
| `docs/data-model.md` | 14.0 KB | 582413cf 2026-10-09 | a75a4eae 2026-10-14 | README.md、docs/README.md、docs/architecture-review-20261013.md、docs/architecture.md、docs/display-plan-requirements.md、docs/requirements.md、docs/store-drawing-archive-plan.md |
| `docs/data-preparation-next-steps.md` | 4.3 KB | 20ed7a9b 2026-10-08 | 5c3214a1 2026-10-08 | docs/README.md、docs/architecture-review-20261013.md、docs/archive/INDEX.md、docs/si-source-recovery.md、docs/store-drawing-archive-plan.md、tools/store-archive/register_legacy.py |
| `docs/design-system.md` | 2.0 KB | 20ed7a9b 2026-10-08 | 2b2fc297 2026-10-16 | README.md、docs/README.md、docs/architecture-review-20261013.md、docs/design/pr8-responsive.md、docs/handover-codex-20261019.md |
| `docs/design/pr1/after-01-home.png` | 98.7 KB | 2b2fc297 2026-10-16 | 2b2fc297 2026-10-16 | （目录级）handover-codex-20261019.md:66、design/pr8-responsive.md:5 文本提到 pr1–pr7 |
| `docs/design/pr1/after-04-plan-edit.png` | 138.6 KB | 2b2fc297 2026-10-16 | 2b2fc297 2026-10-16 | （目录级）handover-codex-20261019.md:66、design/pr8-responsive.md:5 文本提到 pr1–pr7 |
| `docs/design/pr1/after-06-stage3d.png` | 174.7 KB | 2b2fc297 2026-10-16 | 2b2fc297 2026-10-16 | （目录级）handover-codex-20261019.md:66、design/pr8-responsive.md:5 文本提到 pr1–pr7 |
| `docs/design/pr1/after-08-settings.png` | 63.2 KB | 2b2fc297 2026-10-16 | 2b2fc297 2026-10-16 | （目录级）handover-codex-20261019.md:66、design/pr8-responsive.md:5 文本提到 pr1–pr7 |
| `docs/design/pr1/before-01-home.png` | 90.1 KB | 2b2fc297 2026-10-16 | 2b2fc297 2026-10-16 | （目录级）handover-codex-20261019.md:66、design/pr8-responsive.md:5 文本提到 pr1–pr7 |
| `docs/design/pr1/before-04-plan-edit.png` | 124.4 KB | 2b2fc297 2026-10-16 | 2b2fc297 2026-10-16 | （目录级）handover-codex-20261019.md:66、design/pr8-responsive.md:5 文本提到 pr1–pr7 |
| `docs/design/pr1/before-06-stage3d.png` | 163.0 KB | 2b2fc297 2026-10-16 | 2b2fc297 2026-10-16 | （目录级）handover-codex-20261019.md:66、design/pr8-responsive.md:5 文本提到 pr1–pr7 |
| `docs/design/pr1/before-08-settings.png` | 52.5 KB | 2b2fc297 2026-10-16 | 2b2fc297 2026-10-16 | （目录级）handover-codex-20261019.md:66、design/pr8-responsive.md:5 文本提到 pr1–pr7 |
| `docs/design/pr2/after-radial-tree-bigshop.png` | 130.9 KB | eb050994 2026-10-16 | eb050994 2026-10-16 | （目录级）handover-codex-20261019.md:66、design/pr8-responsive.md:5 文本提到 pr1–pr7 |
| `docs/design/pr2/after-radial-tree-nanjing.png` | 104.5 KB | eb050994 2026-10-16 | eb050994 2026-10-16 | （目录级）handover-codex-20261019.md:66、design/pr8-responsive.md:5 文本提到 pr1–pr7 |
| `docs/design/pr2/after-workbench.png` | 173.6 KB | eb050994 2026-10-16 | eb050994 2026-10-16 | （目录级）handover-codex-20261019.md:66、design/pr8-responsive.md:5 文本提到 pr1–pr7 |
| `docs/design/pr2/before-workbench.png` | 163.0 KB | eb050994 2026-10-16 | eb050994 2026-10-16 | （目录级）handover-codex-20261019.md:66、design/pr8-responsive.md:5 文本提到 pr1–pr7 |
| `docs/design/pr3/after-home.png` | 97.6 KB | 45651d28 2026-10-16 | 45651d28 2026-10-16 | （目录级）handover-codex-20261019.md:66、design/pr8-responsive.md:5 文本提到 pr1–pr7 |
| `docs/design/pr3/before-home.png` | 90.1 KB | 45651d28 2026-10-16 | 45651d28 2026-10-16 | （目录级）handover-codex-20261019.md:66、design/pr8-responsive.md:5 文本提到 pr1–pr7 |
| `docs/design/pr4/after-list.png` | 38.9 KB | 5cfda616 2026-10-16 | 5cfda616 2026-10-16 | （目录级）handover-codex-20261019.md:66、design/pr8-responsive.md:5 文本提到 pr1–pr7 |
| `docs/design/pr4/after-picker.png` | 449.0 KB | 5cfda616 2026-10-16 | 5cfda616 2026-10-16 | （目录级）handover-codex-20261019.md:66、design/pr8-responsive.md:5 文本提到 pr1–pr7 |
| `docs/design/pr4/after-slots.png` | 654.8 KB | 5cfda616 2026-10-16 | 5cfda616 2026-10-16 | （目录级）handover-codex-20261019.md:66、design/pr8-responsive.md:5 文本提到 pr1–pr7 |
| `docs/design/pr4/after-task.png` | 555.6 KB | 5cfda616 2026-10-16 | 5cfda616 2026-10-16 | （目录级）handover-codex-20261019.md:66、design/pr8-responsive.md:5 文本提到 pr1–pr7 |
| `docs/design/pr4/before-task.png` | 408.9 KB | 5cfda616 2026-10-16 | 5cfda616 2026-10-16 | （目录级）handover-codex-20261019.md:66、design/pr8-responsive.md:5 文本提到 pr1–pr7 |
| `docs/design/pr5/after-settings.png` | 75.2 KB | 456efe0b 2026-10-16 | 456efe0b 2026-10-16 | （目录级）handover-codex-20261019.md:66、design/pr8-responsive.md:5 文本提到 pr1–pr7 |
| `docs/design/pr5/before-settings.png` | 63.2 KB | 456efe0b 2026-10-16 | 456efe0b 2026-10-16 | （目录级）handover-codex-20261019.md:66、design/pr8-responsive.md:5 文本提到 pr1–pr7 |
| `docs/design/pr6/after-home-700px.png` | 74.3 KB | b5abe6d9 2026-10-16 | b5abe6d9 2026-10-16 | （目录级）handover-codex-20261019.md:66、design/pr8-responsive.md:5 文本提到 pr1–pr7 |
| `docs/design/pr6/before-home-700px.png` | 81.0 KB | b5abe6d9 2026-10-16 | b5abe6d9 2026-10-16 | （目录级）handover-codex-20261019.md:66、design/pr8-responsive.md:5 文本提到 pr1–pr7 |
| `docs/design/pr7/after-3d.png` | 132.3 KB | 625a6580 2026-10-19 | 625a6580 2026-10-19 | （目录级）handover-codex-20261019.md:66、design/pr8-responsive.md:5 文本提到 pr1–pr7 |
| `docs/design/pr7/after-info-tab.png` | 110.1 KB | 625a6580 2026-10-19 | 625a6580 2026-10-19 | （目录级）handover-codex-20261019.md:66、design/pr8-responsive.md:5 文本提到 pr1–pr7 |
| `docs/design/pr7/after-narrow-1100px.png` | 45.9 KB | 625a6580 2026-10-19 | 625a6580 2026-10-19 | （目录级）handover-codex-20261019.md:66、design/pr8-responsive.md:5 文本提到 pr1–pr7 |
| `docs/design/pr7/after-plan-tab-history.png` | 107.4 KB | 625a6580 2026-10-19 | 625a6580 2026-10-19 | （目录级）handover-codex-20261019.md:66、design/pr8-responsive.md:5 文本提到 pr1–pr7 |
| `docs/design/pr7/before-3d.png` | 173.6 KB | 625a6580 2026-10-19 | 625a6580 2026-10-19 | （目录级）handover-codex-20261019.md:66、design/pr8-responsive.md:5 文本提到 pr1–pr7 |
| `docs/design/pr7/before-plan.png` | 140.2 KB | 625a6580 2026-10-19 | 625a6580 2026-10-19 | （目录级）handover-codex-20261019.md:66、design/pr8-responsive.md:5 文本提到 pr1–pr7 |
| `docs/design/pr8-responsive.md` | 4.7 KB | bf9e849e 2026-10-30 | bf9e849e 2026-10-30 | 无 |
| `docs/display-plan-requirements.md` | 27.2 KB | f13a5337 2026-10-12 | 5b63afd6 2026-10-16 | apps/api/src/modules/deliveries/service.ts、docs/README.md、docs/data-model.md、docs/requirements.md |
| `docs/display-tray-reconciliation-20261030.md` | 7.1 KB | ffb1e995 2026-10-30 | 765ace06 2026-10-30 | 无 |
| `docs/evidence/display-trays-20261030/resource-manifest.json` | 34.6 KB | ffb1e995 2026-10-30 | ffb1e995 2026-10-30 | 无 |
| `docs/evidence/resource-release-20261030.json` | 52.7 KB | 882d369e 2026-10-30 | 882d369e 2026-10-30 | docs/resource-release-20261030.md、resources.lock.json |
| `docs/handover-codex-20261019.md` | 11.9 KB | 27e2c3db 2026-10-19 | 5f4e6371 2026-10-19 | docs/collab-board.md |
| `docs/input-materials.md` | 1.3 KB | 7ab08a55 2026-09-24 | f1644663 2026-10-09 | docs/README.md、docs/architecture-review-20261013.md |
| `docs/irregular-shop-phase2-plan.md` | 9.3 KB | c634c0b0 2026-10-15 | dbcd9ee3 2026-10-15 | docs/irregular-shop-plan.md、docs/requirements.md |
| `docs/irregular-shop-phase3-plan.md` | 15.8 KB | 67ba0dab 2026-10-16 | 8f2c98d2 2026-10-16 | docs/handover-codex-20261019.md、docs/irregular-shop-plan.md、docs/requirements.md |
| `docs/irregular-shop-plan.md` | 9.3 KB | 051a5965 2026-10-14 | 67ba0dab 2026-10-16 | docs/irregular-shop-phase2-plan.md、docs/irregular-shop-phase3-plan.md、docs/requirements.md、packages/shared/src/planner/real-shapes.fixture.ts、packages/shared/src/planner/shapes.fixture.ts |
| `docs/lightbox-wall-art.md` | 2.7 KB | 90243b71 2026-10-30 | 90243b71 2026-10-30 | 无 |
| `docs/model-publication/20261030/advertising/README.md` | 2.0 KB | 04d9eed3 2026-10-30 | 04d9eed3 2026-10-30 | 无 |
| `docs/model-publication/20261030/advertising/asset-patches.json` | 56.7 KB | 04d9eed3 2026-10-30 | 04d9eed3 2026-10-30 | docs/model-publication/20261030/advertising/README.md（同目录） |
| `docs/model-publication/20261030/advertising/files.json` | 13.2 KB | 04d9eed3 2026-10-30 | 04d9eed3 2026-10-30 | docs/model-publication/20261030/advertising/README.md（同目录） |
| `docs/model-publication/20261030/advertising/publisher-validation.json` | 274 B | 04d9eed3 2026-10-30 | 04d9eed3 2026-10-30 | 无 |
| `docs/model-publication/20261030/advertising/sources.json` | 1.9 KB | 04d9eed3 2026-10-30 | 04d9eed3 2026-10-30 | docs/model-publication/20261030/advertising/README.md（同目录） |
| `docs/model-publication/20261030/advertising/validation.json` | 1.0 KB | 04d9eed3 2026-10-30 | 04d9eed3 2026-10-30 | docs/model-publication/20261030/advertising/README.md（同目录） |
| `docs/model-publication/20261030/nonstandard/README.md` | 2.1 KB | b6160262 2026-10-30 | b6160262 2026-10-30 | 无 |
| `docs/model-publication/20261030/nonstandard/asset-patches.json` | 24.6 KB | b6160262 2026-10-30 | b6160262 2026-10-30 | docs/model-publication/20261030/nonstandard/README.md（同目录） |
| `docs/model-publication/20261030/nonstandard/files.json` | 11.2 KB | b6160262 2026-10-30 | b6160262 2026-10-30 | docs/model-publication/20261030/nonstandard/README.md（同目录） |
| `docs/model-publication/20261030/nonstandard/publisher-validation.json` | 274 B | b6160262 2026-10-30 | b6160262 2026-10-30 | 无 |
| `docs/model-publication/20261030/nonstandard/sources.json` | 1.7 KB | b6160262 2026-10-30 | b6160262 2026-10-30 | docs/model-publication/20261030/nonstandard/README.md（同目录） |
| `docs/model-publication/20261030/nonstandard/validation.json` | 1.0 KB | b6160262 2026-10-30 | b6160262 2026-10-30 | docs/model-publication/20261030/nonstandard/README.md（同目录） |
| `docs/model-publication/20261030/s2/README.md` | 2.1 KB | 7c93c635 2026-10-30 | 7c93c635 2026-10-30 | tools/su-convert/README.md |
| `docs/model-publication/20261030/s2/asset-patches.json` | 2.9 KB | 7c93c635 2026-10-30 | 7c93c635 2026-10-30 | docs/model-publication/20261030/s2/README.md（同目录） |
| `docs/model-publication/20261030/s2/files.json` | 4.0 KB | 7c93c635 2026-10-30 | 7c93c635 2026-10-30 | docs/model-publication/20261030/s2/README.md（同目录） |
| `docs/model-publication/20261030/s2/publisher-validation.json` | 274 B | 7c93c635 2026-10-30 | 7c93c635 2026-10-30 | 无 |
| `docs/model-publication/20261030/s2/sources.json` | 761 B | 7c93c635 2026-10-30 | 7c93c635 2026-10-30 | docs/model-publication/20261030/s2/README.md（同目录） |
| `docs/model-publication/20261030/s2/validation.json` | 955 B | 7c93c635 2026-10-30 | 7c93c635 2026-10-30 | docs/model-publication/20261030/s2/README.md（同目录） |
| `docs/model-review-20261030.md` | 2.3 KB | 9f0becd0 2026-10-30 | 9f0becd0 2026-10-30 | 无 |
| `docs/onedrive-resources.md` | 5.1 KB | 02c3b793 2026-10-29 | 98bda172 2026-10-30 | README.md、docs/collab-board.md、docs/sync-and-collaboration.md |
| `docs/pdf-cleaning.md` | 10.4 KB | 9eebcb4c 2026-09-26 | 5c3214a1 2026-10-08 | docs/README.md、docs/architecture-review-20261013.md、docs/archive/INDEX.md、docs/store-drawing-archive-plan.md、tools/store-archive/register_legacy.py |
| `docs/requirements.md` | 18.7 KB | 582413cf 2026-10-09 | 40104bbe 2026-10-19 | README.md、apps/api/src/modules/deliveries/service.ts、docs/README.md、docs/architecture-review-20261013.md、docs/architecture.md、docs/data-model.md、docs/display-plan-requirements.md、docs/handover-codex-20261019.md、docs/store-drawing-archive-plan.md |
| `docs/resource-release-20261030.md` | 2.1 KB | 882d369e 2026-10-30 | 882d369e 2026-10-30 | 无 |
| `docs/reviews/model-review-20261030.json` | 5.5 KB | 9f0becd0 2026-10-30 | 9f0becd0 2026-10-30 | docs/model-review-20261030.md、packages/shared/src/catalog/availability.ts |
| `docs/si-source-recovery.md` | 5.4 KB | 9eebcb4c 2026-09-26 | 5c3214a1 2026-10-08 | docs/README.md、docs/architecture-review-20261013.md、docs/archive/INDEX.md、docs/pdf-cleaning.md、docs/store-drawing-archive-plan.md、tools/store-archive/register_legacy.py |
| `docs/si-standards-review-20261001.md` | 14.2 KB | 20ed7a9b 2026-10-08 | 9df76327 2026-10-10 | docs/README.md、docs/archive/INDEX.md、docs/store-drawing-archive-plan.md、tools/library/refresh-library.mjs、tools/store-archive/extract_text_evidence.py |
| `docs/store-drawing-archive-plan.md` | 63.3 KB | 83cca148 2026-10-12 | 66cd8abb 2026-10-19 | .gitignore、docs/README.md、docs/architecture-review-20261013.md、docs/collab-board.md、docs/handover-codex-20261019.md、tools/store-archive/README.md、tools/store-archive/register_legacy.py |
| `docs/sync-and-collaboration.md` | 1.9 KB | （重命名而来） | 02c3b793 2026-10-29 | README.md、docs/README.md、docs/architecture-review-20261013.md |

## 附录 D tools 逐文件

建议按 §3.2 的分组处理，本表是逐文件证据。“被引用”按文件名或导入路径搜索，不含自身和 `tools/data-cleaning`；`data-cleaning` 按二级目录汇总。

| 文件 | 大小 | 最后修改 | 名称或导入被引用（不含自身与 data-cleaning） | data-cleaning 内引用 |
|---|---|---|---|---|
| `tools/connect-onedrive-resources.ps1` | 2.1 KB | 02c3b793 2026-10-29 | docs/collab-board.md、docs/onedrive-resources.md | 0 |
| `tools/library/apply-selection-table.mjs` | 4.8 KB | e7351073 2026-10-10 | package.json、tools/library/selection-rows.mjs | 0 |
| `tools/library/build-selection-table.mjs` | 4.5 KB | e7351073 2026-10-10 | package.json、tools/library/selection-rows.mjs | 0 |
| `tools/library/cutout-photo.mjs` | 7.2 KB | e7351073 2026-10-10 | docs/architecture-review-20261013.md | 0 |
| `tools/library/refresh-library.mjs` | 15.7 KB | d4b22de3 2026-10-10 | docs/architecture-review-20261013.md、docs/archive/INDEX.md、package.json、tools/library/selection-rows.mjs | 0 |
| `tools/library/selection-rows.mjs` | 4.5 KB | e7351073 2026-10-10 | tools/library/apply-selection-table.mjs、tools/library/build-selection-table.mjs | 0 |
| `tools/resource-library/export_store_pdfs.py` | 4.3 KB | 5c3214a1 2026-10-08 | **无** | 1 |
| `tools/resource-library/paths.mjs` | 659 B | f1644663 2026-10-09 | tools/su-convert/README.md、tools/su-convert/scripts/compress-glb.mjs、tools/su-convert/scripts/convert-su-assets.mjs、tools/su-convert/scripts/extract-training-stool.mjs、tools/su-convert/scripts/render-glb-review.mjs | 0 |
| `tools/resource-library/requirements.txt` | 15 B | 5c3214a1 2026-10-08 | （通用文件名，见正文） | 0 |
| `tools/resource-library/selection.example.json` | 168 B | 5c3214a1 2026-10-08 | **无** | 0 |
| `tools/resource_library.py` | 636 B | f1644663 2026-10-09 | docs/architecture-review-20261013.md、tools/resource-library/export_store_pdfs.py（import）、tools/training/audit-corpus.py（import）、tools/training/clean-pdfs.py（import） | 5 |
| `tools/sketchup/README.md` | 2.7 KB | 842554de 2026-10-13 | （通用文件名，见正文） | 0 |
| `tools/sketchup/collect-hardware.ps1` | 1.2 KB | a3a63168 2026-09-24 | tools/sketchup/handoff/Insta360-SU-kit-v1.zip、tools/sketchup/另一台电脑操作说明.md | 0 |
| `tools/sketchup/export_selected.rb` | 3.3 KB | a3a63168 2026-09-24 | tools/sketchup/README.md、tools/sketchup/handoff/Insta360-SU-kit-v1.zip、tools/sketchup/另一台电脑操作说明.md、tools/su-convert/README.md | 0 |
| `tools/sketchup/handoff/Insta360-SU-kit-v1.zip` | 6.1 KB | 5c3214a1 2026-10-08 | tools/sketchup/README.md | 0 |
| `tools/sketchup/inspect_archive.py` | 4.2 KB | 9df76327 2026-10-10 | docs/architecture-review-20261013.md | 0 |
| `tools/sketchup/另一台电脑操作说明.md` | 4.0 KB | 5c3214a1 2026-10-08 | tools/sketchup/README.md、tools/sketchup/handoff/Insta360-SU-kit-v1.zip | 0 |
| `tools/store-archive/README.md` | 4.0 KB | c53860b5 2026-10-16 | （通用文件名，见正文） | 0 |
| `tools/store-archive/build_gold.py` | 22.5 KB | 362bd9d6 2026-10-19 | docs/store-drawing-archive-plan.md、tools/store-archive/README.md | 0 |
| `tools/store-archive/build_sources.py` | 10.3 KB | afb90ade 2026-10-13 | docs/architecture-review-20261013.md、tools/store-archive/README.md | 0 |
| `tools/store-archive/build_stores.py` | 23.0 KB | cb6bb9b1 2026-10-14 | tools/store-archive/README.md、tools/store-archive/classify_pages.py、tools/store-archive/extract_text_evidence.py | 0 |
| `tools/store-archive/classify_pages.py` | 15.5 KB | f87cfd39 2026-10-14 | tools/store-archive/README.md、tools/store-archive/build_stores.py、tools/store-archive/extract_page_features.py、tools/store-archive/read_bom.py | 0 |
| `tools/store-archive/common.py` | 2.4 KB | 7d3c58d7 2026-10-12 | tools/store-archive/build_gold.py（import）、tools/store-archive/build_sources.py（import）、tools/store-archive/build_stores.py（import）、tools/store-archive/classify_pages.py（import）、tools/store-archive/extract_page_features.py（import）、tools/store-archive/extract_text_evidence.py（import）、tools/store-archive/gold_crop.py（import）、tools/store-archive/gold_overlay.py（import）、tools/store-archive/gold_review.py（import）、tools/store-archive/ocr_title_blocks.py（import）、tools/store-archive/read_bom.py（import）、tools/store-archive/register_legacy.py（import）、tools/store-archive/score_drafts.py（import）、tools/store-archive/thumb_features.py（import）、tools/store-archive/verify_backup.py（import） | 3 |
| `tools/store-archive/draft_gold.ts` | 5.3 KB | c53860b5 2026-10-16 | tools/store-archive/README.md、tools/store-archive/gold_crop.py、tools/store-archive/gold_overlay.py、tools/store-archive/score_drafts.py | 0 |
| `tools/store-archive/extract_page_features.py` | 5.4 KB | bcd77b20 2026-10-14 | tools/store-archive/README.md、tools/store-archive/classify_pages.py | 0 |
| `tools/store-archive/extract_text_evidence.py` | 3.8 KB | e3b37dc2 2026-10-13 | tools/store-archive/README.md、tools/store-archive/build_stores.py | 0 |
| `tools/store-archive/gold_crop.py` | 2.2 KB | d97417ac 2026-10-15 | tools/store-archive/README.md | 0 |
| `tools/store-archive/gold_overlay.py` | 4.4 KB | d7213fbc 2026-10-15 | tools/store-archive/README.md | 0 |
| `tools/store-archive/gold_review.py` | 10.0 KB | a598d523 2026-10-15 | tools/store-archive/README.md | 0 |
| `tools/store-archive/ocr_title_blocks.py` | 5.5 KB | bcd77b20 2026-10-14 | tools/store-archive/README.md | 0 |
| `tools/store-archive/read_bom.py` | 8.1 KB | bcd77b20 2026-10-14 | tools/store-archive/README.md | 0 |
| `tools/store-archive/register_legacy.py` | 12.1 KB | afb90ade 2026-10-13 | docs/architecture-review-20261013.md、docs/archive/INDEX.md、tools/store-archive/README.md | 0 |
| `tools/store-archive/requirements.txt` | 76 B | bcd77b20 2026-10-14 | （通用文件名，见正文） | 0 |
| `tools/store-archive/score_drafts.py` | 4.4 KB | c53860b5 2026-10-16 | docs/irregular-shop-phase3-plan.md、tools/store-archive/README.md | 0 |
| `tools/store-archive/thumb_features.py` | 2.7 KB | bcd77b20 2026-10-14 | tools/store-archive/README.md | 0 |
| `tools/store-archive/verify_backup.py` | 2.3 KB | 7d3c58d7 2026-10-12 | tools/store-archive/README.md | 0 |
| `tools/su-convert/README.md` | 3.1 KB | 7c93c635 2026-10-30 | （通用文件名，见正文） | 0 |
| `tools/su-convert/index.html` | 151 B | 842554de 2026-10-13 | （通用文件名，见正文） | 0 |
| `tools/su-convert/package-lock.json` | 61.9 KB | 842554de 2026-10-13 | （通用文件名，见正文） | 0 |
| `tools/su-convert/package.json` | 684 B | 842554de 2026-10-13 | （通用文件名，见正文） | 0 |
| `tools/su-convert/scripts/compress-glb.mjs` | 5.4 KB | 842554de 2026-10-13 | tools/su-convert/README.md、tools/su-convert/package.json | 0 |
| `tools/su-convert/scripts/convert-su-assets.mjs` | 7.1 KB | 842554de 2026-10-13 | tools/su-convert/README.md、tools/su-convert/package.json | 0 |
| `tools/su-convert/scripts/extract-training-stool.mjs` | 6.1 KB | 7c93c635 2026-10-30 | tools/su-convert/README.md | 0 |
| `tools/su-convert/scripts/render-glb-review.mjs` | 6.0 KB | 842554de 2026-10-13 | tools/su-convert/README.md、tools/su-convert/package.json | 0 |
| `tools/su-convert/server/model-library-paths.mjs` | 996 B | 842554de 2026-10-13 | tools/su-convert/README.md、tools/su-convert/scripts/compress-glb.mjs、tools/su-convert/scripts/convert-su-assets.mjs、tools/su-convert/scripts/extract-training-stool.mjs、tools/su-convert/scripts/render-glb-review.mjs | 0 |
| `tools/su-convert/src/asset-normalization.js` | 1.5 KB | 842554de 2026-10-13 | tools/su-convert/README.md、tools/su-convert/scripts/convert-su-assets.mjs | 0 |
| `tools/su-convert/vite.config.js` | 301 B | 842554de 2026-10-13 | （通用文件名，见正文） | 0 |
| `tools/training/.gitignore` | 40 B | 7ab08a55 2026-09-24 | （通用文件名，见正文） | 0 |
| `tools/training/README.md` | 3.5 KB | 5c3214a1 2026-10-08 | （通用文件名，见正文） | 0 |
| `tools/training/audit-corpus.py` | 10.8 KB | f1644663 2026-10-09 | tools/training/audit-corpus.test.py | 0 |
| `tools/training/audit-corpus.test.py` | 1.9 KB | 20ed7a9b 2026-10-08 | **无** | 0 |
| `tools/training/build-clean-catalog.py` | 9.0 KB | 5c3214a1 2026-10-08 | docs/pdf-cleaning.md、tools/training/build-clean-catalog.test.py | 0 |
| `tools/training/build-clean-catalog.test.py` | 2.1 KB | 20ed7a9b 2026-10-08 | **无** | 0 |
| `tools/training/build-report.mjs` | 4.0 KB | 5c3214a1 2026-10-08 | **无** | 0 |
| `tools/training/clean-pdfs.py` | 23.8 KB | 5c3214a1 2026-10-08 | docs/pdf-cleaning.md、tools/training/clean-pdfs.test.py、tools/training/recheck-clean-pages.py | 0 |
| `tools/training/clean-pdfs.test.py` | 5.8 KB | f1644663 2026-10-09 | **无** | 0 |
| `tools/training/layout-model.mjs` | 2.3 KB | 7ab08a55 2026-09-24 | tools/training/layout-model.test.mjs、tools/training/train-layout.mjs | 0 |
| `tools/training/layout-model.test.mjs` | 876 B | 7ab08a55 2026-09-24 | tools/training/README.md、tools/training/run-local.ps1 | 0 |
| `tools/training/prepare-layout.mjs` | 3.9 KB | 5c3214a1 2026-10-08 | tools/training/README.md、tools/training/run-local.ps1 | 0 |
| `tools/training/prepare-style.py` | 3.1 KB | 5c3214a1 2026-10-08 | tools/training/README.md、tools/training/run-local.ps1 | 0 |
| `tools/training/recheck-clean-pages.py` | 2.7 KB | 5c3214a1 2026-10-08 | docs/pdf-cleaning.md | 0 |
| `tools/training/requirements-lock.txt` | 564 B | 7ab08a55 2026-09-24 | tools/training/README.md | 0 |
| `tools/training/requirements-pdf-clean.txt` | 61 B | 20ed7a9b 2026-10-08 | docs/pdf-cleaning.md | 0 |
| `tools/training/requirements.txt` | 119 B | 7ab08a55 2026-09-24 | （通用文件名，见正文） | 0 |
| `tools/training/run-local.ps1` | 1.0 KB | 7ab08a55 2026-09-24 | tools/training/README.md | 0 |
| `tools/training/style-preprocessing.test.py` | 4.6 KB | 20ed7a9b 2026-10-08 | **无** | 0 |
| `tools/training/style_preprocessing.py` | 2.8 KB | 20ed7a9b 2026-10-08 | tools/training/style-preprocessing.test.py | 0 |
| `tools/training/train-layout.mjs` | 1.1 KB | 5c3214a1 2026-10-08 | docs/architecture-review-20261013.md、tools/training/README.md、tools/training/run-local.ps1 | 0 |
| `tools/training/train-style.py` | 8.9 KB | 5c3214a1 2026-10-08 | tools/training/README.md、tools/training/run-local.ps1、tools/training/train-style.test.py | 0 |
| `tools/training/train-style.test.py` | 3.9 KB | 20ed7a9b 2026-10-08 | **无** | 0 |
| `tools/training/validate-training.py` | 2.1 KB | 5c3214a1 2026-10-08 | **无** | 0 |
| `tools/training/verify-clean-pdfs.py` | 4.6 KB | 5c3214a1 2026-10-08 | docs/pdf-cleaning.md | 0 |
| `tools/training/verify-report.mjs` | 1.1 KB | 5c3214a1 2026-10-08 | **无** | 0 |

| data-cleaning 子项 | 文件数 | 大小 | 最后修改 |
|---|---|---|---|
| `tools/data-cleaning/README.md` | 1 | 8.1 KB | f1644663 2026-10-09 |
| `tools/data-cleaning/artifact_manifest.py` | 1 | 1.2 KB | f1644663 2026-10-09 |
| `tools/data-cleaning/build_report.py` | 1 | 19.2 KB | f1644663 2026-10-09 |
| `tools/data-cleaning/final_audit.py` | 1 | 6.0 KB | f1644663 2026-10-09 |
| `tools/data-cleaning/full-run-02/` | 45 | 169.9 KB | 3f69f9dd 2026-10-09 |
| `tools/data-cleaning/geometry3.py` | 1 | 13.7 KB | 9df76327 2026-10-10 |
| `tools/data-cleaning/geometry4.py` | 1 | 1.4 KB | f1644663 2026-10-09 |
| `tools/data-cleaning/geometry5.py` | 1 | 1.3 KB | f1644663 2026-10-09 |
| `tools/data-cleaning/geometry6.py` | 1 | 1.6 KB | f1644663 2026-10-09 |
| `tools/data-cleaning/geometry7.py` | 1 | 1.4 KB | f1644663 2026-10-09 |
| `tools/data-cleaning/geometry8.py` | 1 | 2.3 KB | f1644663 2026-10-09 |
| `tools/data-cleaning/geometry9.py` | 1 | 1.3 KB | f1644663 2026-10-09 |
| `tools/data-cleaning/inspect_dimensions.py` | 1 | 857 B | f1644663 2026-10-09 |
| `tools/data-cleaning/inspect_vectors.py` | 1 | 730 B | f1644663 2026-10-09 |
| `tools/data-cleaning/inventory_review.py` | 1 | 3.5 KB | f1644663 2026-10-09 |
| `tools/data-cleaning/light-api-publish-01/` | 1 | 4.5 KB | b1c84070 2026-10-09 |
| `tools/data-cleaning/light-handoff-20261009-01/` | 254 | 8117.1 KB | 3f69f9dd 2026-10-09 |
| `tools/data-cleaning/method-comparison-01/` | 4 | 22.3 KB | f1644663 2026-10-09 |
| `tools/data-cleaning/package_pilot.py` | 1 | 19.2 KB | f1644663 2026-10-09 |
| `tools/data-cleaning/pipeline.py` | 1 | 8.3 KB | f1644663 2026-10-09 |
| `tools/data-cleaning/render_contact.py` | 1 | 745 B | f1644663 2026-10-09 |
| `tools/data-cleaning/render_review_queue.py` | 1 | 1.9 KB | f1644663 2026-10-09 |
| `tools/data-cleaning/requirements.txt` | 1 | 59 B | f1644663 2026-10-09 |
| `tools/data-cleaning/revision2.py` | 1 | 3.4 KB | f1644663 2026-10-09 |
| `tools/data-cleaning/source-release-20261009-01/` | 9 | 40.4 KB | b1c84070 2026-10-09 |

## 附录 E 命令与脚本

扫描和统计脚本都在仓库外：`%TEMP%\prune-tools`、`%TEMP%\prune-tools2`、`%TEMP%\prune-tools3`；中间数据在 `%TEMP%\prune-review`。

```bash
# 代码层
npx knip --directory "<worktree>" --config "%TEMP%/prune-tools/knip.json" --no-progress --no-exit-code --reporter json
npx depcheck "<worktree>/<workspace>" --json
npx madge --circular --extensions ts,tsx --ts-config <ws>/tsconfig.json <ws>/src
npx jscpd -f typescript,tsx -i "**/node_modules/**,**/schema.d.ts,**/migrations/**,**/dist/**,**/openapi.json" apps/api apps/web packages/shared database
pnpm exec tsc -p <ws>/tsconfig.json --noEmit --noUnusedLocals --noUnusedParameters

# LFS
git lfs prune --dry-run --verbose
git lfs prune --dry-run --verify-remote --verify-unreachable --verbose
git fsck --unreachable --no-reflogs --no-progress
git cat-file --batch-all-objects --batch-check='%(objectname) %(objecttype) %(objectsize)'   # 找出全部 LFS 指针
git rev-list --all --objects                                                                  # 可达对象
git log --branches --not --remotes                                                            # 未推送提交

# 推送用裸仓库：不在 GitHub 上的提交（prune 前必查）
git -C "%LOCALAPPDATA%/store-design-push.git" rev-list <裸仓库各分支> --not <主仓库全部 origin/* 提交>

# worktree
git -C <wt> --no-optional-locks status --porcelain --ignored
git worktree list --porcelain
```

LFS 远端核对用 GitHub LFS 批量接口：`POST https://github.com/<仓库>.git/info/lfs/objects/batch`，`operation: download`，令牌取自 `gh auth token`，不打印、不落盘。

**恢复方式汇总**：

| 对象 | 恢复方式 |
|---|---|
| worktree | 分支仍在：`git worktree add "D:/text demo-worktrees/<名>" <分支>` |
| 本地分支 | `git branch <分支> <提交号>`；提交仍在 main 历史或 GitHub 上 |
| 远程分支 | GitHub PR 页面的“恢复分支”按钮，或 `git push origin <提交号>:refs/heads/<分支>`（提交号见附录 B） |
| LFS 对象 | `git lfs fetch origin <分支或标签>`；孤儿对象只能从隔离目录放回 `.git/lfs/objects/<前2位>/<3-4位>/<oid>` |
| 阶段 2 归档的文件 | `git checkout archive/pre-prune-20261102 -- <路径>`（阶段 2 建标签后生效） |
