# tools/store-archive：门店档案脚本

按 [门店图纸整理方案](../../docs/store-drawing-archive-plan.md) 生成 `资源库/09_门店档案/`。脚本只读原图纸和旧成果，输出只写档案目录。

## 环境

Python 3.12 + PyMuPDF 1.28.2（`requirements.txt`）。本机可以直接用 10-09 清洗留下的环境：

```bash
PY="D:/text demo/tools/data-cleaning/.venv/Scripts/python.exe"
cd tools/store-archive
PYTHONUTF8=1 "$PY" build_sources.py
```

原图纸和被 Git 忽略的旧成果只在主仓库 `D:\text demo` 里。所以脚本默认从这里读取（`--repo` 或环境变量 `STORE_ARCHIVE_REPO` 可以改），输出到脚本所在仓库的 `资源库/09_门店档案/`（`--out` 可以改）。在独立工作区里运行也能读到原图纸。

## 脚本

| 阶段 | 脚本 | 输出 | 说明 |
|---|---|---|---|
| 0 | `build_sources.py` | `来源清单.json` | 513 份 PDF 的哈希、页数、Git 跟踪状态；同内容的文件归为一份档案；登记不建档的来源；对照旧编号。任何一项核对失败就退出，不写出文件 |
| 0 | `register_legacy.py` | `旧成果登记.json` | 历次旧成果的位置、口径、可信度、去向，并实测路径是否存在、文件数和大小 |
| 0 | `verify_backup.py` | `备份核对.json` | 逐文件核对 `全量续跑-02` 在 `D:\门店图纸备份\全量续跑-02-20261009\` 的备份 |
| 1 | `extract_text_evidence.py` | `_cache/文字证据.jsonl`（不进 Git） | 逐页读取文字层：图签店名、铺型字样、si 字样、SI 专属道具 / 材料名、面积读数（约 2 分钟） |
| 1 | `build_stores.py` | `门店总表.{json,csv}`、各店 `store.json`、`冲突与待确认.csv` | 合并飞书台账 10-09、飞书快照 09-23、文件名和图纸证据，判定 SI / 铺型，冲突写进清单 |

脚本可以重复运行；结果只取决于输入文件，`generatedAt` 除外。
