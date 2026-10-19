# Codex 交接说明（2026-10-19 起草）

> 本文件用于把本项目从 Claude 多窗口协作交接给 Codex。交接前由秘书窗口补全“最终状态”。
> 先读根目录 [AGENTS.md](../AGENTS.md) 和 [CLAUDE.md](../CLAUDE.md)：提交、PR、合并说明一律用简体中文。

## 1. 快速开始

```bash
cd "D:/text demo"
git pull origin main
pnpm install
pnpm db:migrate
pnpm catalog:import
pnpm dev            # 网页 http://127.0.0.1:5173，接口 http://127.0.0.1:3001
```

- 模型库首次或模型更新后：`pnpm catalog:finish`（生成材质轻量版）→ `pnpm catalog:import`。
- 展陈规则更新后：`pnpm display:import`。
- 展陈真实桌体重新生成：`pnpm display:bodies`（仅模型更新后需要）。
- 测试：`pnpm test`（shared / web / api / database 分工作区）。

## 2. 技术栈与目录

- Monorepo：pnpm workspace。`apps/web`（React + Vite + three.js）、`apps/api`（Fastify + Drizzle + PGlite）、`packages/shared`（规则与几何）。
- 数据：本地 PGlite，数据库文件在 `data/pglite`（不入库，可删除重建后跑 `pnpm db:migrate`）。
- 模型：Git LFS 存 SketchUp/GLB；材质轻量版 `finish.glb` 每台机器生成，不进 Git。
- 资源库：`资源库/` 下 01_各门店原图纸、02_各门店平面图、03_各门店效果图、04_模型库、08-skill、09_门店档案、10_产品与陈列、11_logo。
- 文档：`docs/`，其中 `docs/requirements.md`、`docs/architecture.md`、`docs/design-system.md`、`docs/irregular-shop-phase*.md` 是关键背景。

## 3. 当前模块状态（交接时补全）

| 模块 | 状态 |
|---|---|
| 空间 / 方案 / 三维 / 渲染 / 交付 | 可用；支持墙面安装、内嵌、方案阶段改墙、空心隔板、任意角度旋转、双 PDF 交付 |
| 自动排布 | 中岛店自动放矮边柜（参数集中 `packages/shared/src/planner/side-cabinet-rules.ts`，可按统计整套替换）；支持斜墙 |
| 异形店第三阶段识别 | 本地识别已接：描点、多边形/弧线、尺寸链 OCR、道具对应、整页 OCR；剩余开口闭合、图片/扫描件 OCR（见待办） |
| 门店图纸金标准 | 45 家收尾中（第 8 批完成 40 家，最后 5 家在做） |
| 展陈方案 | 规则、PPT、上传入口、三维桌体、真实桌体与材质已完成；待命 |
| UI 改版 | 影石品牌风格 7 批已合并（tokens、基础组件、首页、展陈页、工作台版面等）；后续细修清单见第 5 节 |
| 系统测试 | 回归脚本与 SI 切换复测脚本在 `C:\Users\insta360\AppData\Local\store-design-regression\si-1019\` |

## 4. 交接前必须完成的三件事（由 Claude 收尾）

1. **UI 工作台版面 PR #128**：已合并（d59fb332）。
2. **SI 切换两个 bug**：分支 `fix/si-switch-followups`（工作区 `D:/text demo-worktrees/si-fix`）。修复点：①在 B 上修改后切换，B 的修改不能丢（切换前保存草稿）；②三维节点换款越界时不能误报成功，建议按用户规则“换家具不管碰撞、只提醒”。
3. **金标准最后 5 家**：郑州正弘城、深业上城、杭州大悦城悦街、江西赣州、南宁万象城，完成后开 PR。

三项合并后：更新主工作区 → 跑全量测试 → 系统测试师复测 SI 8 条规则 → 本文件补“最终状态”。

## 5. 交接后的待办清单

### 识别（架构窗口遗留）
- 修复 NEW-095（有开口的圆形岛店）、PDF-293 边界不闭合：先做开口闭合再复评。
- 图片和扫描件（约 4%）：整页 OCR + 描点，道具人工摆放；云端视觉识别保留为默认关闭开关（`recognitionCloud`），打开前提示会发到外部。
- 训练路线：见 `docs/irregular-shop-phase3-plan.md`；训练数据由 `tools/recognition-training/` 生成，在 RTX 4070 / 双 RTX 4500 电脑上用 DeepSeek/GPT 按 README 跑，不依赖 Claude；目标矢量页合格率 ≥97%、图片扫描 ≥80%。

### UI 细修（UI 设计师清单，按优先级）
1. 渲染阶段：大图/缩略图条仍是旧冷灰底 #e8eaed 与旧按钮样式；统一渲染进度、过期标记、重新渲染、查看大图到品牌风格。**不要动** `plan-spacing`、`plan-resize-handle`、`plan-fixture`、`plan-embedded`、`plan-mounted` 类名和平面导出 CSS（含 `paint-order: stroke`）。
2. 交付前端：PDF/PPT 选项、下载、进度面板未细修，按钮权重和卡片与其它页面不一致。
3. 识别界面（RecognitionPanel）：用户记过“不好看”，属识别模块，改动前先和识别负责人确认。
4. 径向历史树在 300px 左栏仍需横向滚动：可选栏内缩适配、放大看全图、或左栏可拖宽（交互改动，需用户拍板）。
5. SpaceEditor、新建空间、候选方案图库（CandidateGallery）、AgentDock、ModelPicker 分组标题仍是旧样式。
6. 设置页模型下拉仍是原生 select，可统一控件样式（不改保存逻辑）。
7. <900px 平板竖屏右栏过长，可加折叠。
8. 空状态（无项目/无展陈方案/回收站为空）文案与排版统一。
- 截图：`docs/design/pr1`–`pr7`；设计规范：`docs/design-system.md`；样式入口：`tokens.css` / `app.css` / `workbench.css` / `display.css`；历史树外观在 `tree-layout.ts` 的 `TREE_STYLE` 与 `RADIAL_STYLE`。
- 品牌黄 `#FFD200` 是官网样式表采样值，不是官方规范；用户有正式规范时以用户为准。

### 金标准与图纸
- 45 家满额后，坐凳规则、橱窗地台、后场处理待用户答复（见第 6 节）。
- 45 家只做验收测试集；开发集为 3b 抽审的 40–50 家，不向开发窗口提供逐店分数。

### 展陈
- 待命：本地识别达标后，把展陈图片识别改为本地并受云端开关约束（用户已定）。
- “指引第四节”已取消；“完整版 PDF 收录展陈”暂缓，需求已记录。

## 6. 待用户确认的问题（交接时随最终状态更新）

- **S1–S3（培训坐凳）**：S1 按图拆单件（推荐）；S2 补单凳模型（约 450×450，H350/H450，推荐补）；S3 组合款保留但默认不用（推荐）。
- **W1（橱窗地台）**：是否计入可用面积，推荐不计入（保持扣掉）。
- **H1–H3（后场）**：H1 只出平面和排布避让（推荐）；H2 先记标签和备注、不单独建门（推荐）；H3 取吊顶高、读不出按 3 m（推荐）。
- **金标准第 8 批**：审核页 `D:\text demo-worktrees\drawing-archive-plan\资源库\09_门店档案\_cache\审核\金标准审核-第8批.html`。

## 7. 环境与坑

- **不能直接在 `D:/text demo` 切分支或提交**（用户会在主工作区运行 dev）。开发用 git worktree：`git worktree add D:/text demo-worktrees/<名> -b <分支> origin/main`。主目录不提交、不切分支。
- **推送**：直接 `git push` 会失败，用 `bash "$LOCALAPPDATA/store-design-push.sh" <分支>`。
- **LFS**：`.ai`、`.pdf`、`.glb`、`.jpg` 等走 LFS；新机器 `git lfs pull`。`finish.glb` 不进 Git，每台机器 `pnpm catalog:finish`。
- **停开发服务**：必须按进程树停 pnpm 父进程；只停监听端口的子进程不够，`--watch` 会把接口重新拉起。PowerShell 按 CommandLine 找 `filter @store/api dev` 再 `taskkill /T`。
- **PGlite**：进程被强杀会损坏，测试库可删 `data/pglite` 后重建；机器忙时 api 测试偶发整组跳过（启动超 60 s），重跑即过。
- **Node**：本机 Python 是空壳，脚本用 Node。Git Bash 用 curl 发中文会乱码，改用 `node fetch`。
- **浏览器核对**：`playwright-core` + 本机 Chrome，脚本在 `%TEMP%/wb-driver`；项目测试服务建议用独立端口和独立 PGlite，不要动主工作区 5173/3001。
- **迁移编号**：最新已用到 0016；新迁移从 0017 起，两个窗口同时开发时谁后合并谁改号。
- **密钥**：根目录 `.env`（不入库）含 DeepSeek、DashScope 等；不要把密钥写进仓库、文档或聊天记录。

## 8. 协作规则

- 中文提交标题格式“类型(范围)：具体改动”；类型用新增/修复/优化/重构/文档/测试/维护/合并/回退。
- 每个功能一个分支、一个 PR；CI 通过后合并，合并说明用中文写清改动、原因、验证方法和已知限制。
- 不改写已推送历史、不强推；已推送分支用“把 main 合入分支”解决冲突。
- 不改动他人（其他窗口）正在改的文件；共用文件（Workbench、PlanView、editor-state、white-scene、deliveries、PlanEditor）改动前先协调。
- 用户未回答的问题按推荐执行前，先确认没有相反指示；重大行为改变先问用户。

## 9. 交接检查表（交接当天执行）

- [ ] 三个收尾 PR 已合并，无开放 PR
- [ ] 所有分支已推送、无未提交改动
- [ ] 主工作区更新到最新 main，`pnpm install` / `db:migrate` / `catalog:import` 完成
- [ ] 全量测试通过
- [ ] SI 8 条规则复测通过
- [ ] 关闭全部 Claude 窗口，停掉后台 dev
- [ ] 清理已合并的 worktree（清单见 `docs/` 或秘书记录）
- [ ] 本文件补“最终状态”，并转成 GitHub Issues 作为任务清单
- [ ] 把 Claude 记忆中的关键结论归档进 `docs/`（本文件第 5、7 节已覆盖大部分）

---

**最终状态（交接时补）：** 待填。
