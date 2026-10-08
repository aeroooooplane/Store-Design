# 各门店平面图

本目录保存已审核的每店PDF：`门店编号__门店名称__版本__平面图.pdf`。一份可有多页，区分原始边界、家具布置、多楼层或明确备选方案，不混入天花、电气或立面图。

当前尚未批量切分。先按[切分与标注方案](../06_生成流程文档/02_平面图与效果图提取.md)核对候选页，再运行 `tools/resource-library/export_store_pdfs.py`。来源页码、坐标变换与训练标注放在90目录，不与人工查阅PDF混淆。
# 选页工具用法

复制 `tools/resource-library/selection.example.json`，填写已核准的物理页码（从1开始）、门店编号、版本和审核人，再把approved设为true。使用装有 `tools/resource-library/requirements.txt` 依赖的Python执行：

```powershell
python tools/resource-library/export_store_pdfs.py selection.json
```

工具核对源文件哈希，保留原页矢量内容，不覆盖同店同版本已有成果；输出PDF和来源页码记录。选页批准不自动代表训练标注合格。
