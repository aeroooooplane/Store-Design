# 2026-10-09 全量续跑与几何核验

所有产物均为自动提取草稿。没有执行批准导出，没有修改原索引、网页代码或源 PDF，没有设置训练资格，也没有写入审核人。

## 输入、目录与不可覆盖规则

- 工作目录：`D:\text demo`。
- 新下载来源：`D:\各门店图纸`，只读。
- 授权同步目的地：`资源库/01_各门店原图纸`。
- 本轮总产出：`资源库/90_处理过程与审核/数据清洗-20261009/全量续跑-02`。
- 缓存、证据渲染和叠加图：上述日期目录的 `_cache/全量续跑-02`。
- 旧试点及旧产物不覆盖；算法修订的 r10/r11/r12/r13 不是门店设计版本。

本次同步清单确认 513 份 PDF、16,820 个物理页，另有 1 份 Excel。新复制 95 份 PDF 和 1 份 Excel，418 份 PDF 按 SHA256 复用。Excel 原样同步，不自动把表格标签当作图纸确认的 SI 证据。NEW-001 至 NEW-005 已在前轮分配给其他附件，本轮从 NEW-006 继续；NEW-027 为 Excel，不能计入 PDF 门店数。

所有正式写入使用 Python 的 `x` / `xb` 模式。同名未知产物报错，不覆盖。已完成任务只在有完成回执时跳过；回执引用源哈希，标准标注回执还引用输出哈希。进度日志仅追加。单个任务失败会记录后继续其他来源；历史失败日志不能替代最终有效回执统计。中途失败留下的无回执目录不得覆盖，应在新修订命名空间重跑并记录替代关系。

## 环境

在仓库根目录运行。虚拟环境位于前轮已创建的 `tools/data-cleaning/.venv`，本轮追加安装本机 OCR 依赖。依赖固定版本见本目录 `requirements.txt`。

```powershell
python -m venv tools/data-cleaning/.venv
& tools/data-cleaning/.venv/Scripts/python.exe -m pip install -r tools/data-cleaning/full-run-02/requirements.txt
```

如虚拟环境已存在，跳过创建。OCR 模型包含在安装的 RapidOCR 包内，图纸不上传到外部服务。本项目使用多进程，请执行脚本文件，不要把多进程入口通过标准输入传给 Python；Windows 的 spawn 模式不能从 `<stdin>` 重新导入入口。

## 运行顺序

```powershell
& tools/data-cleaning/.venv/Scripts/python.exe tools/data-cleaning/full-run-02/sync_sources.py
& tools/data-cleaning/.venv/Scripts/python.exe tools/data-cleaning/full-run-02/scan_all.py --workers 4
& tools/data-cleaning/.venv/Scripts/python.exe tools/data-cleaning/full-run-02/ocr_fast_v4.py --workers 4
& tools/data-cleaning/.venv/Scripts/python.exe tools/data-cleaning/full-run-02/raster_pages.py --workers 2
& tools/data-cleaning/.venv/Scripts/python.exe tools/data-cleaning/full-run-02/extract_enriched_v4.py --workers 2
```

扫描、OCR 和几何程序可分阶段运行，只处理当前已有上游回执的来源，再次运行会补齐后续来源。不要同时运行两个会写同一来源/同一阶段的进程。`scan_all.py` 要求已经生成并通过 `试点验收-r12.json`。图签 OCR 与位图平面补救的分类结果必须在汇总时合并；不能把扫描阶段的粗分类直接当成最终分类。

试点和视觉选择的再现命令：

```powershell
& tools/data-cleaning/.venv/Scripts/python.exe tools/data-cleaning/full-run-02/experiment.py
& tools/data-cleaning/.venv/Scripts/python.exe tools/data-cleaning/full-run-02/pilot20.py
& tools/data-cleaning/.venv/Scripts/python.exe tools/data-cleaning/full-run-02/pilot11.py
& tools/data-cleaning/.venv/Scripts/python.exe tools/data-cleaning/full-run-02/finalize_pilot.py
& tools/data-cleaning/.venv/Scripts/python.exe tools/data-cleaning/full-run-02/package_draft_v2.py
& tools/data-cleaning/.venv/Scripts/python.exe tools/data-cleaning/full-run-02/vision_batch001.py
& tools/data-cleaning/.venv/Scripts/python.exe tools/data-cleaning/full-run-02/vision_batch002.py
& tools/data-cleaning/.venv/Scripts/python.exe tools/data-cleaning/full-run-02/apply_vision_v3.py 资源库/90_处理过程与审核/数据清洗-20261009/全量续跑-02/视觉批次-002.json
```

这些试点脚本引用了前轮 `训练标注`、`_cache/pilot-r8`、`方法对比-01` 的不可变证据及本轮视觉选择 JSON。它们是本次实验输入的一部分，应连同脚本一起保留。PDF-049 的 r12 顶点与路径证据已保存在 `试点-r12-PDF-049.json`；不能用后来的算法版本号替代门店版本号。已存在的完成产物不再次写入。

## 方法与迭代依据

1. **柜体路径重组**：同一原始路径内部交点化并合并相邻面，补充同色同虚线型跨路径节点化；保留小家具面。用前轮 0.18 PDF 点的端点吸附解决导出浮点断裂。所有新坐标来自原始路径、或明确标记的视觉读取，没有生成或补画原图。
2. **物体选择**：文字邻近只产生候选。视觉 ROI 仅用于选择矢量轮廓，不把 ROI 的像素大小当成家具尺寸。重复标签按实际同一物体归并。墙带、尺寸线、轴线、引线、产品小图不得当成柜体。明确标为硬装的柜体进入固定设施层。
3. **比例**：将实际读到的数字分别关联 x、z 原始尺寸线。误差为 `abs(sx-sz)/mean(sx,sz)`，不超过 2% 才记录双方向核验通过。面积只核验，不标定。没有可靠边界原点时，即使比例已知，正式坐标仍保留 PDF 点，并解释原因。
4. **r10 试点**：20 份逐图检查，14/20 的边界和主要家具对齐。发现 PDF-005 跟到了尺寸延长线，PDF-049 误选 U 形墙带，PDF-353 包含图纸截断符，均撤回。
5. **r11/r12 修正**：PDF-049 改为原始端点组成的内墙与入口门槛轮廓；PDF-353 改为明确尺寸对应的专区范围。逐图检查后为 16/20（80%），19/20 双方向比例通过。全部仍为 partial，0 个训练候选。此门槛衡量主要轮廓对齐，不衡量全要素完整性，也不是无人干预准确率。
6. **全量分类修正**：图签字段“图纸索引”不是目录标题；`NETWORK LAYOUT PLAN` 是弱电专业图；“平面布置图”章节页不包含真实布局。这些误判在后续分类模块中修正。整页位图不直接判作效果图。位图 CAD 页先检测白底线稿特征，再本机 OCR 找回实际图名。
7. **本机 OCR**：保留每条识别文字的 PDF 点框、置信度、引擎版本、渲染比例与裁切框。OCR 的高置信度不等于尺寸核验通过。PDF-043 的纵向数字曾误读，必须继续对照原图；不能把 OCR 数字直接写成真实尺寸。
8. **打包字段核验**：米制 polygon 与原始证据分开。`bounds_pdf`、`area_pdf_point2` 明示 PDF 单位；边界点、道具左上角、中心及宽深在正式坐标系中一致。几何图与原页保持同一像素变换。

## 审核与统计口径

- `complete/partial/failed` 只按最终 `review.json` 汇总，扫描完成不等于结构化完成。
- 版本均未人工确认，来源数量、物理页数、门店临时组数、平面候选数量和版本数量分别报告。
- 索引 SI 和铺型是历史弱标签。图纸证据与索引冲突时保留冲突，不自行选择。
- 视觉检查必须记录实际打开的图及其哈希；没有打开过的不能写成检查通过。
- 所有 `training_eligible` 为 false。候选训练建议也不能替代人工审核或版本确认。
- 图像 SHA256 指 `extract_image` 返回的内嵌图片字节，不与渲染 PNG 的哈希混为一谈。内联图像暂不能取得该字节时为 null。

本 README 描述方法和再现方式。全量完成度应以本轮质检报告与文件清单为准，不能由缓存目录中的文件数量推断。
