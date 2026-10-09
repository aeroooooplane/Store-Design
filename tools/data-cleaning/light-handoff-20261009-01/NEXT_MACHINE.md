请接手门店设计图纸清洗，先完整阅读本目录 README.md、bundle-manifest.json 和 previous-handoff/给另一台Codex的接续指令.txt。旧交接文中的完整缓存迁移命令已被本次轻量方案替代。

当前任务：迁移后从原 PDF 重建扫描/OCR/自动几何等机器阶段，同时继承可追溯的人工修正记录；最终完成所有来源的逐图核验、版本分组、标准标注和质检。原电脑仍暂停，原数据未删除。不要把机器缓存未迁移说成任务或人工成果全部丢失。

1. 先检查 Git 分支/工作区，不覆盖本机已有文件，不运行 git reset --hard 或 git clean。只读核对基础代码和轻量包完整性。
2. 读取 资源库/06_生成流程文档/02_平面图与效果图提取.md 权威规范，以及原任务要求的索引、模型 manifest、网页坐标与布局规则。
3. 按 README 建环境，bootstrap.py 默认预检；--prepare 用 SHA256 绑定本机 PDF，固定原 source_id，创建新输出和缓存命名空间。缺图纸则明确报告，不擅自跳过或重编号。
4. 用新 run_rebuild.py 单进程分阶段运行。不要用旧 continue_all.py，也不要用要求全量缓存的 resume_checkpoint_v2.py。原下载目录只读。
5. history/、previous-handoff/ 是历史参考，不能恢复为新计算已完成的凭据。人工修正必须按 source_sha256 + 物理页码和原始矢量证据应用到新草稿，再查看新叠加图。历史PNG未上传。
6. 优先复核柜体外轮廓、尺寸数字对应的实际刻线/端点、x/z两个方向误差<=2%，再核验20家试点及全部门店。历史试点仍全部partial。视觉批次004未应用，不能继承为已完成。PDF239修订结论以最终图签读数记录为准。
7. training_eligible 始终 false，version_confirmed 始终 false；不得写 approved:true 或审核人。读不到的尺寸和不确定内容填 null，不用面积或图片比例猜测。
8. 原图纸和旧输出不可覆盖、移动、删除。新结果失败只记录，不中断其他来源；所有修复写新修订并记录替代关系。不导出批准效果图，不改 demo/、tools/ 旧文件或索引。
9. 自动阶段结束后，继续每家每版本标准 source/input/target-layout/review + evidence/geometry/overlay；逐图真正打开核对；完善 render 区域清单、名称映射、冲突清单和最终质检。所有 JSON 的 schemaVersion/generatedAt/generator 要保留。
10. Git 授权仅针对此次轻量迁移文件；不要把新的大缓存/原PDF、其他开发改动或未来任务成果自动推送。最终汇报有文件依据的处理数、complete/partial/failed、候选训练数及未完成原因。
