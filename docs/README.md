# 文档与目录导航

更新：2026-10-04。日常以本页和根目录README为入口；按主题更新现有文档，历史进度不再充当“当前状态”。

## 当前说明

| 需要了解什么 | 入口 |
|---|---|
| 启动、操作、备份和验证 | [工作台指南](../demo/README.md) |
| 当前产品范围 | [项目范围](project-brief.md)、[使用流程](product-flow.md) |
| 实际代码与服务职责 | [架构](architecture.md) |
| 极简黑白界面 | [视觉规范](design-system.md) |
| 已做与下一步 | [后续工作](roadmap.md) |
| 本轮整理、删除与恢复 | [整理记录](maintenance-20261004.md) |
| SI标准阅读、命名及图例依据 | [SI阅读记录](si-standards-review-20261001.md)、[模型库使用指引](../素材库/04_assets/按SI标准命名-20261001/使用指引.md) |
| 真实模型接入与限制 | [SU接入说明](su-real-assets.md)、[GLB转换指引](../demo/public/assets/su/README.md) |
| 五店案例和证据 | [案例交接](case-pack-4h-handoff.md) |
| PDF处理和来源 | [清洗说明](pdf-cleaning.md)、[SI来源](si-source-recovery.md) |

## 本机目录职责

| 目录 | 内容和保留规则 |
|---|---|
| `各门店图纸/`、`道具模型/`、`设计标准/` | 原始资料，保留来源与校验值 |
| `素材库/04_assets/按SI标准命名-20261001/` | 当前90件命名SU、预览、图例、清单和指引，网站直接引用 |
| `素材库/04_assets/incoming/split-20260925-v2/` | 正式拆分及验证；定义版、实例版、纹理和DAE用途不同 |
| `素材库/06_case_packs/` | 案例、人工审核和证据 |
| `素材库/01_catalog/`、`02_previews/` | 资料索引与预览 |
| `素材库/03_training_candidates/`、`04_training/`、`05_render_benchmark/` | 历史候选、训练实验和渲染对照，保留独有成果 |
| `demo/src/`、`demo/server/` | 前端与本机文件服务 |
| `demo/scripts/`、`tools/` | 长期可复用工具；不要把正式工具只放在tmp |
| `output/si-standards-review-20261001/` | 360页标准阅读入口及交付检查，网站正在使用 |
| `output/pdf/cleaned-v2/` | PDF派生页面、原图与审核索引，部分被案例和网页服务直接引用 |
| `output/maintenance/` | 本轮变更备份、删除清单及检查结果 |
| `tmp/` | 当前仍有复现脚本、几何记录和中间件，按明确清单清理，不能整目录删除 |

## 历史记录

[早期范围与架构](archive/20261004-before-refresh/)保留当时设想；其中PDF整包、后台任务和完整施工图等内容不是当前能力。

- 开发过程：[八小时记录](web-8h-progress.md)、[开发审核](web-review-20260926.md)、[原整理记录](file-organization-20260926.md)。
- 案例过程：[逐批记录](case-pack-4h-progress.md)、[资料准备](data-preparation-next-steps.md)、[布局观察](layout-observations-batch01.md)。
- 实验资料：[训练设计](training-design.md)、[训练结果](training-results.md)、[4070计划](rtx4070-training-plan.md)、[首次试训](rtx4070-pilot-results.md)、[清洗后试训](rtx4070-clean-pilot-results.md)、[渲染对照](render-benchmark.md)。
- 专项交付：[布局升级](layout-render-upgrade-20260927.md)、[比例估算验证](fuzzy-layout-validation-20260928.md)、[几何实验](furniture-geometry-v2.md)。
- 原始盘点：[存储盘点](storage-audit-20260927.md)、[Git整理](source-control-cleanup-20260927.md)、[缺件](github-missing-assets.md)。旧盘点数字以当时日期为准。
- 早期研究见 `archive/research/`；旧实施计划见 `superpowers/plans/`，不是当前自动执行指令。

文件保留看实际引用、唯一性和可恢复性，不按目录名称或最后修改时间直接判断。本文档列出主入口，其余样本模板、导入规范和盘点保留在原路径，避免断开已有记录。

- [可摆放资产清单与再生成](asset-placement.md)
- [可交付推进记录](delivery-log-20261004.md)
