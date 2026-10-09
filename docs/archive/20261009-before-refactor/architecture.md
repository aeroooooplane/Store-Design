# 当前技术架构

更新：2026-10-04。这里描述实际代码；早期设想见 [归档架构草案](archive/20261004-before-refresh/architecture.md)。

## 运行关系

浏览器运行 React 工作台，使用 Three.js 做三维与概念渲染。Vite 的开发／预览进程同时挂载本机只读文件服务。Python、Ruby 等工具离线生成模型目录、图例和索引。

前端与服务端职责已分目录，当前仍由同一个 Vite 进程提供页面和文件。没有独立项目数据库、认证服务、渲染任务队列或云端同步。

| 位置 | 职责 |
|---|---|
| `demo/src/main.jsx` | 加载样式、启动 React、挂接项目恢复保护 |
| `demo/src/app/App.jsx` | 工作流程、当前阶段、分支与编辑状态的协调 |
| `demo/src/app/stages/` | Setup / Gallery / Editor / White / Render 五阶段视图 |
| `demo/src/app/components/` | 历史树、项目导入备份、平面与渲染导出工具条 |
| `demo/src/components/Plan.jsx` | 平面 SVG、选择与拖动 |
| `demo/src/components/Model.jsx` | 三维预览生命周期、加载与释放 |
| `demo/src/styles/` | 共用主题变量、工作台样式、模型目录样式 |
| `demo/src/layout.js`、`space-planner.js`、`asset-contract.js` | 布局、尺寸、碰撞与资产契约 |
| `demo/src/scene.js`、`store-materials.js`、`camera-presets.js` | 三维场景、门店材质与机位；独立于网页配色 |
| `demo/src/project-*.js`、`ProjectRecovery.jsx` | 导入校验、草稿、并发保存保护与恢复 |
| `demo/server/` | 本机证据和模型白名单文件服务 |
| `demo/scripts/` | 数据索引生成、转换与网页检查工具 |
| `tools/sketchup/` | SU 拆分、图例生成、模型目录发布 |
| `tools/pdf-review/`、`tools/training/` | 文档审核与历史实验；网页启动不执行训练 |

## 数据和接口

浏览器项目仍保存在 `insta-studio-v2`，分支及草稿可导出 JSON。刷新后渲染图片需要重新生成。导入采用校验后合并，损坏项目先进入恢复保护。

`/__local-evidence/` 根据案例索引读取已核验文件；`/model-library/` 从模型 manifest 提供预览、图例和下载；`/si-standards/` 提供已发布标准页面；`/si-guide/` 提供阅读记录。文件服务只允许本机和显式白名单，不把整个项目目录开放给网页。

模型库 HTML 同时支持本机浏览器和离线文件打开。生成器读取 `demo/src/styles/tokens.css` 与 `model-library.css` 后内嵌样式，避免另维护一套颜色和按钮规则。修改后需重新生成目录。

## 演进原则

按功能抽取组件，保留稳定的数据契约；纯几何、持久化和渲染逻辑保持独立。需要跨电脑项目保存或后台任务时再新增独立服务与迁移方案，不能把当前目录拆分称为已经完成数据库与云端架构。
