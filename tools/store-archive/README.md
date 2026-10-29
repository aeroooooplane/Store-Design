# tools/store-archive：门店档案脚本

按 [门店图纸整理方案](../../docs/store-drawing-archive-plan.md) 生成 `资源库/09_门店档案/`。脚本只读原图纸和旧成果，输出只写档案目录。

## 环境

Python 3.12，依赖见 `requirements.txt`（PyMuPDF 1.28.2、numpy、Pillow、rapidocr-onnxruntime 1.4.4）。

不要再借用 `tools/data-cleaning/.venv`：它指向 Codex 自带的运行时，Codex 更新时会暂时失效（2026-10-14 遇到过）。请在仓库外用 uv 建独立环境：

```bash
uv venv "$LOCALAPPDATA/store-archive/venv" --python 3.12
uv pip install --python "$LOCALAPPDATA/store-archive/venv/Scripts/python.exe" -r tools/store-archive/requirements.txt
PY="$LOCALAPPDATA/store-archive/venv/Scripts/python.exe"
cd tools/store-archive
PYTHONUTF8=1 "$PY" build_sources.py
```

原图纸和被 Git 忽略的旧成果只在主仓库 `D:	ext demo` 里。所以脚本默认从这里读取（`--repo` 或环境变量 `STORE_ARCHIVE_REPO` 可以改），输出到脚本所在仓库的 `资源库/09_门店档案/`（`--out` 可以改）。在独立工作区里运行也能读到原图纸。

## 脚本

| 阶段 | 脚本 | 输出 | 说明 |
|---|---|---|---|
| 0 | `build_sources.py` | `来源清单.json` | 513 份 PDF 的哈希、页数、Git 跟踪状态；同内容的文件归为一份档案；登记不建档的来源；对照旧编号。任何一项核对失败就退出，不写出文件 |
| 0 | `register_legacy.py` | `旧成果登记.json` | 历次旧成果的位置、口径、可信度、去向，并实测路径是否存在、文件数和大小 |
| 0 | `verify_backup.py` | `备份核对.json` | 逐文件核对 `全量续跑-02` 在 `D:\门店图纸备份\全量续跑-02-20261009\` 的备份 |
| 1 | `extract_text_evidence.py` | `_cache/文字证据.jsonl`（不进 Git） | 逐页读取文字层：图签店名、铺型字样、si 字样、SI 专属道具 / 材料名、面积读数（约 2 分钟） |
| 1 | `build_stores.py` | `门店总表.{json,csv}`、各店 `store.json`、`冲突与待确认.csv` | 合并飞书台账 10-09、飞书快照 09-23、文件名和图纸证据，判定 SI / 铺型，冲突写进清单 |
| 2 | `extract_page_features.py` | `_cache/页面特征.jsonl` | 逐页读文字层：大字号标题、图签图号、图片覆盖率；解析“图纸目录”页（约 10 分钟） |
| 2 | `thumb_features.py` | `_cache/缩略图特征.json` | 只给“大图少字”和“无文字”的页渲染小缩略图，算白底、彩色比例，区分效果图与图片型平面图（约 2 分钟） |
| 2 | `ocr_title_blocks.py` | `_cache/OCR文字.json` | 文字被转成曲线的图纸页做图签 OCR，只识别右侧、底部图签和顶部标题；优先复用 10-09 的旧 OCR（新做约 1 小时） |
| 2 | `classify_pages.py` | `页面分类.jsonl`、`_cache/页面摘要.json` | 按“目录 → 大标题 → 图签图名 → 图片特征 → 按块补齐”分类，选主平面页 |
| 2 | `read_bom.py` | 各店 `bom.json`、`物料清单汇总.csv` | 按表头坐标还原物料清单表格，映射到模型库五大类 |
| 3a | `draft_gold.ts` | `_cache/gold/<id>/draft.json` | 用工作台本地识别（与网页同一套代码）给金标准门店的主平面页出草稿；可带店号只跑部分门店 |
| 3a | `gold_overlay.py`、`gold_crop.py` | `_cache/gold/<id>/overlay*.png`、`crop-*.png` | 把草稿或 plan 画回原图；按原像素裁切加网格，用来读坐标 |
| 3a | `build_gold.py` | 各店 `plan.json` | 把看图修正记录 `edits.json` 换算成金标准平面（比例核对、型号匹配、按 facing.json 换算朝向、开箱桌按桌体） |
| 3a | `gold_review.py` | `_cache/审核/金标准审核-<批次>.html` | 每批 5 家的审核页：原图叠加、示意平面图、道具清单 |
| 3a | `score_drafts.py` | `_cache/识别打分.json` | 用金标准给本地识别草稿打分（比例、边界 IoU、道具位置与型号），识别改进前后对比用 |

脚本可以重复运行；结果只取决于输入文件，`generatedAt` 除外。
