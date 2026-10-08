# SketchUp 导出入口

2026-09-25：已在本机 Windows 11 的 SketchUp 2026（26.0.429）实际运行。原 SKP 文件头为 26.1.189。首张完整体验桌已导出到 `素材库/04_assets/incoming/first-experience-table-20260925`，DAE 尺寸误差小于 0.001 mm，12 张贴图均可读取。原模型不保存、不覆盖。

本次正式结果：[90 项资产目录](../../素材库/04_assets/incoming/split-20260925-v2/index.html)，对应 111 个源实例。90 项实例版 SKP 均已通过实际读取、面片尺寸、组合变换及组级材质属性核对；源文件哈希一致。原始 `export_selected` 输出的 `prop.skp` 只包含定义，正式目录另外提供 `prop-instance.skp` 保留实例效果。执行过程及限制见 [接入记录](../../docs/su-real-assets.md)。

批处理注意：在耗时导出前显式停止一次性定时器，防止 SketchUp 在处理事件时重入；去重需比较原始变换矩阵而非归一化轴向量。接近单位矩阵的微小缩放可能在保存时丢失，实例版使用额外变换包装并重新读取验证。

1. 在 SketchUp 中打开原模型，打开 Ruby Console。
2. 执行 `p = UI.openpanel('Select export_selected.rb', '', 'Ruby Files|*.rb||'); load(p) if p`，选择本目录的脚本。
3. 执行 `InstaAssetExport.inventory` 生成组件名称、数量、局部包围盒清单。
4. 退出组件编辑，在模型根层只选择一个展柜/体验桌组件或组。
5. 执行 `InstaAssetExport.export_selected`，在脚本旁边的 `exports/selected-时间戳` 得到单道具 SKP、DAE、贴图及元数据。完整目录拷回项目的 `素材库/04_assets/incoming/`。

便携工具包：`素材库/04_assets/handoff/Insta360-SU-kit-v1.zip`；完整步骤见本目录 `另一台电脑操作说明.md`。本次执行环境为 Windows 11 / RTX 4070，SketchUp 位于 `D:/新建文件夹 (2)/SketchUp`。

先验证一个组件，避免批量导出 1GB 模型。实例缩放、旋转、继承材质、透明贴图需核验；不把包围盒直接当作产品规格。

后续：转换 DAE 为 GLB，统一米制、Y向上、底部中心原点，并比较贴图与原模型效果后才加入 demo。

依据：[官方导出选项](https://ruby.sketchup.com/file.exporter_options.html)、[ComponentDefinition.save_copy](https://ruby.sketchup.com/Sketchup/ComponentDefinition.html)。GLB 导出无 selection-only 选项，故这里采用支持选择集的 DAE，避免误导出整个大模型。
