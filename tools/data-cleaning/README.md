# 门店PDF清洗：可追溯试点，尚未完成全量

本目录及输出目录均为本任务新建。原始PDF、已有索引、demo、已有tools文件均未修改；没有执行批准导出、git add/commit/push。本轮**没有完成418份全量清洗**。试点质量门槛8/19=42.1%，低于80%，不能将现有草稿用于训练。

## 环境

Windows、Python 3.12.14。虚拟环境位于本目录`.venv`，依赖版本见`requirements.txt`。若本目录`.venv`已经存在，不要重新覆盖创建。

```powershell
# 在全新复现副本内运行；当前工作区已经完成环境创建。
Set-Location 'D:\text demo'
& 'C:\Users\insta360\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe' -m venv tools/data-cleaning/.venv
& tools/data-cleaning/.venv/Scripts/python.exe -m pip install -r tools/data-cleaning/requirements.txt
```

输入根目录默认是`资源库/01_各门店原图纸/`，可通过`resources.local.json`的`sourcePdfRoot`或`STORE_SOURCE_PDFS`显式覆盖；相对路径以仓库根目录为基准。读取旧缓存时，原图纸路径在内存中转为当前目录，非PDF附件转向`资源库/90_处理过程与审核/其他源文件/`；磁盘上的历史审核记录不改写。所有中间缓存位于`资源库/90_处理过程与审核/数据清洗-20261009/_cache`。RAR读取使用Windows自带`tar.exe`，只把指定PDF成员的标准输出写到受控缓存文件，不按压缩包中的路径落盘。DWG未解析。

## 复现与续跑

```powershell
& tools/data-cleaning/.venv/Scripts/python.exe tools/data-cleaning/pipeline.py inventory
& tools/data-cleaning/.venv/Scripts/python.exe tools/data-cleaning/pipeline.py pilot
& tools/data-cleaning/.venv/Scripts/python.exe tools/data-cleaning/revision2.py
& tools/data-cleaning/.venv/Scripts/python.exe tools/data-cleaning/geometry8.py
& tools/data-cleaning/.venv/Scripts/python.exe tools/data-cleaning/inventory_review.py
& tools/data-cleaning/.venv/Scripts/python.exe tools/data-cleaning/package_pilot.py
& tools/data-cleaning/.venv/Scripts/python.exe tools/data-cleaning/render_review_queue.py
& tools/data-cleaning/.venv/Scripts/python.exe tools/data-cleaning/build_report.py
& tools/data-cleaning/.venv/Scripts/python.exe tools/data-cleaning/final_audit.py
```

`pipeline.py`只有inventory/pilot两种模式，**没有已经通过验证的全量生产命令**。上述命令用于复现当前未通过门槛的试点。其视觉决定是本次实际看图后写入脚本的审阅记录，复跑不会重新获得AI视觉判断；更换源文件后必须重新看图，不能沿用决定。

所有正式文件以`x`/`xb`排他创建。存在已完成的缓存/receipt时读取跳过，不覆盖。正式标注续跑会核对源哈希及输出receipt。若中断留有未完成目录且没有有效receipt，程序停止报告冲突，不能删除旧目录、强制覆盖或自动伪造完成记录；应在新的运行/修订目录修复。`progress.jsonl`是唯一追加日志；每一行有阶段字段，旧轮次不是新门店，不要按行数统计门店。

`geometry3.py`至`geometry9.py`均保留。`geometry8.py`通过导入历史修订组合算法，但不会执行其他脚本的main。`geometry9.py`是后续实验，没有增加可确认边界，正式试点采用r8；无需为复现正式草稿重复跑r3至r9。几何扫描阶段单来源失败记录后继续；打包/报告遇到路径冲突或完整性错误会停止。发生异常必须先修复具体来源，再续跑；不得视为全量成功。

## 试点与算法迭代

固定20个来源：PDF-001、002、003、005、008、013、019、029、032、035、043、049、051、071、088、090、239、293、296、353。按索引含SI1.0 12份、SI2.0 8份；边厅9、中岛8、专区3，含异形、弧形、规则空间。SI为弱标签，版本均未确认。

|轮次|更改|观察结果|
|---|---|---|
|页面r1|标题关键词、矢量/位图信号|模板说明和图纸索引污染分类，未作为最终分类|
|页面r2|坐标近邻文字拼接，优先实际图签标题|保留601页候选，未确认的页面进入复核清单|
|几何r3|闭合矢量+文字邻近匹配|产生候选，内部产品图案容易错作桌体|
|r4|按颜色/线宽分组，去重边，取多边形外环|修复部分家具外框，仍有旋转不对齐|
|r5|在内存消除PDF页面旋转后统一提取和渲染|修复旋转页叠加错位，不保存回源PDF|
|r6|同样式端点在0.18 PDF点内连接|主要桌柜闭合改善；边界仍常错选|
|r7|补充“中岛”等短名称，排除广告机安装表标题|识别更多道具；边界仍未过门槛|
|r8|识别深红租赁线，连接方向相反的虚线链|新恢复PDF-029、035、088、293、296中的边界候选；最终保留11个边界草稿|
|r9|跨线宽同色路径节点化，加入填充墙体外环|剩余边界未解决，未提升可确认的门店通过数|
|打包|逐店看图，错误几何置null、组合标签去重、保留原证据|20套中partial19、failed1、complete0；严格门槛8/19=42.1%|

中间几何缓存的`generator`字段沿用了`pipeline.py`公共写入器；具体算法修订以`_cache/pilot-rN`目录和脚本为准。正式source.json记录了extraction_revision。报告通过`package_pilot.py`公共写入器落盘，并另存`orchestration_generator`说明调用脚本；不要只看文件生成器推断算法轮次。

## 数据约定与限制

权威规范：`资源库/06_生成流程文档/02_平面图与效果图提取.md`。所有数据为草稿，training_eligible始终false。未知的坐标、朝向、版本、入口填null。

已标定PDF-001/019/051：视觉读取尺寸数字，匹配矢量尺寸线/延长线交点，横纵两个方向核验误差分别约0.00603%、0.01483%、0.00662%。只用面积作检验。坐标转为米，原点为边界外包框左上角，3位小数。其他17套维持归一化PDF页左上角、PDF点单位，不能混入网页米制布局。

source中的original_pdf_to_normalized_pdf_matrix表达旋转；normalized_pdf_to_m_matrix表达归一化PDF点到米；pdf_to_m_matrix组合两者。geometry.svg和叠加图保留归一化PDF点/像素坐标，并在source中记录转换，不能直接把SVG数值当米。曲线按原始贝塞尔离散为多边形，误差未独立评估。

蓝色为已保留边界，绿色为已保留道具外包框。入口、墙柱、固定设施尚不完整；这些空层不代表原图没有。label_aliases是同一物体的重复标签，不是额外家具。asset_candidates只表示启发式候选，不是已核准型号；si_index_label不能当作SI事实。

**按以下顺序读取追加纠错：**基础`source.json/input.json/target-layout.json/review.json` → `review-supplement.json` → `vision-observations.json`。后一份有明确且非null的视觉读值时补充空值；若与旧值冲突，保留双方证据，不自行裁决。PDF-239初读“深圳”已被高分辨率图签“深航”纠正，城市仍为null。面积/高度/日期的视觉补充也在vision-observations.json；日期证据并不确认版本。

文件清单以`00_文件清单_最终复核.json`为准。初始清单错误地把RAR的不支持格式记为损坏、把PPTX的通用解析页数当幻灯片数，并在同哈希PDF-175/176中暂用同一ID；保留初始清单，另建复核文件纠正。实际输入418 PDF、2 PPTX、3 RAR，PDF物理页14251，PPTX 23张，RAR内3份PDF合计24页。

## 交付与未完成项

总报告`资源库/90_处理过程与审核/数据清洗-20261009/06_质检报告.md`。
20套草稿在`资源库/90_处理过程与审核/训练标注/store-XXXX/v1/`。
待办403个来源见`02_门店与版本.json`；全量版本分组、完整布局、其余13650页、232页低置信度候选的视读、多图框及效果图版本配对未完成。目录名“训练标注”不代表数据获准训练。

`final_audit.py`只验证文件/单位/闭合/来源哈希等约束，通过不等于业务提取质量达标。当前没有任何可训练候选。后续必须继续修复试点、重新看图并保存新修订，达到80%后才可扩展到全量。
