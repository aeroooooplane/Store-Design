# 架构评审与清理盘点（2026-10-13，第 0 阶段）

基线：`origin/main` f2c507b3（合并 PR #45）。本阶段只读：没有改动代码、数据和本地数据库；浏览器测量拦截了所有非 GET 请求，没有写入任何数据。下文所有“行号”均以该基线为准。

## 0. 结论摘要

1. **项目健康度良好。**
   - `pnpm check` 和 `pnpm format:check` 全部通过，测试 264 个全部通过：shared 73、database 7、web 80、api 104，耗时 88 秒。
   - 只有 2 处循环依赖，且都可以消除。
   - 字面重复只占 0.58%（12 处）。
   - 问题主要是**同一条规则写了多份**（语义重复）和**少数超大文件**，没有架构性缺陷。
2. **最大的浪费在上下文，而不在代码。**
   - 真正需要读的源码约 2.2 万行，约 25 万 token。
   - 仓库里入库的数据类文本约 4000 万 token，主要在 `资源库/90_处理过程与审核`、`资源库/00_资源索引/历史目录`、`tools/data-cleaning`。
   - 生成文件 `openapi.json`、`schema.d.ts` 和迁移快照合计约 50 万 token。
   - 目前根目录没有 `.ignore`，全仓搜索会扫描所有这些内容。
   - 入口文档（根 README、docs/README、architecture.md）仍然把旧版 demo、不存在的 `services/worker` 和 `legacy/demo` 当作现状，会把 AI 引向错误的文件。
3. **实测发现两个真实的前端性能缺陷，都比预想的严重。**
   - **切换节点会泄漏 WebGL 上下文。** 每次切换都会新建渲染器，重新编译 21 个着色器程序，主线程卡 0.5–0.9 秒。连续切换约 16 次后，Chrome 报 “Too many active WebGL contexts. Oldest context will be lost.”，JS 堆从 31 MB 涨到 119 MB。
   - **“添加模型”列表直接加载效果图原图。** 打开一个三维效果节点共下载 63 MB，其中 35.7 MB 是 17 张效果图原图，每张 1.5–7.5 MB；模型本身只有 10.7 MB。
4. **API 不是瓶颈。** 按当前数据量，只读接口为 3–36 ms，`/assets` 约 20 ms。`catalogAssets` 每个请求都整表加载，这一点属实，但单次只有 10–20 ms，只在设计助理一轮多次调用工具时才会累积。
5. **遗留内容可以安全清理。**
   - 新系统在运行时不依赖 `demo/`。
   - 但 tools 下有 6 个脚本依赖它，其中 `tools/data-cleaning/geometry3.py:71` 属于门店图纸窗口，需要先协调。

## 1. 架构概要

### 1.1 包与依赖

```text
apps/web (9.1k 行 + CSS 1.4k) ──REST(/api/v1, openapi-fetch)──▶ apps/api (9.4k 行) ──▶ database (0.7k 行) ──▶ PGlite / PostgreSQL
      │                                                         │
      └──────────────▶ packages/shared (2.8k 行，zod + 纯函数) ◀──┘   （database 只引用 shared 的类型）
```

- 依赖方向符合文档：`web → shared`，`api → shared + database`，`database → shared`。shared 包里没有 DOM 和 Node API。
- **例外 1：跨应用导入。** `apps/web/src/scripts/local-regression.ts:14` 直接导入 `apps/api/src/modules/recognition/local.ts`。识别引擎是纯函数，却放在 api 里。
- **例外 2：循环依赖。** 有 2 处：
  - `api/modules/nodes/service.ts:27` ↔ `cameras/service.ts:16`
  - `web/workbench/Workbench.tsx` ↔ `PlanEditor.tsx:42`（只是类型导入，无害）

### 1.2 模块职责

| 层 | 模块 | 行数 | 职责 |
|---|---|---|---|
| api | recognition | 1994 | 上传、矢量规则识别（`local.ts`）、视觉模型识别（`llm.ts`）、校验（`check.ts`）、确认 |
| api | agent | 1447 | 会话、工具调用循环（`service.ts`）、16 个工具（`tools.ts`） |
| api | assets | 1091 | 模型目录查询、导入（`importer.ts`）、白模与材质轻量版构建 |
| api | deliveries | 749 | 双 PDF、ZIP、归档（展陈方案窗口负责） |
| api | exchange | 645 | 导入导出；`legacy.ts` 负责旧版 JSON v2 |
| api | renders / nodes / projects / cameras / drafts / layouts / files / ai / audit / health | 各 29–386 | 见 docs/architecture.md §3 |
| web | workbench | 5001 | 历史树、空间录入、方案、平面编辑、阶段面板、渲染阶段 |
| web | viewer3d | 1455 | Three.js 场景（`white-scene.ts`）、渲染外观、正反面兜底 |
| web | recognition / agent / projects / settings | 200–1171 | 识别面板、设计助理面板、项目列表、设置 |
| shared | schemas / planner / geometry / scene / catalog / delivery | 1274 / 611 / 267 / 214 / 199 / 101 | 接口契约、自动排布、几何、墙段与视角、SI 换款、交付命名 |

### 1.3 关键数据流与约定

- **数据流：** 空间（space）→ 生成方案（`POST /layouts/generate`，不落库）→ 选用后建 plan 节点 → 在共享草稿里编辑（800 ms 防抖自动保存，乐观锁）→ “进入三维效果”建 white 节点并生成 8 个视角 → render 节点：浏览器渲染后逐张上传，按签名判断是否过期 → 交付。
- **约定：**
  - 写接口必须带 `If-Match` 版本号。
  - 错误统一为 `{error:{code,message,details,requestId}}`。
  - 请求体严格校验。
  - 前端只通过生成的 OpenAPI 客户端访问数据。
  - Node 直接运行 `.ts`，导入要写 `.ts` 扩展名。
  - 旋转约定：90° 时正面 +Z 转向 −X。
- **生成物：**
  - `apps/api/openapi.json`（2 万行）和 `apps/web/src/api/schema.d.ts`（6400 行）由 CI 校验一致性。
  - `database/migrations/meta/*_snapshot.json` 共 11 份、约 2.1 万行。

## 2. 基线测量

| 项目 | 结果 |
|---|---|
| `pnpm check` | 通过，88 秒 |
| `pnpm format:check` | 通过 |
| `pnpm --filter @store/web build` | 通过：主包 575 KB（gzip 180 KB）；`Viewer3D` 712 KB 和 `pdf-extract` 412 KB 已按需加载 |
| 行覆盖率（v8，临时插件，未写入依赖） | shared 86%；api 86%（分支覆盖 68%）；web 58.5% |
| 覆盖最弱的文件 | `viewer3d/white-scene.ts` 15%（388 行未覆盖）、`recognition/pdf-vector.ts` 0%、`workbench/plan-export.ts` 2%、`viewer3d/render-look.ts` 18%、`agent/tools.ts` 61%（16 个工具中有 9 个没有测试）、`ai/chat.ts` 58% |
| 最慢的测试 | `finish-models` 2.6 s、`platform` 的限流 2.5 s、`deliveries` 2.1 s |
| 未使用（knip） | 没有未使用的 npm 依赖。tools 下有 32 个文件、apps 下有 3 个手动脚本没有入口引用。从未被调用的 hook：`useUploads`、`useRuns`（`recognition/queries.ts:24,73`）、`useAiBudget`（`settings/queries.ts:20`）。另有 34 个导出只在本文件内使用（去掉 `export` 即可，收益很小） |

**浏览器实测**：Chrome 本机，开发服务器，冷缓存。项目为 192 ㎡ 店，1 个空间、2 个方案、2 个三维效果、1 个渲染。

| 场景 | 长任务（合计 / 最长） | 下载量 | 着色器程序 | 备注 |
|---|---|---|---|---|
| 项目列表 | 62 ms / 62 ms | 9.5 MB（开发模式的 JS） | — | 正常 |
| 打开渲染节点 | 1.89–1.96 s / 0.73–0.82 s | 38.5 MB | 21 | CPU 剖析：`three.module` 的 `onFirstUse`（同步编译着色器）1446 ms，我们自己的代码不到 100 ms |
| 打开三维效果节点 | 1.91 s / 0.66 s | **62.8 MB**：效果图 35.7、依赖 JS 14.6、材质轻量版 10.4、白模 0.3 | 21 | 效果图原图是“添加模型”列表里的卡片 |
| 切换到另一个节点 | 0.52–0.87 s | — | **每次重新编译 21 个** | 每次都新建 WebGL 上下文 |
| 连续切换 20 次 | — | — | — | JS 堆 31 → 119 MB；Chrome 报“上下文过多，最旧的会丢失” |
| 平面拖动 40 步 | 1 次，53 ms | — | — | 拖动流畅 |

API 只读接口（各测 5 次，除首次请求外）：项目、节点、视角、草稿均为 3–6 ms；渲染列表 21–36 ms；`/assets` 18–22 ms，返回 112 KB。

## 3. 问题区域

风险：低 = 改动局部且有测试保护；中 = 会改变行为或缺少测试；高 = 涉及数据或历史。成本：小（不超过半天）、中（1–2 天）、大（超过 2 天）。

### 3.1 结构性问题

| # | 问题 | 证据 | 影响 | 成本 | 风险 |
|---|---|---|---|---|---|
| S1 | 识别引擎放在 api 里，web 脚本跨应用导入它 | `web/src/scripts/local-regression.ts:14`；`local.ts` 只依赖纯计算 | 边界模糊；以后把识别挪到浏览器或 worker 都要搬 | 小 | 低 |
| S2 | nodes ↔ cameras 循环依赖 | `nodes/service.ts:27`、`cameras/service.ts:16`（`requireActiveProject`） | 模块初始化顺序脆弱 | 小 | 低 |
| S2 | 五个 service 从 `files/routes.ts` 导入 `fileUrl`，形成 service → routes 的反向依赖 | `assets/service.ts:9` 等 5 处 | 同上 | 小 | 低 |
| S3 | `findNode` 写了 4 份；“写文件 + 登记 storedFiles”写了 3 份 | findNode：`nodes/service.ts:66`、`cameras/service.ts:35`、`renders/service.ts:57`、`deliveries/service.ts:57`；登记文件：`renders/service.ts:204-233`、`agent/service.ts:163-196`、`recognition/service.ts:110-141` | 规则改一处会漏掉其他几处 | 小 | 低 |
| S4 | 设计助理的“阶段父节点”规则和前端不一致 | `agent/tools.ts:253-268` 直接用 `node.parentId ?? node.id`；前端 `workbench/tree.ts:67-77` 的 `stageParentId` 会沿祖先往上找 | 旧项目导入后层级较深（edit 挂在 plan 下）时，设计助理在 plan 下再建 plan，会被 `nodes/service.ts:145-150` 拒绝 | 小 | 中（改变行为） |
| S5 | API 仍然接受新建 `edit` 节点和上传 `white` 渲染图 | `NodeCreate` 使用完整的 `NodeKindSchema`；`renders/routes.ts:51` 的参数是 `mode: RenderModeSchema` | 遗留值可能被重新写入；`nodes.test.ts:161,170,234,247` 还依赖这一点 | 小 | 低 |
| S6 | 导入时直接 `.parse`，ZodError 落到默认分支返回 500 | `exchange/legacy.ts:107,155`、`native.ts:34,53`；`plugins/errors.ts:33-69` 只处理 Fastify 的校验错误 | 用户导入不合规数据时看到“服务器内部错误”，而不是 400 | 小 | 低（改变状态码） |
| S7 | 确认识别、撤销设计助理动作不在事务中 | `recognition/service.ts:408-424`、`agent/service.ts:420-433` | 并发或中途失败时，可能重复确认或只撤销一半 | 小 | 中 |

### 3.2 重复代码（你提出的疑点逐条核实）

| # | 疑点 | 结论 | 证据 | 建议 | 成本 | 风险 |
|---|---|---|---|---|---|---|
| D1 | freshName、namesUnder 两份 | **属实，而且范围更大** | `freshName`：api `tools.ts:91-98`（到 1000 后改用时间戳），web `tree.ts:89-95`（一直递增）。找所属空间写了 3 份：`tools.ts:110-122`、`nodes/service.ts:73-81`、`tree.ts:39-47`。阶段父规则表 2 份：`nodes/service.ts:145-150`、`tree.ts:56-61`。节点类型标签不一致：`edit` 在 `tools.ts:80-86` 叫“方案”，在 `tree.ts:3-9` 叫“编辑”。策略名 3 份：`enums.ts:39-44`、`planner.ts:457-461`、`tools.ts:413-418` | 新建 `shared/src/nodes/`（naming + stages），两端都引用它 | 小 | 低 |
| D2 | 白模与材质轻量版重复 | **属实** | 完全相同：`getIO`（white 38-49 / finish 67-78）、`drift`（92-102 / 132-142）。数值相同：`bounds`（62-90 / 101-130）。几乎相同：偏差检查（157-162 / 389-394）、构建脚本（`build-white-models.ts:12-52` / `build-finish-models.ts:16-59`）、`importer.ts:187-200` 与 `202-215`。`triangles` 的统计口径不同（51-60 按 mesh / 89-97 按 node） | `assets/gltf-common.ts` 加一个共用的构建脚本 | 小 | 低 |
| D3 | 正反两层面检测两份 | **属实，算法相同，细节不同** | `viewer3d/back-layers.ts:4,53-95` 与 `finish-models.ts:43-45,186-231`：都是 1 mm 量化、角点排序成键、点积阈值 -0.9。区别是退化阈值和多材质处理。另外 `'frontOnly'` 在 `render-look.ts:231` 和 `finish-models.ts:47` 各写一次 | 在 `shared/geometry` 增加配对用的纯函数，两端只保留适配层 | 中 | 低 |
| D4 | 朝向和占地分散三处 | **部分属实** | 已统一：`rotatedFootprint`（`schemas/layout.ts:110-120`）、`facingAfter`/`rotationFacing`（`planner/orientation.ts:20-37`）。仍重复：“无正面时长边贴墙”（`planner.ts:295-301`、`si-swap.ts:80-91`、`tools.ts:336`）；**贴墙间隙不一致**：设计助理 0.02 m（`tools.ts:88`），规划器 0.05 / 0.3 m（`planner.ts:50-52`）；设计助理按包围盒贴墙，规划器按真实墙边。墙外法线 3 份（`walls.ts:57`、`plan-drawing.ts:109`、`white-scene.ts:476-481`），`signedArea` 2 份（`white-scene.ts:246-253`、`geometry/polygon.ts:27`） | `placeAlong` 移到 shared，复用规划器的墙模型 | 中 | 中（贴墙结果会变） |
| D5 | 测试辅助重复 | **属实** | api：`seedAsset` 在 `agent.test.ts:16-44` 和 `nodes.test.ts:19-47` 逐字相同，另有 3 种变体；space→plan→white 链写了 3 遍（`cameras.test.ts:42-60`、`renders.test.ts:62-89`、`deliveries.test.ts:51-80`）；`layout` 常量逐字重复 3 份。web：`json()` 和 `fakeApi` 在 8 个测试文件里各写一份；QueryClient 包装 9 处；Asset 工厂 4 处 | `api/test/fixtures.ts`、`web/src/test-utils/` | 小 | 低 |
| D6 | 杂项 | 属实 | 设计助理手写 SI 和市场枚举（`tools.ts:583-584`），shared 已有对应 schema；`llm.ts:37-55` 重复了障碍物和入口的取值；各 routes 里 `{nodeId: z.uuid()}` 定义了 13 次；包围盒 3 份（`planner.ts:122`、`white-scene.ts:445-452`、`PlanEditor.tsx:442-449`） | 随相关批次一起处理 | 小 | 低 |

### 3.3 性能瓶颈（按实测影响排序）

| # | 问题 | 证据 | 影响 | 建议 | 成本 | 风险 |
|---|---|---|---|---|---|---|
| P1 | **切换节点泄漏 WebGL 上下文，并重复编译着色器** | `Workbench.tsx:159` 的 `key={selectedId}` 让 `PlanEditor` 和三维场景整体重建；`white-scene.ts:705-724` 的 `dispose()` 没有调用 `renderer.forceContextLoss()`。实测见 §2 | 每次切换卡 0.5–0.9 秒；长时间使用后，旧上下文被浏览器强制丢弃，内存持续增长 | ① `dispose()` 加 `forceContextLoss()`；② 首帧前用 `renderer.compileAsync()` 并行编译；③ 中期改为整页共用一个渲染器 | ①② 小；③ 中 | ①② 低；③ 中 |
| P2 | **“添加模型”卡片加载效果图原图** | `ModelPicker.tsx:91,104` 用的是 `productImage.url`；模型库 30 张 `效果图.png` 合计 42 MB，单张最大 7.5 MB | 一个节点下载 35.7 MB 图片，远程部署时首屏会很慢 | 导入目录时用 sharp 生成约 480 px 的 WebP 缩略图（只存 `data/files`，不入库），卡片改用缩略图 | 小到中 | 低 |
| P3 | 首屏同步编译 21 个着色器 | CPU 剖析：`onFirstUse` 1446 ms | 首次打开三维时卡顿约 1.4 秒 | 同 P1 ②；另外检查材质种类能否合并 | 小 | 低 |
| P4 | 拖动时每一步都重建地面标记，并重算 2048² 阴影 | `Viewer3D.tsx:132-134` 的依赖里有 `layout` → `setMarks`（`white-scene.ts:590-606`）；`setItems` → `sceneChanged()`（585、692-695） | 实测拖动只有 1 个 53 ms 的长任务，店更大、道具更多时才会明显 | 复用标记对象；拖动中降低阴影更新频率 | 小 | 低 |
| P5 | `PCFSoftShadowMap` 已被 three.js 移除 | `white-scene.ts:358`；控制台提示“已改用 PCFShadowMap” | 这行设置实际无效 | 改为 `PCFShadowMap`。画面不变，因为现在就已经在用它 | 小 | 低 |
| P6 | `catalogAssets` 每个请求整表加载（6 个 LEFT JOIN），没有缓存 | `assets/service.ts:78-98,135-138`；草稿保存、校验、渲染列表各 1 次，交付 2 次，设计助理每次改布局 1 次（一轮最多 8 次） | 单次约 10–20 ms，目前不明显 | 进程内缓存，在 `importer` 处失效；签名计算改为按 id 查询 | 小 | 低 |
| P7 | 逐层查询祖先；`getTree` 取出整行 JSON；打包时 N+1 | `nodes/service.ts:73-81,127-132`；`renders/service.ts:114-118,284-290` | 节点多了以后才会显现 | 递归 CTE；只查摘要列 | 中 | 低 |
| P8 | 模型缓存永不释放，缓存里的几何还会被原地修改 | `white-scene.ts:59-60,718`；`back-layers.ts:133` | 长时间使用时内存只增不减；隐藏耦合 | 和 P1 ③ 一起处理 | 中 | 中 |

### 3.4 可维护性风险

| # | 问题 | 证据 | 建议 | 成本 | 风险 |
|---|---|---|---|---|---|
| M1 | 超大文件 | `agent/tools.ts` 908 行：16 个工具放在一个数组里（360-864）。`white-scene.ts` 895 行，承担 9 类职责。`recognition/local.ts` 802 行，其中 `recognizeVector` 一个函数约 254 行（549-802）。`PlanEditor.tsx` 801 行：自动保存、节点动作、SI 切换、拖拽、快捷键、属性面板都在里面 | 每个文件单独一个“只搬家”的 PR，拆分方案见 §5 | 中 | 中 |
| M2 | 没有 react-hooks lint 规则 | `eslint.config.js` 只有 typescript-eslint。`PlanEditor.tsx:190-201` 的 `move` 依赖为空，却读了 `space`（目前靠 `key` 重建掩盖了问题）。`RenderStage.tsx:140-151` 有两个没有依赖数组的 effect | 加入 `eslint-plugin-react-hooks`，先只报警告 | 小 | 低 |
| M3 | 设计助理工具的测试缺口 | 有 9 个工具没有测试：`get_state`、`generate_plans`、`move_item`、`remove_item`、`validate`、`confirm_white`、`start_render`、`remove_view`、`export_project` | 拆分前先补表征测试 | 中 | 低 |
| M4 | 死代码和死样式 | 从未调用的 hook 3 个；`PlanEditor.tsx:164,578` 的 `show3d = true`；`workbench.css:430-512` 是旧的弹出式选择器（约 10 个类名在 tsx 中已找不到）；有覆盖规则，如 `.tree-item` 91/811、`.space-summary` 234/804 | 删除 | 小 | 低 |
| M5 | 隐式约定没有类型约束 | 设计助理撤销依赖工具结果里的 `nodeIds`、`cameraId`、`restoreCameraId` 键（`agent/service.ts:411-419`） | 拆分 tools 时写成类型 | 小 | 低 |
| M6 | 依赖声明位置不准 | `@gltf-transform/*`、`meshoptimizer` 放在 api 的 devDependencies，但 `catalog:import` 的导入链会加载它们：`importer.ts:16-17` → `finish-models.ts:3-16` | 服务端本身不加载这些包。README 的部署步骤是完整安装，所以目前不出错；如果改用 `--prod` 安装，`catalog:import` 会失败。建议改为 dependencies，或者把记录 schema 拆到不依赖这些包的文件 | 小 | 低 |

### 3.5 上下文膨胀

| # | 来源 | 体量（约） | 价值 | 说明 |
|---|---|---|---|---|
| C1 | `资源库/90_处理过程与审核` 文本 | 90 MB，约 2800 万 token；单个 JSON 最大 3.8 MB | 对代码工作接近零 | 门店图纸窗口的数据；apps 不引用 |
| C2 | `资源库/00_资源索引/历史目录` | 21.6 MB，约 680 万 token | 对代码工作为零 | 被 `tools/store-archive` 读取，不能移动 |
| C3 | `tools/data-cleaning` | 8.7 MB，约 270 万 token | 对代码工作为零 | 其他窗口负责 |
| C4 | `tmp/`、`output/` | 1.7 MB，约 52 万 token | 历史 | 见 §4 |
| C5 | 生成物：`openapi.json`、`schema.d.ts`、迁移快照 | 1.65 MB，约 51 万 token | 只给机器读 | 误读一次 `openapi.json` 就是约 25 万 token |
| C6 | `demo/` | 0.5 MB，约 15 万 token | 已被替代 | 第一代网页 |
| C7 | docs 中的历史和过时文档 | 0.3 MB，约 9 万 token | 低；有些还误导 | 见 §4.2 |
| C8 | 入口文档失真 | 根 `README.md:8,16,68`、`docs/README.md`、`architecture.md:12,43-45,51,165-166` | 把 AI 引到 demo 和不存在的 worker | 这是性价比最高的修复 |
| C9 | 规则文件不在 Git 中 | `AGENTS.md`、`CLAUDE.md` 只在主工作区，任何 worktree 都看不到 | 工作区里的 AI 读不到规则和“阅读地图” | 见问题 Q8 |

## 4. 清理清单

**图例：**
- 保留：留在 main。
- 归档：从 main 删除，只保留在归档标签里（推荐的方式，见 Q1），在 `docs/archive/INDEX.md` 记录恢复命令。
- 删除：内容已无价值，删除即可，历史里仍可找到。
- 他窗：属于其他窗口的区域，只记录，不动。

**引用检查方法：** 全仓 grep 目录名和关键文件名（含中文路径），覆盖代码、`package.json` scripts、CI 和其他文档。

**关于 LFS：** 删除当前版本里的 LFS 文件不会释放配额，因为历史里还在；真正释放必须改写历史，本计划不做。本清单里的候选几乎都是普通 Git 文件，清理的收益在于检出体积和上下文。

### 4.1 代码与工具

| 路径 | 内容 | 引用检查 | 建议 | 理由 |
|---|---|---|---|---|
| `demo/`（118 个文件） | 第一代 Vite 工作台和本机文件服务 | 新系统没有运行时依赖：`legacy.ts:26`、`nodes.test.ts:353`、`white-scene.ts:13` 只是注释。**tools 下有 6 处依赖**：5 个脚本从 `demo/node_modules/@playwright/test` 导入，`tools/training/train-layout.mjs` 写入 `demo/src/generated`，`tools/sketchup/build_model_catalogue.py` 读取 demo，以及**他窗的 `tools/data-cleaning/geometry3.py:71`** 读取 `demo/src/data/placement-manifest.json`。文档中引用它的有 19 份 docs 和根 README | **归档**（Q2） | 决策记录（requirements §14，10-08）写明“功能对齐后删除”。删除前要把旧版 JSON v2 的格式说明搬进 docs，3 处注释改为指向 docs |
| `apps/api/src/scripts/inspect-glb-parts.ts`、`trim-glb-parts.ts` | 一次性 GLB 排查和裁剪脚本 | 没有被 scripts 和文档引用 | 归档 | 已经用不上 |
| `apps/web/src/scripts/local-regression.ts` | 识别回归 | README 有说明 | 保留，随 S1 移动 | 仍在使用 |
| `tools/library/`（除 `restructure-20261010.mjs`） | 模型库刷新、选用表 | `library:*` scripts | 保留 | 当前流程 |
| `tools/library/restructure-20261010.mjs`、`cutout-photo.mjs` | 一次性重排、抠图 | 没有入口引用 | 归档 | 已完成 |
| `tools/pdf-review/`（19 个） | 09-23 PDF 分类和标签 | 历史文档；依赖 demo 的 Playwright | 归档；`scan-progress.log` 删除 | 实验结束 |
| `tools/render-benchmark/`（7 个）、`tools/training/`（26 个） | 渲染对照、4070 训练 | 只有历史文档引用 | 归档 | 实验结束 |
| `tools/sketchup/` | SU 导出和预检 | `build_model_catalogue.py` 依赖的 `plan_legend` 字段已为 null，已经失效；`inspect_archive.py` 是 `_原始模型预检` 的来源 | 失效脚本归档，其余保留 | — |
| `tools/resource-library/`、`tools/resource_library.py` | 原图纸路径解析 | data-cleaning、training、pdf-review 共 6 处引用 | 保留 | 共享依赖 |
| `tools/cleanup-review-copies.py`、`tools/connect-existing-feishu.ps1` | 一次性清理脚本、飞书凭据恢复脚本（内含写死的 appId） | 没有引用 | 归档 | 目标目录已不存在 |
| `tools/data-cleaning/`、`tools/store-archive/` | — | — | 他窗 | — |
| `tmp/`（36 个）：SU 拆分复现脚本 10 个、`clean-legends/` 4 个、`plan-legends/` 8 个、`si-standards-review/` 15 个 | 09-25 至 10-04 的中间脚本和记录 | 只被迁移映射和历史文档引用；`si-standards-review` 有唯一的命名决策记录 | 归档（`si-standards-review` 的决策记录先移到 `资源库/05_店铺形象设计标准/历史阅读记录`） | docs/README 写明“不能整目录删”，按这份清单逐项处理 |
| `output/maintenance/`（3 个）、`output/分支合并-20261008/`（2 个） | 10-04 的删除记录、合并说明 | 只有历史文档引用 | 归档 | — |
| `output/图纸*-20261008/` 等 18 个 | 图纸上传核对 | 被 `tools/store-archive/register_legacy.py` 和 `09_门店档案/旧成果登记.json` 引用 | 他窗，保留 | — |
| `database/migrations/meta/0000–0009_snapshot.json` | drizzle 快照 | `drizzle-kit generate` 会读取并校验整个 meta 目录；运行迁移不读快照 | **保留**，只加入搜索忽略 | 收益只有 0.5 MB；删除后排查并行迁移冲突、执行 `drizzle-kit drop` 都会出问题 |

### 4.2 文档（docs/ 共 54 份）

| 分类 | 文件 | 建议 |
|---|---|---|
| 当前有效 | `api.md`、`data-model.md`、`requirements.md`、`input-materials.md` | 保留 |
| 当前有效但需订正 | `architecture.md`（worker / legacy 写成现状；`STORAGE_ROOT` 与 `RESOURCE_ROOT` 混为一谈）、根 `README.md`（“本机运行”仍是 demo；“22 项 GLB 缺失”已过时，实际已有 38 个）、`docs/README.md`（仍以 demo 为入口）、`sync-and-collaboration.md`、`requirements.md:138`（legacy 的决定未执行，补一行说明） | 订正（批次 1） |
| 过时且误导 | `project-brief.md`、`product-flow.md`、`design-system.md`（维护入口仍指向 demo 的 tokens）、`roadmap.md`、`asset-placement.md`、`su-real-assets.md`、`github-missing-assets.md`、`asset-inventory.md` | `design-system.md` 改为指向 `apps/web/src/styles`，保留；其余归档 |
| 历史记录 | `web-8h-progress.md`（58 KB）、`web-review-20260926`、`file-organization-20260926`、`case-pack-4h-*`、`real-sample-review`、`layout-library`、`layout-observations-batch01`、`asset-ingestion-plan`、`sample-case-template`、`training-*`、`rtx4070-*`、`render-benchmark`、`furniture-geometry-v2`、`layout-render-upgrade-20260927`、`fuzzy-layout-validation-20260928`、`storage-audit-20260927`、`source-control-cleanup-20260927`、`maintenance-20261004`、`delivery-log-20261004`、`si-standards-review-20261001`、`archive/` 下 7 份、`superpowers/plans/` 下 4 份 | 归档 |
| 历史记录，但被他窗脚本引用 | `data-preparation-next-steps.md`、`pdf-cleaning.md`、`si-source-recovery.md`（被 `tools/store-archive/register_legacy.py` 引用） | **原地保留**，只加入搜索忽略 |
| 他窗 | `store-drawing-archive-plan.md`（52 KB）、展陈方案文档 | 不动 |

注意：大量文件的 `git log -1` 日期是 2026-10-08，这是快照提交 20ed7a9b 留下的，不代表内容的真实日期。

### 4.3 资源库（只看代码依赖；他窗区域不动）

| 路径 | 引用检查 | 建议 |
|---|---|---|
| `资源库/模型选用表.xlsx` | `library:table` 和 `library:apply-table` 的输入与输出 | **保留** |
| `资源库/SI切换映射表.xlsx` | 映射已经写进 `shared/catalog/si-swap.ts`，xlsx 是用户审核过的原件（`si-swap.ts:11`、requirements §14） | **保留** |
| `04_模型库/manifest.json`、`品类对照.csv`、`模型目录.html`、`目录迁移映射-20261010.json`、`_历史记录/`、`_图例来源/` | importer、`refresh-library.mjs`；manifest 中有 180 处引用 `_图例来源` | 保留 |
| `04_模型库/_原始整包/`（1.2 GB LFS） | 唯一原件 | 保留 |
| `04_模型库/_原始模型预检/`（47 个，1 MB） | 由 `inspect_archive.py` 生成，可以重新生成 | 保留（收益低） |
| `资源库/08-skill/` | 双 PDF 交付规则的来源（requirements §7） | 保留 |
| `资源库/99_历史归档/` | 本身就是归档区；apps 不引用 | 保留，加入搜索忽略 |
| `资源库/00_资源索引/历史目录/` | 被 `tools/store-archive/build_sources.py:28-29` 等读取 | 保留，加入搜索忽略；里面有 2 张飞书二维码，是否敏感见 Q10 |
| `01_各门店原图纸`、`09_门店档案`、`90_处理过程与审核` | apps、packages、database 都不引用 | 他窗，只加入搜索忽略 |

## 5. 上下文消耗与搜索排除

**一位 AI 协作者接手时通常要读的内容：**

| 阶段 | 内容 | 约 token |
|---|---|---|
| 规则 | AGENTS.md、CLAUDE.md、记忆索引 | 0.3 万 |
| 入门 | README、docs/README、architecture、requirements、data-model、api | 2.5 万 |
| 改一个模块 | 相关的 service、routes、组件，加上 shared 中的 schema | 3–6 万 |
| 典型浪费 | 全仓 grep 命中单行大 JSON、误读 `openapi.json` 或迁移快照、照着 docs/README 去读 demo | 单次可达几万到几十万 |

**可选的办法：**

1. **根目录 `.ignore`**（ripgrep 格式，推荐）。实测 Claude Code 的 Grep 会遵守它：全仓搜索时跳过这些目录，显式指定路径时照常可搜。
   - 优点：不影响 Git，不影响其他窗口的工作，可以随时调整；VS Code 搜索（`search.useIgnoreFiles`）和其他基于 ripgrep 的工具通常也会遵守。
   - 缺点：VS Code 的全局搜索同样会跳过这些目录（你自己搜 资源库 时，需要在“包含的文件”里写明路径）；Glob 和 shell 里的 `grep` 不受影响，所以不是硬性屏蔽。
2. **Claude Code 的 `permissions.deny`（`Read(...)`）**：硬性禁止读取。会挡住其他窗口正常读图纸数据，**不推荐**。
3. **`.cursorignore`、`.aiignore` 等**：只对相应工具有效，现在没人用，暂不需要。
4. **入口文档的“阅读地图”**：在 docs/README 开头写明“改代码读这 6 份；不要读这些”，再订正失真的入口文档。成本最低，效果最直接。
5. **本机 worktree 跳过 LFS**：`GIT_LFS_SKIP_SMUDGE=1 git worktree add …`，本次评审就是这样建的。可以避免为纯代码工作检出 15 GB 的 LFS 文件。

**推荐的 `.ignore` 内容（批次 1）：**

```gitignore
# 搜索默认跳过：数据、历史与生成物。需要时显式指定路径即可搜索。
/资源库/90_处理过程与审核/
/资源库/00_资源索引/历史目录/
/资源库/01_各门店原图纸/
/资源库/09_门店档案/
/资源库/99_历史归档/
/tools/data-cleaning/
/demo/
/tmp/
/output/
/docs/archive/
/apps/api/openapi.json
/apps/web/src/api/schema.d.ts
/database/migrations/meta/
/pnpm-lock.yaml
```

## 6. 重构策略（第 1 阶段起，一批一个分支、一个 PR）

**每个 PR 都要做到：**
- 通过 `pnpm check`、`pnpm format:check`、`pnpm --filter @store/web build`；改了接口就跑 `pnpm api:openapi`。
- 涉及界面的改动，用浏览器实际操作核对一遍（拦截写请求或使用测试项目）。
- 正文写清改了什么、为什么、怎么验证的、行数或体积变化。
- 回滚方式统一为 `git revert <合并提交>`。归档类改动另有标签可以恢复：`git checkout archive/pre-cleanup-20261013 -- <路径>`。
- “只搬家”的 PR 不改逻辑，“改逻辑”的 PR 不搬家。

| 批 | 范围 | 预计改动 | 证明功能不变 |
|---|---|---|---|
| 0 | 本报告 | +1 文件 | — |
| 1 | 上下文入口：新增 `.ignore`；订正根 README、docs/README（含阅读地图）、architecture.md；清理 `.gitignore` 的失效规则 | 约 ±300 行，只改文档和配置 | 用 Grep 实测忽略生效；CI 通过 |
| 2 | 先打归档标签 `archive/pre-cleanup-20261013`，再归档 docs 历史文档（§4.2）并写 `docs/archive/INDEX.md` | 约 −35 个文件 | 全仓 grep 确认没有断链；CI 通过 |
| 3 | 归档 tmp、output、tools 中的历史脚本（§4.1，不碰他窗） | 约 −120 个文件 | 同上；`library:*` 正常 |
| 4 | 归档 demo/（前提：Q2 已和图纸窗口协调）；旧版 JSON 格式说明搬进 docs | 约 −118 个文件 | legacy 导入测试 `nodes.test.ts:446-553` 通过 |
| 5 | **表征测试**（先于所有重构）：9 个设计助理工具、`plan-export`、`render-look`、`white-scene` 的纯函数部分、`pdf-vector`、旧版导入的边界数据（先锁住现有行为，包括目前的 500） | 约 +800 行测试 | 新测试在当前代码上通过 |
| 6 | 测试辅助共享：`api/test/fixtures.ts`、`web/src/test-utils/`（只改测试） | 约 −400 / +200 | 测试数量不变且全部通过 |
| 7 | shared 新增 nodes（naming + stages），两端改为引用；删除死 hook、死 CSS、`show3d` | 约 −250 / +120 | 现有测试加上批 5 的表征测试 |
| 8 | 白模和材质轻量版共用 `gltf-common.ts` 和构建脚本 | 约 −200 / +120 | 用主工作区的 `model.glb`（只读）把产物输出到临时目录，与现有 `white.glb`、`finish.glb` 的哈希逐一比对 |
| 9 | 后端边界：消除循环依赖，`fileUrl` 移到 lib，统一 findNode 和登记文件 | 约 −150 / +80 | 测试通过；madge 检查没有循环 |
| 10a–d | 只搬家：拆 `agent/tools.ts` → `agent/tools/`；拆 `local.ts` → `recognition/local/`，并按 S1 移到 shared 或独立包；拆 `white-scene.ts`；`PlanEditor` 抽成 hook 和子组件。每个文件一个 PR | 每个 PR 净变化约 0 | 只移动，不改逻辑；测试、构建、浏览器操作核对都通过 |
| 11 | 性能修复，不改变功能：P1 ①②、P5、P2 缩略图、P4、P6 | 约 +200 | 浏览器复测 §2 的指标：切换节点不再新增上下文；下载量和长任务降到多少写进 PR |
| 12 | 行为修正（需逐项确认，见 Q4）：S4、S5、S6、S7、D4 的贴墙间隙 | 每项一个小 PR | 有意修改对应的表征测试，并在 PR 中说明行为差异 |

**推荐顺序：** 1 → 2 → 3 → 5 → 6 → 7 → 11 → 8 → 9 → 10 → 4（等协调结果）→ 12。

- 先做上下文和测试，收益立刻可见、风险最低。
- 性能修复 11 排在大拆分之前，因为用户能直接感受到。
- 删除 demo 的时间取决于和其他窗口的协调。

## 7. 需要你拍板的问题（未回答的按推荐执行）

1. **归档方式**
   - **A（推荐）**：打标签 `archive/pre-cleanup-20261013` 后从 main 删除，`docs/archive/INDEX.md` 记录恢复命令。
   - B：移到 `docs/archive/` 等目录并加入搜索忽略，文件仍在检出里。
   - C：不动文件，只加 `.ignore`。
2. **demo/ 与他窗依赖**
   - **A（推荐）**：先请门店图纸窗口把 `tools/data-cleaning/geometry3.py:71` 改为读 `资源库/04_模型库/manifest.json`，或者确认该脚本已不再使用，然后再删除 demo；依赖 demo Playwright 的 tools 脚本随批次 3 一起归档。
   - B：现在就删，接受那个脚本失效。
   - C：保留 demo，只做搜索忽略。
3. **`.ignore` 的范围**
   - **A（推荐）**：§5 的清单。
   - B：整个 `资源库/` 都忽略（更省上下文，但会搜不到 04_模型库 和选用表）。
   - C：不加。
4. **行为修正逐项是否做**（默认全部“做”，每项一个 PR，并在 PR 中写明行为差异）
   - a. 设计助理的父节点规则与前端一致（S4）。
   - b. API 拒绝新建 `edit` 节点、拒绝上传 `white` 渲染图（S5），数据库枚举保留。
   - c. 导入数据不合规时返回 400 而不是 500（S6）。
   - d. 确认识别、撤销放进事务（S7）。
   - e. 设计助理贴墙间隙改用规划器的 `wallGap`（0.05 m；中岛店 0.3 m），并按真实墙边贴墙（D4）。**这一项会改变设计助理放置的位置**，如果你希望保持 2 cm，请说明。
5. **效果图缩略图存放位置**
   - **A（推荐）**：`catalog:import` 时生成，存到 `data/files`，不入库，和材质轻量版一样每台机器生成一次。
   - B：入库到 `04_模型库`（约 90 张、总计约 3 MB，普通 Git 文件）。
6. **过时文档**：**推荐**订正 README、docs/README、architecture.md、design-system.md，其余过时文档归档（§4.2）。
7. **迁移快照**：**推荐**保留，只加入搜索忽略。
8. **规则文件不在 Git 中，worktree 里看不到**
   - **A（推荐）**：按你的要求不提交 AGENTS.md 和 CLAUDE.md；把“阅读地图”写进入库的 `docs/README.md`，由你在 AGENTS.md 里加一句“先读 docs/README.md 的阅读地图”。
   - B：把这两个文件入库。
9. **ESLint 加入 `eslint-plugin-react-hooks`**（新增 1 个 devDependency；先报警告，修完后再改为报错）：**推荐**加入，单独一个 PR。
10. `资源库/00_资源索引/历史目录/` 里有 2 张飞书二维码图片：**推荐**由你判断是否敏感；如果敏感，转告图纸窗口处理，我不动。
11. 覆盖率插件 `@vitest/coverage-v8`：**推荐**不加入依赖，需要时像本次一样临时运行。
12. §6 的批次顺序：**推荐**按“推荐顺序”执行，每个 PR 的 CI 通过后先问你，再合并。

## 8. 决议（2026-10-13 用户答复）

- 12 题全部按推荐执行，其中 4e 也执行：设计助理的贴墙间隙改用规划器的 `wallGap`。
- 第 10 题：两张飞书二维码是已过期的授权码，可以删除。
