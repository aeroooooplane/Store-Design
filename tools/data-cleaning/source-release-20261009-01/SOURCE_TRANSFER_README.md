# 新增门店图纸：GitHub 附件传输

本附件用于补齐另一台电脑缺少的新增原始输入。包含 **95 份 PDF + 1 份 Excel**，原始数据 **1,510,368,407 字节**。它不是清洗完成结果，也不含大体积识别缓存。

## 先取得轻量脚本分支

- 分支：progress/cleaning-light-20261009
- 提交：3f69f9dd89c652957eccb23cbddde201e16a0fa6
- [轻量迁移说明](https://github.com/aeroooooplane/Store-Design/blob/progress/cleaning-light-20261009/tools/data-cleaning/light-handoff-20261009-01/START_HERE.md)
- [交给另一台 Codex 的完整接续任务](https://github.com/aeroooooplane/Store-Design/blob/progress/cleaning-light-20261009/tools/data-cleaning/light-handoff-20261009-01/NEXT_MACHINE_FINAL.md)

如果已有未提交改动，先让 Codex 检查，不能强制覆盖或 reset --hard。

## 下载附件

下载 Assets 中全部 4 个 source-supplement-part-01.zip 至 part-04.zip，以及 source-supplement-manifest.json、restore_sources.py、SOURCE_TRANSFER_README.md 和 SHA256SUMS.txt，放到同一个新文件夹。每个 ZIP 都是独立完整压缩包，必须全部下载。GitHub 自动提供的 Source code.zip/tar.gz 不包含这批附件，不能代替这 4 个包。

也可在已安装 GitHub CLI 的电脑运行（先将 E:\store-source-assets 改成新的下载目录）：

~~~powershell
gh release download cleaning-source-supplement-20261009 --repo aeroooooplane/Store-Design --dir 'E:\store-source-assets'
~~~

## 校验并恢复

Python 脚本只用标准库，无需安装 OCR。先只读预检，再执行恢复：

~~~powershell
py -3.12 'E:\store-source-assets\restore_sources.py' --assets-dir 'E:\store-source-assets' --project-root 'D:\text demo'
py -3.12 'E:\store-source-assets\restore_sources.py' --assets-dir 'E:\store-source-assets' --project-root 'D:\text demo' --apply
~~~

把示例盘符改成另一台真实路径。脚本验证所有 ZIP、清单和同名目标文件；同 SHA 文件跳过，同名异内容停止，绝不覆盖。新增文件恢复到项目 资源库/01_各门店原图纸/。为防中断，先在项目新缓存目录中校验临时副本，再以独占方式建立目标；保留恢复记录。

两份内容相同但原名称不同的 NEW-039、NEW-040 都保留，不能去掉来源记录。NEW-027 是 Excel，不是 PDF。Excel 只做文件同步，没有完成内容清洗。

## 继续图纸清洗

补齐后，按轻量迁移 START_HERE.md 使用 bootstrap_v3.py：先预检，再 --prepare，最后用新的 run_rebuild.py 单进程运行。不要运行旧 continue_all.py 或旧完整缓存迁移入口。

恢复脚本不会启动清洗。所有已有标注仍为自动提取草稿，training_eligible=false；重建后的叠加图需重新打开核验。

包内 SHA256 及大小见 source-supplement-manifest.json；上传后还会核对 GitHub 附件的 size/digest。
