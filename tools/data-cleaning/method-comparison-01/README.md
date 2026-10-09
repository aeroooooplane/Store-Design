# 五页方法对比实验

运行：在仓库根目录执行 `tools/data-cleaning/.venv/Scripts/python.exe tools/data-cleaning/method-comparison-01/compare.py`。

环境沿用前期隔离环境。重建：`python -m venv tools/data-cleaning/method-comparison-01/.venv`，随后运行该虚拟环境的 `python -m pip install -r tools/data-cleaning/method-comparison-01/requirements.txt`。脚本只依赖 Pillow 和 Python 标准库，读取已存在的 pilot-r8 矢量候选缓存、原标注 source.json 和 evidence.png。

默认输出 `资源库/90_处理过程与审核/数据清洗-20261009/方法对比-01/`，图像输出在同级 `_cache/方法对比-01/`。同名目录存在立即停止，不覆盖；另一次实验使用 `--run-name 方法对比-02`。每页写进度，输入缓存散列记入 comparison.json。此小实验不替代原流水线的续跑器；中断后残留目录保留，重跑用新名称。

A：冻结原文字邻近矢量算法结果。B：先看原图记录物体选择窗口，再从完全相同的矢量缓存选取轮廓。窗口只是选择依据，输出几何来自缓存中的实际 PDF 路径，不通过像素估计米制尺寸。B 不新增或补画图纸内容。

所有定位均保留 PDF 点坐标，比例未重新认证。选择阈值为外包框 IoU ≥ 0.65，选择窗口参与算法，故统计只表示试验范围内的空间找回，不能冒充独立准确率。冻结的视觉选择在脚本 CASES 和输出 vision-selections.json 中；未识别物体不强行填坐标。完成渲染后需要逐页打开 A/B 核对，并以新文件保存审查结论。

五页为有目的挑选的问题样本：043 文字转线条；051 漏配件柜；239 柱子误配；293 弧形柜；353 无标签桌椅。范围和未纳入物体逐页记录。所有数据为草稿，training_eligible=false。
