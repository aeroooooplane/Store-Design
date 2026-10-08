# 找回的 SI / 铺型依据与本轮衔接

2026-09-25后续业务规则更新：用户指出总表SI可能错误，要求先用正确样本、疑点隔离，并确认黑色门头/墙面/展柜可用于SI2.0判断。以下为找回来源时的历史记录，不再把总表字段视为无条件正确；最新分级证据和数据入口见 `素材库/04_training/rtx4070-clean-pilot/si-curation-v2/README.md`。

## 找到了什么

当前可访问的任务和本机归档任务列表中，没有找到另一台电脑的原始聊天。仓库中找到了完整的工作记录和数据产物，说明这项工作已经做过，而不是需要从颜色重新猜标签。

- `docs/layout-library.md`：明确要求以用户指定飞书“汇总”表的 SI形象、铺型为优先来源。
- `素材库/01_catalog/classification/master.ndjson`：925条总表记录。
- `master.manifest.json`：完整读取标记 `has_more=false`、版本249；保留了当时 `D:\text demo\...` 的导出位置，不代表当前机器存在该目录。
- `stores.json`、`match-summary.json`：418份历史目录记录中417份已匹配；快照时间为2026-09-23 14:17（北京时间）。
- `ignored-conflicts.json`：6份已按既有决定排除的冲突记录，不删除原标签，也不改飞书总表。
- 本地 Git 历史显示上述布局说明在提交 `7ab08a5`（2026-09-24）进入仓库。

本轮用 `master.ndjson` 的原始字段逐项核对417条匹配，SI、铺型和项目名无差异。未实时刷新飞书，因此这里只确认保存快照中的依据，不宣称远端今天仍是同一版本。

## 更准确的标签状态

之前笼统称“SI未核实”容易误解。现在区分：

1. **总表标签已匹配**：来源是飞书 SI形象、铺型字段，保留记录链接及匹配方法。
2. **PDF历史版本待核对**：同店可能改造、换址或更新；附件字节数一致不是内容哈希一致。
3. **图像质量另行审核**：效果图、平面图、封面、标注、碎片等，不会改变总表字段。

历史418份目录与本机358份可用PDF是不同覆盖范围，不能把417份历史匹配说成当前有417份可用PDF。

## 本轮实际推进

已为1,264张唯一底层图片创建SI/铺型来源关联，保留全部来源页和同内容PDF别名：1,230张来源标签一致、8张缺失匹配、25张涉及原有冲突排除、1张跨来源标签不同。最后1张为首轮已排除的通用城市封面背景，被两个不同SI门店复用，不代表两家门店本身的SI字段错误。

入口：`output/pdf/cleaned-v2/master-labels/page-1.html`。

关联清单：`output/pdf/cleaned-v2/master-labels/image-labels.jsonl`；每张图片保留总表SI、铺型、飞书记录链接、原始字段、匹配方式、快照时间、图纸版本状态和图像审核状态。`review-required.jsonl` 保存34张缺失或冲突项，不删除素材。全部仍为 `training_eligible=false`。

第三轮新增200张图片初审：177张效果图缩略图确认、9张内嵌标注、5张平面图或分块、1张封面、8张横向位图碎片。累计460张有视觉审核记录，2张解码失败隔离，802张仍待初审。此次没有把缩略图审核当作大图质量验收，没有改变3,355页未知图种的分类。

第三轮入口：`output/pdf/cleaned-v2/native-catalog/review-round3/index.html`。8个新碎片仅隔离，尚未恢复；第二轮的3张恢复画面保持不变。

## 可复核产物

- `素材库/04_training/pdf-cleaning-v2/master-label-reconciliation.ipynb`：标签关联和断言检查，4个代码单元已用Python标准库按序执行并保存输出；本机缺少Jupyter/nbformat，未做Jupyter内核、官方格式校验或Notebook界面视觉检查。可安装 `nbformat nbclient ipykernel nbconvert` 后运行 `python -m jupyter nbconvert --execute --to notebook --inplace <笔记本路径>` 复核。
- `master-label-join-summary.json`：来源文件哈希、匹配覆盖与标签状态统计。
- `round3-summary.json`：第三轮图片复核快照。
- `visual-decisions.json`：按图片SHA256保存的视觉审核记录；第三轮时460条，第四轮后1,262条。

没有修改原PDF、历史总表快照、既有门店匹配、远端飞书或GitHub；没有commit或push。

## 第四轮衔接（2026-09-25）

已完成剩余802张可解码底层图片的缩略图图种初审，新增727张效果图初审记录，75张进入标注、碎片、技术图、参考图、概念方案或异常复核类别。累计1,262张有视觉审核记录，另外2张解码失败隔离。所有图片仍未批准训练。这不代表12,266页PDF全部完成语义分类，也不改变3,355页未知图种状态。

已重新执行标签关联笔记本的4个代码单元；1,264张关联记录的图像状态与新目录一致，417条历史匹配的原始字段仍无差异，原有6个门店冲突排除保持不变。

第四轮入口：`output/pdf/cleaned-v2/native-catalog/review-round4/index.html`。下一阶段已选20家门店、60张起始代表图，覆盖5种已有SI/铺型组合；入口：`output/pdf/cleaned-v2/next-review/index.html`，选择依据与完整候选哈希见同目录`selection.json`。这是复核队列，不是训练集。详细顺序见`docs/data-preparation-next-steps.md`。
