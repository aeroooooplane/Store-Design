# 影石门店智能空间设计工作台

真实 SU 道具接入：[原始模型预检目录](素材库/04_assets/source-inspection/index.html) · [接入方案与当前依赖](docs/su-real-assets.md)。已读取 40 张嵌入组件预览及 671 个材质条目；真实网格尚待 SketchUp / SDK 读取，未替换白膜道具。

新版 AI 验证：[SI1.0 两机位增强与叠加检查](素材库/05_render_benchmark/s03-v2/ai.html)。开箱桌空隙、体验桌底座与后柜层板的可见形态保留较好，细节和遮挡处仍未通过几何验收；准确多视角继续以三维场景为依据。

道具结构深化：[v2 双机位白膜与材质对照](素材库/05_render_benchmark/s03-v2/index.html)。Demo 可选择四类道具结构并保存快照；三种风格共用道具几何。仍是参数化示意，真实 SKP 尚未导入。[实现与限制](docs/furniture-geometry-v2.md)。

首轮大模型渲染实验：[同一场景双机位、双SI对比](素材库/05_render_benchmark/s03-v1/index.html)。已实际生成4张AI增强图并尝试1次局部修正；视觉表现改善，但几何尚未验收。输入、提示词、原图与检查记录均保留。

最新进展：已完成11家门店的体验桌数量模型训练并接入Demo实验开关；SI1.0/2.0各完成一次本地tiny LoRA训练流程验证。正式效果图风格模型尚未训练。[查看实验报告](素材库/04_training/index.html) · [结果与限制](docs/training-results.md) · [复现训练](tools/training/README.md)。

这是一个面向影石门店设计的智能空间设计项目。用户输入门店尺寸和基础条件，系统生成多个软装平面方案；用户在网页中调整方案后，系统生成标准平面图、白膜模型、不同风格的效果图，并将最终成果整理为 PDF 交付包。

## 当前已确定的产品方向

- 生成 4 个候选平面方案，供用户选择。
- 平面方案支持网页端软装调整。
- 平面确认后生成标准化平面图。
- 风格选择位于标准平面图之后、白膜和效果图之前。
- 当前支持两种影石门店风格：
  - SI1.0：灰色调，默认生成。
  - SI2.0：黑色调。
- 用户可以选择只生成 SI1.0、只生成 SI2.0，或同时生成两种风格。
- 所有方案、调整和渲染结果通过树状分支保存，用户可以回到历史节点继续生成。
- 最终输出平面图、软装物料清单、效果图和白膜预览组成的 PDF。

## 文档

- [项目需求说明](docs/project-brief.md)
- [产品流程与分支树](docs/product-flow.md)
- [技术架构建议](docs/architecture.md)
- [第一阶段执行计划](docs/roadmap.md)
- [待收集资料清单](docs/input-materials.md)
- [当前素材盘点](docs/asset-inventory.md)
- [大型素材分批处理方案](docs/asset-ingestion-plan.md)
- [第一批候选样本索引](<素材库/01_catalog/sample-set.csv>)
- [GitHub 相关项目调研](docs/github-research.md)
- [Demo 使用说明](demo/README.md)
- [真实样本内容核验与接入进度](docs/real-sample-review.md)
- [布局规则库：标签与训练样本规范](docs/layout-library.md)
- [门店标签与页面检索表](素材库/01_catalog/classification/index.html)
- [SketchUp 单道具导出说明](tools/sketchup/README.md)

## 当前第一步

先收集并整理一套完整的历史门店样本，至少包括：一张平面图、对应效果图、门店尺寸、软装清单，以及它属于 SI1.0 还是 SI2.0。第一阶段先用一个规则明确的矩形门店做闭环验证，再扩展复杂户型。
