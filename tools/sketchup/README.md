# SketchUp 导出入口（未在 SketchUp 内运行验证）

本机未发现 SketchUp/Blender 安装，原 SKP 文件头为 26.1.189。此脚本供能打开源文件的 SketchUp 桌面版使用；原模型保持不变。

1. 在 SketchUp 中打开原模型，打开 Ruby Console。
2. 执行 `p = UI.openpanel('Select export_selected.rb', '', 'Ruby Files|*.rb||'); load(p) if p`，选择本目录的脚本。
3. 执行 `InstaAssetExport.inventory` 生成组件名称、数量、局部包围盒清单。
4. 退出组件编辑，在模型根层只选择一个展柜/体验桌组件或组。
5. 执行 `InstaAssetExport.export_selected`，在脚本旁边的 `exports/selected-时间戳` 得到单道具 SKP、DAE、贴图及元数据。完整目录拷回项目的 `素材库/04_assets/incoming/`。

便携工具包：`素材库/04_assets/handoff/Insta360-SU-kit-v1.zip`；完整步骤见本目录 `另一台电脑操作说明.md`。另一台机器已确认 Windows 11 / RTX 4070，SketchUp 版本、显存、驱动尚待检查。

先验证一个组件，避免批量导出 1GB 模型。实例缩放、旋转、继承材质、透明贴图需核验；不把包围盒直接当作产品规格。

后续：转换 DAE 为 GLB，统一米制、Y向上、底部中心原点，并比较贴图与原模型效果后才加入 demo。

依据：[官方导出选项](https://ruby.sketchup.com/file.exporter_options.html)、[ComponentDefinition.save_copy](https://ruby.sketchup.com/Sketchup/ComponentDefinition.html)。GLB 导出无 selection-only 选项，故这里采用支持选择集的 DAE，避免误导出整个大模型。
