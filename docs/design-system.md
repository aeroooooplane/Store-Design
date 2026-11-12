# 网页视觉规范

更新：2026-11-12 新增品牌图形（见下）。2026-10-16 采用“影石品牌”方向（用户选定方案 B）：墨黑 + 品牌黄 `#FFD200`（取自 insta360.com/cn 样式表中出现最多的亮黄），暖灰白底，字体 Inter（数字/英文，`@fontsource-variable/inter` 自托管）+ 系统中文字体，图标用 lucide-react。更早的柔和石板蓝主题已被取代。

## 视觉规则

- 暖灰白底、白色卡片、墨黑文字；品牌黄只作填充与指示（选中底色、Logo、按钮上的文字色），不作白底上的文字色。主按钮为黑底黄字。
- 顶栏（`components/AppNav.tsx`）为所有页面共用：品牌标识 + 项目/展陈方案/设置。
- 无衬线字体；标题、表单和卡片左对齐。
- 按钮、输入框 8 px 圆角，卡片 14 px；主要操作用 `--accent`（墨黑）。间距取 4 的倍数，字号阶梯 12/13/14/16/22。
- 状态用 Mac 窗口式小色点（2026-11-12 用户选定）：红 `--dot-error` 表示出错、过期，品牌黄 `--dot-busy` 表示进行中、需要留意，绿 `--dot-ok` 表示已就绪、已完成。红黄绿只出现在约 8 px 的圆点上，旁边的文字保持黑色或灰色，不做底色。
- 出错提示 `.error`：白底灰框、左侧 2 px 红边、红点、黑字。表单字段出错时，字段本身加红边（`aria-invalid`），提示用 `.error.inline`（只有红点和文字）。
- 错误同时提供文字和语义提示，不只依赖颜色；保持可见的键盘焦点，窄屏重新排布，避免横向溢出。
- 模型照片、原始图纸和三维材质保留真实颜色。SI 标准与网页主题是两个独立层面：主题改动不改变模型材质、尺寸或 SI 判断。

## 品牌图形

- 2026-11-12 用户选定“店铺平面”：黑底圆角方块，白色三面墙，底边门洞是入口，两张黄色中岛桌。浏览器标签图标、安装图标和网页顶栏 Logo 用同一个图形；它也是设计助理的脸（`components/BrandFace.tsx`：两张桌是眼睛，门洞是嘴；待命偶尔眨眼，思考时两眼一起上下跳，出错时叉眼）。
- 只用网页现有的黑、白、黄；不使用影石 Insta360 官方标志，避免内部工具被当成官方产品。
- 源文件是 `apps/web/public/favicon.svg`。位图（`favicon.ico` 16/32/48、`icon-192.png`、`icon-512.png`、`icon-maskable-512.png`、`apple-touch-icon.png`）由 `node tools/brand/build-icons.mjs` 生成并入库；改图形只改 SVG，再运行脚本。
- 应用要上云，所以不做本机桌面快捷方式。`apps/web/public/manifest.webmanifest` 让 Chrome / Edge 地址栏出现“安装”，装上后桌面、开始菜单和任务栏都显示这个图标，打开的仍是同一个网址。

## 页面图标

- 通用图标一律用 lucide（`lucide-react`）；lucide 没有的门店图标（阶段、平面视图、材质、显示间距、空心隔板、展陈）在 `components/StoreIcons.tsx`，按 lucide 的画法画：24 网格、线宽 2、圆头圆角。不再另画别的图标，也不用文字符号（✓ ▾ ↓ ×）代替图标。
- 尺寸只用 16（按钮、列表行）、18（面板标题）、24；颜色跟随文字。文字按钮配图标时加 `.with-icon`；只有图标的按钮用 `.icon-button`，必须有 `aria-label` 和悬停提示。
- 阶段面板的标题和按钮图标集中在 `StagePanel.tsx` 的 `STAGE_ICONS` / `ACTION_ICONS`，按文字对应；改按钮文字时同步改这里。
- 搜索框（`input[type='search']`）自动带放大镜。
- 道具类别按 12 类显示：中岛桌、开箱桌、收银、配件柜、配件边柜、展示台、屏幕、灯箱、标识、坐凳、储物柜、其他。模型库的功能类别只有 11 个，“灯箱与标识”在界面上按名称拆开（名称含“灯箱”的进灯箱，其余 LOGO、画面进标识），模型库数据不改。图标在 `StoreIcons.tsx`，用 `ItemFunctionIcon` 按模型取。
- “添加模型”按类别分节：顶部两排图标点击滑到该类、滚动时高亮（`ModelPicker.tsx`）；搜索和跳转图标固定，只有列表滚动。道具名前的类别图标出现在选中道具标题、平面图悬停提示（`.plan-hover`）和设计助理动作记录里。

## 维护入口

| 内容 | 位置 |
|---|---|
| 品牌图形（浏览器标签、安装图标、顶栏 Logo） | `apps/web/public/favicon.svg`，位图用 `tools/brand/build-icons.mjs` 生成 |
| 主题变量（颜色、圆角、阴影、字体、间距） | `apps/web/src/styles/tokens.css` |
| 全局与页面框架 | `apps/web/src/styles/app.css` |
| 工作台布局 | `apps/web/src/styles/workbench.css` |
| 历史树样式 | `apps/web/src/features/workbench/tree-layout.ts` 的 `TREE_STYLE` |
| 三维渲染外观（按 SI 手册） | `apps/web/src/features/viewer3d/render-look.ts` 的 `RENDER_LOOK` |
| 导出的平面 SVG／PNG（内嵌印刷色，离开网页也能正确显示） | `apps/web/src/features/workbench/plan-export.ts` |

不要在组件里另写一套主题颜色；新增颜色先加到 `tokens.css`。
