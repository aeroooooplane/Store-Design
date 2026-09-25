# 项目目录指南

更新：2026-09-26。日常只需从根目录 README 和本页进入；其余文件按用途查找，不必逐份阅读。

## 当前主线

| 要做什么 | 入口 | 定位 |
|---|---|---|
| 运行和开发网页 | [demo/README](../demo/README.md) | 源码在 demo/src，测试在 demo/tests |
| 查看正式 SU 拆分 | [90 项目录](../素材库/04_assets/incoming/split-20260925-v2/index.html) | v2 为当前交付；原定义版与实例版不是重复文件 |
| 理解真实道具接入 | [su-real-assets](su-real-assets.md) | 尺寸、变换、材质与验证约束 |
| 查看五店案例包 | [四小时交接](case-pack-4h-handoff.md) | 平面/效果参考与未解决证据，不是完整几何训练集 |
| 继续本轮开发 | [八小时进度](web-8h-progress.md) | 节点、验证、截止时间与接续位置 |
| 查看 PDF 清洗方法 | [pdf-cleaning](pdf-cleaning.md) | 派生页面与原件追溯 |
| 查 SI 依据和缺件 | [si-source-recovery](si-source-recovery.md)、[github-missing-assets](github-missing-assets.md) | 未确认保留空值和冲突 |

## 目录分工

| 路径（项目根目录下） | 内容 | 保留及新增规则 |
|---|---|---|
| 各门店图纸/ | 原始 PDF，含未就绪的 LFS 路径 | 不重命名、不删除；不视为全部已核实 |
| 道具模型/ | 原始 SU 总模型 | 保留原件及哈希 |
| 素材库/01_catalog/ | 总目录、门店标签与来源 | 元数据入口，不等于全部标签已确认 |
| 素材库/02_previews/ | 浏览用预览 | 保留被引用的预览 |
| 素材库/03_training_candidates/ | 早期候选样本 | 历史候选，不直接当正式训练集 |
| 素材库/04_assets/incoming/split-20260925-v2/ | 正式 90 项拆分及验证 | 网页转换从此读取，原件不改 |
| 素材库/04_assets/incoming/ 其他批次 | 初次导出、旧拆分 | 历史追溯，不与 v2 混用 |
| 素材库/04_training/ | 清洗索引、实验数据、旧权重 | 保留，暂不自动训练 |
| 素材库/05_render_benchmark/ | S03 白模和 AI 对比 | 参数化实验；AI 图未经几何交付批准 |
| 素材库/06_case_packs/20260925-four-hour/ | 五店证据、双用途参考、检查结果 | 当前案例包主入口，按店/版本关联 |
| output/pdf/cleaned-v2/ | 拆分页、原生图、文本等 | 被案例引用的派生源，不是可直接删的缓存 |
| output/pdf/ 其他批次 | 旧清洗/诊断结果 | 先核引用再归档，不凭目录名删除 |
| tools/pdf-review/、render-benchmark/、sketchup/、training/ | 可复现脚本 | 按处理阶段维护，运行环境不搬移 |
| tmp/ | SU 拆分临时脚本及诊断记录等 | 当前包含有效复现材料，不可整目录清空；新增长期脚本放 tools |
| demo/ | 当前网页 | 新功能只在此开发；发布资源与原始大文件分开 |
| docs/archive/research/ | 历史外部路线调研 | 不当作当前产品承诺 |
| docs/superpowers/ | 设计及实施记录 | 活跃计划由进度页指定 |

## 其余文档分组

- 产品与规则：project-brief、product-flow、architecture、roadmap、layout-library。旧方案中的施工/完整交付设想，以当前“平面图 + 多角度效果图 + 网页三维”的用户范围为准。
- 资料及样本：input-materials、asset-inventory、asset-ingestion-plan、real-sample-review、layout-observations-batch01、sample-case-template、data-preparation-next-steps。
- 历史实验：training-design、training-results、rtx4070-training-plan、rtx4070-pilot-results、rtx4070-clean-pilot-results、furniture-geometry-v2、render-benchmark。保留日期上下文，早期“无 GPU”和“SKP 未拆分”不是当前状态。
- 审核过程：case-pack-4h-progress 保留逐批记录；日常看 case-pack-4h-handoff，不再重复维护第二份四小时总结。

## 整理原则

只保留一个当前导航；技术证据不压成不可追溯的大文件。现有资料路径有大量 JSON/脚本引用，先归位入口和历史研究，避免为了目录整齐打断证据链。新增浏览器资产应有 asset_id、原始来源、单位与尺寸，不混入原始 SU 目录。清理详情见 [本轮整理记录](file-organization-20260926.md)。
