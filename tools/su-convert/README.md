# SketchUp 模型 → 网页 GLB

把 `tools/sketchup/export_selected.rb` 导出并通过校验的 DAE 转成网页模型 `model.glb`，再做几何压缩和朝向复核。2026-10-09 入库的 38 个网页模型都由这套脚本生成。2026-10-13 从旧版 `demo/scripts` 原样移到这里，脚本只改了仓库根目录的推算方式，依赖版本与当时一致。

这是一个独立的 npm 项目，不在 pnpm workspace 里。需要本机安装 Microsoft Edge（无头运行 three.js 的 ColladaLoader 和 GLTFExporter）。

```powershell
cd tools/su-convert
npm ci                                  # 首次
# 1. 转换（必须写明模型编号；已有的输出不会被覆盖）
$env:SU_SPLIT_DIR = '资源库/90_处理过程与审核/模型拆分/dae-20261009/split-20260925-v2'   # 相对仓库根目录，需在仓库内
$env:SU_MAX_TEXTURE_SIZE = '2048'; $env:SU_JPEG_FOR_JPG = '1'                         # 10-09 使用的参数
npm run convert -- asset-2595882
# 2. 在 资源库/04_模型库/manifest.json 中为该模型填写 web_model（指向它的 网页模型 目录）
# 3. 几何压缩（dedup、weld、meshopt；校验尺寸、底部与居中）
npm run compress -- asset-2595882
# 4. 五向渲染复核正面方向与材质，输出对照页
npm run review -- <输出目录> asset-2595882
```

之后回到仓库根目录运行 `pnpm catalog:white`、`pnpm catalog:finish`、`pnpm catalog:import`，网站才会使用新模型。

### Tripo MM93 原材质与运行性能

AI 原生 PBR 模型不沿用 SketchUp 的减面、去法线和缩贴图策略。MM93 原件先做 SHA256 校验，再生成仅追加材质 `extras.storeDesignPreserveAppearance=true` 的运行源；原始 BIN、UV、PBR 与三张 4K 图片不改。材质构建器对全材质明确标记的文件使用无损 Meshopt 编码，不量化或过滤浮点属性；普通模型继续原有构建规则。

在仓库根目录装好 pnpm 依赖，且本工具依赖已安装后执行：

```powershell
node tools/su-convert/scripts/prepare-mm93-runtime.mjs <Tripo原始GLB> <新的外置运行目录>
node tools/su-convert/scripts/benchmark-mm93-runtime.mjs <运行目录> <Tripo原始GLB> <新的外置实测目录>
```

第一个命令调用与 `catalog:white` / `catalog:finish` 相同的构建器，输出白模、材质版、记录与保真核验。第二个命令仅在 5268 端口运行真实 WhiteScene，检查冷加载、旋转、重复放置、移除重加、共享 GPU 纹理、原材质状态及页面错误，并复核预加载、两种导出、地面图形恢复和 X6。端口必须空闲，资源库需已接入并包含 X6 的两种运行模型；不会写数据库或共享资源。性能回执只代表该机与所测视口，不是所有设备的保证。

此步骤不发布模型。正式入库仍按资源发布流程核对尺寸、朝向、五向图、manifest、资源锁与 `catalog:import`。4K 材质三张完整 RGBA8 mipmap 纹理约占 256 MiB 显存（估算），白模不加载这些图片；同一模型的多次放置共享几何和纹理。

| 文件 | 作用 |
|---|---|
| `scripts/convert-su-assets.mjs` | DAE → GLB：统一米制、Y 向上、底部中心原点，核对尺寸，写 `conversion.json` |
| `scripts/compress-glb.mjs` | 无损去重与焊接后做 meshopt 压缩，结果记入 `conversion.json` 的 `compression` |
| `scripts/render-glb-review.mjs` | 五个方向的对照图，供人工复核朝向 |
| `src/asset-normalization.js` | 在浏览器里归一化场景（被转换脚本按 `/src/…` 加载） |
| `server/model-library-paths.mjs` | 按 `manifest.json` 找到模型库目录 |

验证记录（2026-10-13）：用 asset-2595882 的 DAE 分别以原 `demo/scripts` 与本目录各运行两次“转换 + 压缩”，四次结果都与入库的 `model.glb`（sha256 `18b202df…`）逐字节相同。转换后、压缩前的中间文件每次运行会有几个字节的差异：贴图异步编码的完成顺序决定了二进制段里的排列，旧脚本本来如此，压缩后一致。复核渲染的输出两边逐字节相同。


## S2完整实例提取

`asset-90000002`从`asset-569180`四件组合保留一只完整白色空心H350实例，450×450×350mm。脚本`node scripts/extract-training-stool.mjs`校验源SHA、四实例、三网格/504三角面、底部中心和回读尺寸，不缩放；不生成独立SKP。它要求RESOURCE_ROOT中的manifest已登记目标条目，并会重建目标文件，仅由资源协调窗口在备份后执行。随后走既有compress/review、catalog:white、catalog:finish、catalog:import流程。

本机发布版为`models-20261030-12`，资源及哈希见[发布记录](../../docs/model-publication/20261030/s2/README.md)。新增OneDrive同步及跨机使用未验证。

## SI2.0 字母凳单张与坐凳缩略图

`asset-90000005`从`asset-15903874`四件组合中保留未变形的`SketchUp_Instance_1`，完整凳体与软垫共2网格、576三角面。仅水平转正并移到底部中心，450×450×450mm，不缩放。源组合首张被压至421.875mm，因此不选它。保留原材质、两张贴图和源组合SKP，不生成独立SKP。

所有工具现在支持与API一致的`RESOURCE_ROOT`（其下为`04_模型库`）。普通开发必须使用独立资源副本；新提取脚本会拒绝默认或共享资源根，且不会覆盖已有输出。先在副本manifest中登记目标条目，再执行：

```powershell
$env:RESOURCE_ROOT = 'C:/隔离输出/资源库'
node tools/su-convert/scripts/extract-letter-stool.mjs
node tools/su-convert/scripts/compress-glb.mjs asset-90000005
$env:SU_REVIEW_PORT = '5256'
node tools/su-convert/scripts/render-glb-review.mjs 'C:/隔离输出/五向' asset-90000005
node tools/su-convert/scripts/render-seating-thumbnails.mjs 'C:/隔离输出/缩略图'
pnpm catalog:white asset-90000005
pnpm catalog:finish asset-90000005
# DATABASE_URL与STORAGE_ROOT也必须设置为隔离目录，再运行catalog:import。
```

缩略图工具直接读取四款实际GLB，校验尺寸、组合四张和透明背景。SI1.0只在缩略图中使用较深灰色，模型材质不改；输出透明PNG，前端使用压缩WebP并沿用卡片背景。资源增量由发布负责人核对备份后统一发布，记录见[本轮清单](../../docs/model-publication/20261127/seating/README.md)。

## MM93 赛车原版预览

用户反馈原修整版与 Tripo 外观出入过大，之前的外观修整候选已撤回。当前直接以用户原始 GLB 生成预览，内嵌模型字节不改，保留全部原 UV、三张 4K 贴图、PBR 参数、几何和数值尺寸。没有新增贴花、重绘、降纹理或减面，尚未正式入库。模型和离线预览不新增到 Git 或 LFS。

```powershell
node scripts/build-mm93-viewer.mjs <原始TripoGLB> <新输出目录>/Tripo原版预览.html
node scripts/verify-mm93-original.mjs <原始TripoGLB> <新输出目录>/Tripo原版预览.html <新核对目录>
```

默认只接受已核对的原始源 SHA，拒绝将改过的 GLB 标为原版。原版按其实际 −X 车头配置相机，不对模型做变换；采用深色背景，不提供改写标识的开关。离线 HTML 支持四视角、转向和缩放，无外部网络依赖。不同环境光会影响明暗，但不会改模型材质与纹理。历史外观实验只可通过 `repair-mm93.mjs ... --allow-appearance-changes` 显式复现，历史预览需 `--legacy-repaired`，均不作为当前交付，详见[审核记录](../../docs/model-publication/20261127/mm93/README.md)。
