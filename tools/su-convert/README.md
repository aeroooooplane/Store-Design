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

| 文件 | 作用 |
|---|---|
| `scripts/convert-su-assets.mjs` | DAE → GLB：统一米制、Y 向上、底部中心原点，核对尺寸，写 `conversion.json` |
| `scripts/compress-glb.mjs` | 无损去重与焊接后做 meshopt 压缩，结果记入 `conversion.json` 的 `compression` |
| `scripts/render-glb-review.mjs` | 五个方向的对照图，供人工复核朝向 |
| `src/asset-normalization.js` | 在浏览器里归一化场景（被转换脚本按 `/src/…` 加载） |
| `server/model-library-paths.mjs` | 按 `manifest.json` 找到模型库目录 |

验证记录（2026-10-13）：用 asset-2595882 的 DAE 分别以原 `demo/scripts` 与本目录各运行两次“转换 + 压缩”，四次结果都与入库的 `model.glb`（sha256 `18b202df…`）逐字节相同。转换后、压缩前的中间文件每次运行会有几个字节的差异：贴图异步编码的完成顺序决定了二进制段里的排列，旧脚本本来如此，压缩后一致。复核渲染的输出两边逐字节相同。
