# 新增图纸 GitHub Release 传输

95 PDF + 1 Excel，保持原路径/来源编号/SHA，所有源只读。脚本均使用 Python 3.12 标准库；上传另需已登录的 gh CLI。

- package_sources.py：从全量续跑-02/00_同步与文件清单.json 选择 action=copy 的96文件，ZIP_STORED独立分4包；验证原字节与包内字节；完成包可复用，半成品不覆盖。
- upload_archives.py：单并发上传 ZIP 到已有草稿Release，按远程size/digest验证，不clobber。
- restore_sources.py：另一台预检/安全恢复入口。命令见 SOURCE_TRANSFER_README.md。
- restore_validation.py：隔离小样例测试；已执行一次，缓存目录存在时不会覆盖旧测试。

全部输出位于 资源库/90_处理过程与审核/数据清洗-20261009/_cache/新增图纸GitHub传输-01。发布回执是最终传输依据，未发布草稿不代表迁移已完成。
