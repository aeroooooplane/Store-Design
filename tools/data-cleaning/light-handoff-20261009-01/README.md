# 轻量迁移：保留人工判断，在另一台重建机器缓存

本目录是 2026-10-09 的迁移交接包，不是清洗验收结果。原电脑保持暂停，未删除或回退任何原结果。本包约 8 MB，最终精确字节数见 transfer-summary.json；不含 PDF、Excel 原件、PNG、虚拟环境及批量扫描/OCR缓存。另机必须已有相同原图纸内容，并通过 SHA256 校验。

## 保留什么、重新计算什么

- 保留 513 份 PDF 和 1 份 Excel 的原 source_id、原 SHA256 和历史弱标签。PDF 共 16,820 页、511 个不同哈希。不会重新分配 NEW 编号。
- history/ 保存逐图人工修正、20 家试点历史记录、r13 结构化草稿与 SVG、PDF-239 最终图签读数、历史进度。所有 receipt 仅供追溯，绝不恢复成新一轮已完成凭据。
- previous-handoff/ 保存旧节点快照和完整背景。其“复制全量缓存”和旧 resume_checkpoint_v2.py 启动指令不适用于本次轻量迁移，以本 README 为准。
- 扫描、OCR、自动轮廓、自动比例候选、证据图和叠加图都需要另机重新计算；没有承诺保住这些机器阶段的计算时间。
- 不需要 git reset、删除旧缓存或重写历史。新结果写到新的 rebuild-20261009-01 命名空间。

## Git 范围

只新增本目录全部文件，以及 tools/data-cleaning/full-run-02/ 根目录的 44 个 py/md/txt 文件。不包含任何 _cache，不包含其他网页/架构改动，不修改 .gitignore，不改原 PDF。已有基线中的 tools/data-cleaning/*.py、tools/resource_library.py、模型 manifest、规范和网页坐标约定文件由 bundle-manifest.json 校验。

本机基线提交为 5b53d1a0。不要为了迁移做 git add .。另外一台如果有未提交改动，请先让接手的 Codex 只读检查分支和同名文件；不要使用 reset --hard、clean 或强制覆盖。

## 另一台的操作

1. 取得轻量迁移分支及其文件，保留另一台已有 PDF。新入口支持不同盘符，不必固定 D:\text demo。
2. 在项目根目录恢复 Python 3.12 环境。已有可用环境可复用；不要从旧电脑直接复制 .venv。

~~~powershell
py -3.12 -m venv tools\data-cleaning\.venv
& .\tools\data-cleaning\.venv\Scripts\python.exe -m pip install -r .\tools\data-cleaning\full-run-02\requirements.txt
~~~

3. 先只读验证包和基础代码，默认不读取全部 PDF、不启动清洗：

~~~powershell
& .\tools\data-cleaning\.venv\Scripts\python.exe .\tools\data-cleaning\light-handoff-20261009-01\bootstrap.py
~~~

4. 校验全部来源 SHA256 并建立隔离重算目录，仍不启动提取：

~~~powershell
& .\tools\data-cleaning\.venv\Scripts\python.exe .\tools\data-cleaning\light-handoff-20261009-01\bootstrap.py --prepare
~~~

默认从项目的 资源库/01_各门店原图纸 查找。如果另一台图纸在别处，加 --source-dir 'E:\各门店图纸'。内容缺失/不一致时停止，不凭同名接受。此步骤会读取全部来源来算哈希，建议在另一台执行。原 Excel 只校验与绑定，尚未完成表格内容清洗。

生成目录：

- tools/data-cleaning/rebuild-20261009-01/：44 份脚本镜像 + run_rebuild.py；记录转换前后的哈希。唯一代码转换是把运行路径中的 全量续跑-02 字面量替换成新运行名。
- 资源库/90_处理过程与审核/数据清洗-20261009/rebuild-20261009-01/：来源映射、新日志和新结果。
- 同一日期目录下 _cache/rebuild-20261009-01/：新缓存。

任意上述目录已存在，--prepare 都会拒绝覆盖；准备阶段如果被中断，可用 --run-name rebuild-20261009-02 建立另一个目录。已经成功准备后续跑，不要重复 --prepare，直接用该目录的 run_rebuild.py。

5. 运行生成目录的只读预检，再明确启动：

~~~powershell
& .\tools\data-cleaning\.venv\Scripts\python.exe .\tools\data-cleaning\rebuild-20261009-01\run_rebuild.py
& .\tools\data-cleaning\.venv\Scripts\python.exe .\tools\data-cleaning\rebuild-20261009-01\run_rebuild.py --execute --stage all
~~~

新入口每次只有一个来源在计算，每个阶段使用独立进程，避免 OCR/几何模块的全局设置互相影响。停止标记路径会打印出来；新建该空文件后，将在当前来源完成时停止。重新运行相同命令会跳过本轮有完成凭据的来源。不要同时开两个入口。

几何阶段中断后在带唯一尝试编号的新目录重算该来源，不覆盖旧半成品。极少数在 classified.json 与 receipt.json 写入之间中断的 OCR/位图来源，会保留同名冲突并记录失败，需要 Codex 检查后在新修订目录处理，不能删除证据强行重跑。存在错误时最终返回非零；仍会继续其他已有上游凭据的来源。

## 仍需人工/视觉工作

机器阶段结束不是任务完成。继续执行 NEXT_MACHINE.md：逐图查看 overlay、核验两个方向尺寸、处理版本/冲突、完成标准标注与最终质检。历史图片不随包传输，新渲染必须重新打开核验，不能沿用旧图片哈希或填写已检查。

历史试点 16/20 的主要轮廓对齐达到方法试点门槛；19/20 双向比例通过，但 20 家全部 partial，complete=0，训练候选=0。本包没有提高任何资格。视觉批次004尚未应用；PDF-239 图签最终读数为“深航百脑汇店”，城市仍不能自行确定。

## 验证范围

本机仅执行轻量包哈希预检、入口语法检查和不启动清洗的隔离验证。完整机器流水线未在本轮重跑；结果和限制见 validation.json。已知旧 scale_candidates_v2.py 是未使用的有语法缺陷原型，新入口实际使用 v3，不把其历史源文件当成通过验证的可运行模块。
