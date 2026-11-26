# BoldSite 上云部署

## 首轮试点范围

现有 React 的项目列表、新建和详情路由继续使用。试点发布包在详情页开放名称、铺位形态、市场、SI 风格保存和图纸上传下载。项目更新、移入回收站和恢复使用现有 `If-Match` 与 `ETag`，缺版本返回 428，旧版本返回 409。普通构建和未启用试点的 BoldSite 构建沿用完整工作台。

FastAPI 实现 `apps/api/openapi.json` 中的以下接口。前端继续使用原有生成类型和 API 客户端，本轮接口契约沿用原版本。

| 范围 | 路径与方法 |
| --- | --- |
| 健康 | `GET /api/v1/health` |
| 项目 | `GET/POST /api/v1/projects`，`GET/PATCH/DELETE /api/v1/projects/{projectId}`，`POST /api/v1/projects/{projectId}/restore` |
| 图纸 | `GET/POST /api/v1/projects/{projectId}/uploads`，`GET /api/v1/files/{fileId}` |

上传契约为 PNG/JPEG 原始字节，单张 20 MB 内，最长边 8192 像素。PDF 由浏览器将所选页渲染为 PNG，上传记录保留原文件名及页码，下载内容为渲染后的 PNG。试点界面读取每个项目最新 20 条上传记录。

选择虚构矢量 PDF 后，可在上传所选页前使用“识别本页矢量”。浏览器复用现有本机矢量算法，回显轮廓面积、比例依据、道具标注及待复核项。识别处理不发网络请求，结果仅供页面核对。扫描图、外部模型识别及识别结果转正式空间仍待相应服务方案。

## 网关路径

平台保留 `/api`、`/view`、`/svc`。Bold Site 页面在应用挂载点下统一使用 `./workbench/v1/`。例如健康检查是 `/svc/{appId}/workbench/v1/health`，图纸下载是 `/svc/{appId}/workbench/v1/files/{fileId}`。FastAPI 直接注册工作台路径，入口兼容网关剥前缀、透传和 ASGI `root_path`。本地 Fastify、OpenAPI 和生成的客户端类型继续使用 `/api/v1/`。

## 打包与运行

```sh
pnpm install --frozen-lockfile
node tools/boldsite/package.mjs /path/to/new-release
python -m unittest discover -s apps/boldsite -v
```

运行平台同版本测试前，使用 Python 3.11 执行 `python -m pip install -r apps/boldsite/requirements.txt`。打包命令启用 `VITE_BOLDSITE_PROJECT_PILOT=1`，生成同时包含 `index.html`、`static/`、根目录图标、Python 服务和 `boldsite.json` 的发布目录。压缩发布目录的内容，使 `index.html` 和 `boldsite.json` 位于压缩包根目录。平台自有的 `assets/` 目录与 `static/` 分开。发布包只包含代码和前端构建产物。

运行入口是发布目录中的 `python3 app.py`，监听 `0.0.0.0`，端口读 `CAPort`，默认 9000。启动时必须提供 `DATA_DIR`，其目录独立于发布目录。两次部署应挂载同一位置。前端入口使用 `/svc/{appId}/`，项目详情使用 `/svc/{appId}/#/projects/{id}`。服务支持代理剥前缀、透传，或通过 ASGI `root_path` 提供前缀。透传无尾斜杠入口时，服务重定向到带斜杠入口。代理剥前缀时，网关负责该跳转。图纸下载链接由客户端映射到应用内的工作台路径。

SQLite 试点固定一个实例和一个 Uvicorn worker。SQLite 使用 DELETE 日志与 FULL 同步。图纸字节及元数据原子写入同一个数据库文件，同项目相同内容复用文件实体。若 `DATA_DIR` 为 NFS，需核验锁、同步语义、配额和恢复能力，服务滚动发布也须避免双实例共写。正式多实例优先采用 PostgreSQL 和私有对象存储。试点服务当前依赖平台网关做访问控制，未实现项目级授权。

### Linux 依赖

先用标准库探针确认平台 Python 小版本、实现、CPU 架构和 libc。2026-11-25 线上探针回传 CPython 3.11.2、Linux x86_64、glibc 2.36 和 SQLite 3.40.1。以下命令选用匹配的 CPython 3.11 与 manylinux 2.28 Wheel。

```sh
uv pip install --python-version 3.11 --python-platform x86_64-manylinux_2_28 \
  --only-binary :all: --target /path/to/new-release/vendor \
  -r /path/to/new-release/requirements.txt
```

`app.py` 会优先加载发布目录中的 `vendor/`。原生 Linux CI 也用二进制 Wheel 安装到这个位置并运行契约测试。发布前核对 `pydantic_core` 和 Pillow 的原生扩展与探针一致。 CLI 1.0.5 干跑会扫描 `vendor/`，此次仅依赖目录触发路径、写盘及端口启发式告警。按真实运行时重打包后重新扫描，并向平台核对依赖目录的处理方式。重新选择运行时后，用一个新发布目录重新安装依赖。

### 同事试用的 SQLite 访问保护

业务包使用单 worker。初始化和每个 SQLite 连接都持有同一 DATA_DIR 下通过原子 mkdir 取得的排他目录，读写不会在不同应用进程间重叠进入数据库。竞争请求等待最多约三秒后提示重试。锁路径不设置超时接管，避免在旧进程仍可能写入时出现双写。若实例被强制回收后留有目录，由平台运维在确认没有运行实例和数据库访问后清理空锁目录，再恢复服务。生产项目采用独立数据库和私有制品存储方案。

通过官方干跑确认第三方依赖是唯一告警来源，并核对实际调用路径。仅当告警均来自已审阅的依赖通用实现或示例时，使用官方 CLI 提供的误报处理选项。应用先由所有者验证，再在「我的应用 → 更多 → 权限管理」设为指定成员可见，保持应用广场未上架。按名单精确匹配公司账号，授予访问权限。源码更新继续走 GitHub PR，发布时保留本机已绑定的 appId。

线上试用部署 15285 验证了虚构项目新建和图纸上传下载，但网关对项目保存请求返回通用 HTTP 500。15305 在同一应用更新了试用的保存、回收站和恢复传输，改用工作台路径下的 POST 写入端点，版本值与原合同的 If-Match 语义一致。真实平台已复核资料保存、刷新后的风格、旧图纸留存以及白名单模式。普通 Fastify 继续使用原 OpenAPI 的 PATCH、DELETE 和 POST。

## 真实平台验收

使用官方 CLI 的飞书设备授权获取部署身份。真实平台以诊断包实测为准。CLI 1.0.5 已确认可用 `--dir` 指定发布目录，`--dry-run` 校验，部署成功在发布目录回写 `appId`。保存绑定后的清单供同应用更新，勿上传到代码仓库。参见 [站内 CLI 指南](https://ai.insta360.cn/sites/cli-guide)和[飞书使用手册](https://arashivision.feishu.cn/wiki/VYdWwwZ84iBmrtkyWtHcyK6kngc)。

1. 用指定部署所有者在站内指南完成 CLI 登录。创建单独的诊断应用，设为仅所有者或指定成员可见，关闭应用广场上架。CLI 新应用默认仅个人可见且未上架，发布后用 `boldsite status --app <应用名>` 核对 `visibility`、`listed` 和所有者角色。
2. 将 `tools/boldsite/probe/` 的内容作为最小发布目录。先运行 `boldsite deploy --dir <探针目录> --dry-run`，通过后使用 `boldsite deploy --dir <探针目录>` 部署，打开 `/svc/{appId}/`，核对相对探针和测试文件下载。探针只写随机虚构标记并用临时 SQLite 比较两个写连接，再备份恢复一条合成记录。若标记失败，读取 `fixtureError` 的阶段和错误码，SQLite 仍独立验证，文件系统回显只含类型、只读状态及挂载关系。记录运行时、实例标识、文件哈希、锁结果及回显版本。
3. 用相同应用 ID 发布另一个带不同 `release.txt` 的版本。分开验证重启和换包，确认版本切换、实例 ID、持久文件哈希、访问设置。用未授权登录会话和未登录会话分别直测网页、探针 API 和文件 URL，记录拒绝结果。再让平台确认实例上限、滚动发布是否会重叠、`DATA_DIR` 的挂载类型、配额和恢复方法。探针的锁结果只覆盖同实例上的两个连接。
4. 若证据支持私有访问和单实例 SQLite，发布打包后的工作台试点，用虚构项目和假图纸验证保存、详情刷新、上传下载、未授权 API 和文件访问拦截。使用 SQLite backup 在线备份，恢复到独立目录后核对项目版本和图纸哈希。分别核对平台重启及重新部署后的数据。
5. 核实 PostgreSQL、私有对象存储和项目级授权。真实门店资料需按看板 QBS-01、QBS-02 另行确认。


2026-11-25 真实平台发布记录。探针 v1（15211）和 v2（15258）使用同一应用，实例标识改变、私有和未上架状态保留。两个版本均未生成文件哈希，暂无法比较数据留存。v3（15261）仍使用同一应用，增加目录、写入、同步、硬链接和 SQLite 备份诊断。 v3 实测 `DATA_DIR` 子目录缺失（`stat-data-dir` / `ENOENT`），最近的挂载为可读写 NFS。v4（15271）仅在该配置指向可读写 NFS 时创建缺失目录，仍需用真实写入后的哈希进行换包复验。

## 本地验收（2026-11-24）

| 场景 | 本机 Windows、Chrome 与 Python 3.12.15 | BoldSite 平台 |
| --- | --- | --- |
| 诊断示例 | PR #244 已本地验证创建、修改、假图纸上传下载与进程重启留存 | 待部署诊断包 |
| 子路径与刷新 | 隔离代理 5298 和 FastAPI 3098，验证剥前缀、透传前缀、带尾斜杠入口、静态资源和项目详情 Hash 刷新；契约测试覆盖 ASGI `root_path` | 待验证实际网关 |
| 项目保存 | Chrome 新建、修改资料、保存、刷新重开；旧窗口保存返回 409。契约测试覆盖缺版本 428、无效参数 400、并发同版本写入、回收站和恢复 | 待验证 |
| 图纸 | PNG 下载字节与上传相同；PDF 浏览器选页上传，保留原名页码，下载为 PNG。契约测试覆盖内容校验、20 MB 上限、ETag 304 和缩略图 | 待验证上传配额与私有访问 |
| 预览 | 静态代理返回 404 显示预览提示，502 显示服务断开提示；保留导航，无业务请求 | 待验证平台预览区 |
| 数据留存 | 停启进程和从另一发布目录启动均连接同一本机 `DATA_DIR`，项目版本和两份下载字节一致 | 待验证持久盘、实例限制、重启及重新部署 |


2026-11-25 本地复验。模拟代理按平台保留路由拒绝旧路径。Chrome 在新路径通过两种转发、详情刷新、项目保存与版本冲突、PNG 与 PDF 页下载、静态预览与 502 提示。两版标准库探针验证 Windows 本机路径、SQLite 第二写连接被阻塞和换包留存。业务试点的 SQLite backup 副本通过完整性校验，恢复出一个虚构项目和两份哈希匹配的图纸。已构建 CPython 3.12、Linux x86_64 的候选依赖，并核对 Pillow 和 pydantic-core 扩展标签。候选包的运行时匹配及权限、留存、锁和恢复仍待在真实平台单独核验。

## 正式模型库

```sh
node apps/api/src/scripts/export-boldsite-catalog.ts ./资源库 /path/to/new-catalog
node tools/boldsite/package.mjs /path/to/new-release /path/to/new-catalog
```

导出器根据 `resources.lock.json` 核对正式模型清单，通过隔离的内存 PGlite 复用本机导入器与模型筛选规则。发布包仅包含已登记网页模型、平面符号、产品图和预览，不包含原图纸、SketchUp 源文件、项目数据库和凭据。产品图与预览生成独立的 WebP 版本。材质与白模优先使用官方轻量网页版本，含市场差异的模型保留两端版本。

正式模型包继续使用现有 `GET /api/v1/assets`、`GET /api/v1/assets/{assetId}` 和 `GET /api/v1/files/{fileId}` 客户端契约。Bold Site 内经同一应用的 `workbench/v1` 路径提供，所有文件以登记 ID 读取并沿用项目入口白名单。本地 Fastify 与生成类型沿用原契约。项目的方案试排页面可浏览正式库和三维预览，同一排布算法选择正式模型。没有附带正式目录的独立预览包仍使用原示例模型。

## 方案试排与浏览器出图

项目详情中的“方案试排”使用工作台已有的排布算法、平面图、三维查看器与交付编号。支持输入矩形铺位尺寸，按尽量多放、面积推荐和尽量少放查看候选，从当前三维视角导出 PNG，并下载平面 SVG 与物料 CSV。道具为虚构尺寸的程序几何，发布包不读取 OneDrive 内容。试排只保留在当前页面，下载制品后可另存；FastAPI 继续保存项目资料与假图纸，OpenAPI 无变动。

本次上线跳过空间历史与项目草稿。用于真实门店的模型库、展陈规则和媒体、识别任务、双 PDF 与 PPTX 导出仍需各自的服务和资源。以下历史接口清单供依赖核对，空间历史与草稿不在当前上线范围内。

## 方案双 PDF

从项目试排的三维视图选择“生成双 PDF”。浏览器将当前材质视角、平面图和物料组成双 PDF，沿用本机交付的 A3 双版模板和 Noto Sans SC 字体。完整版包含平面方案、总览和视角页，展示版包含平面图例及视角页。两份分别供用户下载。历史节点、草稿和服务端归档未用于这一浏览器出图入口。

## 展陈及 PPTX

先创建新的正式模型快照，再用以下命令附加展陈数据。

```sh
node apps/api/src/scripts/export-boldsite-display.ts ./资源库 /path/to/new-catalog
node tools/boldsite/package.mjs /path/to/new-release /path/to/new-catalog
```

快照复用本机展陈入库器，按版本锁校验正式工作簿，只发布校核通过的规则、产品图、桌体和托盘配图。试排项目通过“展开展陈方案”从当前桌位按市场、SI 和正式规则生成展陈，可调整槽位后导出可编辑 PPTX。沿用原展陈幻灯片模板，保留设施标注和明细。当前入口在浏览器生成文件，展陈任务和服务端归档不参与试排。

## 原版工作台兼容候选

原试用包的界面入口由 `VITE_BOLDSITE_PROJECT_PILOT` 控制。原版兼容候选通过 `--workbench` 构建，复用线下 React 项目列表和项目工作台，路径仍使用服务子路径和 Hash 路由。旧试排书签跳至同一项目的原版编辑器。普通网页构建和现有试用包入口保持原有用法。

```sh
node tools/boldsite/package.mjs /path/to/new-release /path/to/catalog --workbench
uv pip install --python-version 3.11 --python-platform x86_64-manylinux_2_28 \
  --only-binary :all: --target /path/to/new-release/vendor \
  -r /path/to/new-release/requirements.txt -r /path/to/new-release/requirements-workbench.txt
```

候选兼容空间和方案节点、自动排布、模型校验及带版本的平面草稿。FastAPI 将现有几何、校验及排布代码作为固定构建产物执行，输入为 JSON，运行时无需 Node.js 常驻服务。实际平台会改写浏览器来源。完整包由同站受保护接口签发写入令牌，经 Content-Type 参数随写请求传输。旧实例退出后，客户端刷新令牌并重试被令牌检查拦下的请求。网关使用原 OpenAPI 的路径与数据，仅在 Bold Site 传输方式上通过 POST 承载其他写方法及 If-Match。

候选在既有 SQLite 上增加独立表，沿用项目和图纸。兼容渲染节点、视角及背景、浏览器材质出图和渲染图留存。渲染节点的展陈使用正式规则和托盘图。原版模板在浏览器生成可编辑 PPTX、展陈清单及双 PDF，FastAPI 按现有节点保存制品和交付 ZIP。上传前核对当前渲染图和展陈版本。扫描识别和全站设置仍待兼容。候选用独立目录和虚构项目验收。交付编译包通过同站 `POST /workbench/v1/nodes/{nodeId}/compiled/{kind}` 传输，节点目录和制品保存在受控 SQLite。原 Fastify 的 OpenAPI 和本机归档目录接口继续沿用。

原版项目的左栏“空间信息”保留图纸上传下载。新建空间页可通过“项目图纸”直达，扫描图识别入口暂不在 Bold Site 试用版开放。已有的 PDF 矢量识别仍可在项目图纸上传区使用。

独立展陈任务从原版“展陈方案”入口新建，无需先建项目。可上传 PNG、JPEG，或选取 PDF 的平面图与效果图页，由浏览器把选中页转为 PNG。上传后可在原版校准区增补和拖动桌位、编辑槽位并保存。更换平面图会清除桌位，更换效果图会清除效果图上的桌位标识。候选使用手动校准流程，扫描图识别继续离线复评。

可编辑 PPTX 及展陈清单 Excel 沿用原版模板。完整工作台从浏览器把两个制品通过同站 `POST /workbench/v1/display-tasks/{taskId}/compiled` 归档，FastAPI 校验任务版本及当前规则版本。任务、图纸与制品保存在同一持久目录的 SQLite 中，可刷新后继续编辑和下载。任务列表、创建、详情、校准和图片上传沿用 Fastify 的 OpenAPI 契约，编译归档是 Bold Site 专用传输。

## 后续迁移

| 批次 | 接口与依赖 |
| --- | --- |
| 空间与历史 | 节点树、节点读写、项目草稿、项目导入导出。沿用现有空间和布局校验、版本冲突及变更中的历史自动保存契约。 |
| 模型与方案 | `/assets`、`/files`、`/layouts/generate`、模型预览及场景依赖的资源。核对资源目录版本、GLB 和衍生缩略图、模型与项目引用及私有文件访问。 |
| 展陈 | `/display`、展陈任务及节点展陈、系统背景与产品图。准备规则表、模型和产品素材，核对节点版本及图片访问。 |
| 识别 | `/uploads/{uploadId}/recognize`、识别记录与 `fine` 接口、识别确认与空间节点。需要 PDF 矢量、本地识别模型及依赖、异步队列，以及可选模型密钥和对外传输确认。 |
| 渲染与交付 | 相机、渲染任务、交付生成与下载、作业状态。需要持久任务状态、幂等领取、渲染运行时、中文字体和制品存储。 |

代码、资源和数据库版本随发布记录。现有 Windows 工作台继续作为迁移核对基线。
