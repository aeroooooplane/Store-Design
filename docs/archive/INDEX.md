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
