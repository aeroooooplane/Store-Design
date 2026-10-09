# 网页模型实体

2026-10-09：38 件软装已从 [DAE 交付](../../90_处理过程与审核/模型拆分/dae-20261009/README.md)（PR #3）转换为 GLB，由 Git LFS 跟踪；本机服务继续使用 `/assets/su/<asset-id>/model.glb` 地址。旧版工作台开放摆放其中 22 件（`demo/src/data/placement-policy.json` 的 `webAssets`），其余留给新版模型目录导入。

## 每件目录

| 文件 | 内容 |
|---|---|
| `model.glb` | 米制、Y 向上、底部中心原点；只含三角面（SketchUp 游离边线已去除）；贴图最长边 2048，原 JPG 贴图保持 JPEG；几何经 meshopt 压缩，加载需 `MeshoptDecoder` |
| `conversion.json` | 源 DAE 路径与 SHA-256、转换前后尺寸、贴图处理与去除线段数、压缩工具与压缩前哈希、最终 GLB 哈希与字节数 |

`facing.json` 记录每件的正面方向（顾客面对的一面；收银类另记员工侧；`any` 表示四面使用），依据为五向核对图。

## 重新生成

需先按 DAE 交付说明运行 `Join-DaeArchive.ps1` 合并并解压到 `dae-20261009/split-20260925-v2/`（已被 Git 忽略）。在 `demo` 目录：

```powershell
$env:SU_SPLIT_DIR = "资源库/90_处理过程与审核/模型拆分/dae-20261009/split-20260925-v2"
$env:SU_MAX_TEXTURE_SIZE = "2048"
$env:SU_JPEG_FOR_JPG = "1"
node scripts/convert-su-assets.mjs asset-编号 ...      # 转换，尺寸与原点不符即中止，不覆盖已有结果
node scripts/compress-glb.mjs                          # 压缩，解码后复核尺寸与原点再替换
node scripts/render-glb-review.mjs <输出目录>           # 五向核对图，并核对浏览器加载后的尺寸
node scripts/build-placement-manifest.mjs              # 刷新旧版摆放清单
```

转换前后尺寸误差上限 1 mm。核对图只用于人工检查朝向与材质，不代替品牌材质验收。
