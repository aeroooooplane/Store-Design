# 已归档文件索引

2026-10-13 架构评审清理（[报告](../architecture-review-20261013.md) §4）从 main 删除了不再描述当前系统的文件。删除前的完整版本保存在 Git 标签 `archive/pre-cleanup-20261013`（指向合并 PR #45 的 f2c507b3），随时可以恢复：

```powershell
git fetch origin tag archive/pre-cleanup-20261013
git show archive/pre-cleanup-20261013:docs/web-8h-progress.md          # 只查看
git checkout archive/pre-cleanup-20261013 -- docs/web-8h-progress.md    # 恢复到工作区
git ls-tree -r --name-only archive/pre-cleanup-20261013 -- docs         # 列出当时的文件
```

## 文档（批次 2）

| 类别 | 文件（`docs/` 下） |
|---|---|
| 旧版 demo 的开发与审核 | web-8h-progress、web-review-20260926、file-organization-20260926、layout-render-upgrade-20260927、fuzzy-layout-validation-20260928、furniture-geometry-v2、delivery-log-20261004、maintenance-20261004 |
| 旧版范围与说明 | project-brief、product-flow、roadmap、asset-placement、su-real-assets、asset-ingestion-plan、asset-inventory、github-missing-assets |
| 案例与样本 | case-pack-4h-handoff、case-pack-4h-progress、real-sample-review、layout-library、layout-observations-batch01、sample-case-template |
| 训练与渲染实验 | training-design、training-results、rtx4070-training-plan、rtx4070-pilot-results、rtx4070-clean-pilot-results、render-benchmark |
| 盘点 | storage-audit-20260927、source-control-cleanup-20260927 |
| 更早的归档 | archive/20261004-before-refresh/（architecture、product-flow、project-brief、roadmap）、archive/20261009-before-refactor/architecture.md（重构前的实际架构）、archive/research/（github-research、llm-rendering-decision） |
| 旧实施计划 | superpowers/plans/（2026-09-23-training、2026-09-26-web-workbench、2026-10-04-delivery、2026-10-04-indexeddb） |

以下历史文档仍原地保留，因为有脚本引用：`pdf-cleaning.md`、`si-source-recovery.md`、`data-preparation-next-steps.md`（`tools/store-archive/register_legacy.py`），`si-standards-review-20261001.md`（`tools/library/refresh-library.mjs` 等）。

## 脚本与中间件（批次 3）

| 路径 | 内容 |
|---|---|
| `tmp/`（36 个） | 09-25 至 10-04 的 SketchUp 拆分复现脚本、纯净平面图例发布记录、PDF 图例裁片脚本、SI 手册文本提取。其中唯一的命名决策记录已移到 `资源库/05_店铺形象设计标准/历史阅读记录/命名决策-20261001.txt` |
| `output/maintenance/`、`output/分支合并-20261008/` | 10-04 整理检查记录、10-08 snapshot 合并说明 |
| `tools/pdf-review/`、`tools/render-benchmark/` | 09-23 PDF 分类与标签、S03 渲染对照（依赖已废弃的 demo Playwright） |
| `tools/sketchup/` 的 `build_model_catalogue.py`、`publish_clean_legends.py`、`render_clean_legends.rb` | 旧模型预览目录与纯净图例发布链（依赖已删除的 `plan_legend` 字段与 `tmp/clean-legends`） |
| `tools/library/restructure-20261010.mjs`、`tools/cleanup-review-copies.py`、`tools/connect-existing-feishu.ps1` | 一次性重排、副本清理、飞书凭据恢复脚本 |
| `apps/api/src/scripts/inspect-glb-parts.ts`、`trim-glb-parts.ts` | 一次性 GLB 部件排查与裁剪 |

已删除且不需要恢复：`资源库/00_资源索引/历史目录/` 下的两张飞书授权二维码（已过期，用户 2026-10-13 确认）。

原地保留：`tools/training/`（被 `tools/store-archive/register_legacy.py` 统计文件数）、`tools/data-cleaning/`、`output/图纸*-20261008/`（门店图纸整理在用）。
