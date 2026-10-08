# 真实道具接收目录

把另一台电脑生成的完整 `selected-日期时间` 文件夹放在这里，保留 DAE、SKP、贴图和 metadata.json 的相对路径。同时放入 component-inventory 清单、SU 道具截图和已知尺寸说明。

2026-09-25 已完成本机拆分：

- [正式结果目录](split-20260925-v2/index.html)：90 项资产，对应 111 个源实例。优先打开每项的 `prop-instance.skp`，保留实例缩放、旋转及组级材质，并移除原场景平移。
- [验收报告](split-20260925-v2/validation-summary.json)：90/90 通过；包括实际面片尺寸、原生 SKP 读取、材质属性、贴图引用与文件完整性。不是逐面视觉验收。
- [原文件完整性](split-20260925-v2/source-integrity.json)：导出前后 SHA256 一致。
- `first-experience-table-20260925`：最初的完整体验桌单项验证。
- `split-20260925`：第一次闪退中断的输出，已有 `INTERRUPTED.json` 标记，请使用 v2 正式结果。

桌椅组、多灯及多柜等按完整源分组保留。SI 版本、正面方向尚未标注；尚未做 GLB 转换或接入 Demo。
