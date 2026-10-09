# 38 件软装道具 DAE 交付

复用本机 `素材库/04_assets/incoming/split-20260925-v2/` 中于 2026-09-25 使用 SketchUp 26.0.429 导出的结果。本次没有重新导出或修改任何源 SKP。

- 成功 38 件，失败 0 件；原 `validation-summary.json` 中均为 `passed`。
- 逐件解析 DAE 活动场景、嵌套实例变换和面片顶点，按 XYZ 毫米核对单件模型 manifest 的 `tight_face_bounds_xyz_mm`，最大误差 **0.0052822158729668445 mm**，全部小于 1 mm。
- 9,935 个贴图文件引用均存在，图像结构检查通过；无贴图引用的模型无需贴图文件。
- ZIP CRC 及包内 SHA256 清单逐项校验通过。

## 下载与使用

原始 `dae-20261009.zip` 大小 **659,043,148 字节（628.51 MiB）**。GitHub 交付采用 `zip-parts/` 下的 10 个分卷，每卷最多 64 MiB，通过 Git LFS 并行上传。合并后的 ZIP 与本机原始文件完全一致。请下载实际 LFS 内容，勿将指针文件当作分卷。已克隆仓库可在此 PR 分支运行：

```powershell
git lfs pull --include="资源库/90_处理过程与审核/模型拆分/dae-20261009/zip-parts/*.part*"
powershell -NoProfile -ExecutionPolicy Bypass -File "资源库/90_处理过程与审核/模型拆分/dae-20261009/Join-DaeArchive.ps1"
```

压缩包 SHA256：`2e76954ebf6795fa98dba23af0ba7ab356422e87be369b3fffa1b8230259df4c`。同目录的 `SHA256SUMS.txt` 提供此校验值。

合并脚本逐卷检查文件大小和 SHA256，再校验最终 ZIP；若目标文件已存在则拒绝覆盖。可用 `-OutputDirectory` 指向另一个已存在的空目录。原始完整 ZIP 与本机解压副本均不重复提交到 Git。

完整解压后，入口是 `split-20260925-v2/manifest.json`。每件资产 `folder` 对应目录下的 `prop.dae` 可用于转换 GLB。保留全部贴图相对路径；读取 DAE 的单位 `meter=0.0254`、`Z_UP` 及实例变换，不要直接把原始坐标当作米。

包内只含指定的 38 件资产及审计文件，不含 SKP。历史 metadata 中的绝对路径、`recommended_skp` 等字段仅用于溯源；对应 SKP 未随包提供。历史实体包围盒可能包含非面片实体，以本次 tight face 尺寸核对结果为准。

## 审计文件

- `verification-20261009.json`：每件 DAE 的 SHA256、贴图列表、XYZ 尺寸和误差。
- `errors.json`：空列表，最终无失败项。
- ZIP 内的 `SHA256SUMS.txt`：包内除清单自身之外的全部文件校验值。
- `verify_and_package.py`：本机复核和打包脚本，依赖 Python、NumPy、Pillow 及原始本地导出目录。它按当前目录定位仓库，仅用于复现原交付环境，不是 GLB 转换器。脚本拒绝覆盖已存在的打包子目录或 ZIP；重新打包应先建立同层带时间戳的新目录，将脚本放入其中再运行。

超大贴图采用 Pillow `verify()` 检查文件结构，不展开完整像素缓冲区。此次没有逐面视觉渲染验收或进行 GLB 转换。
