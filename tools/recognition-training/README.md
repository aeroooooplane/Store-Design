# 独立轮廓训练试点

用于把已核对的独立门店原页和轮廓标签打包，运行真实的小型分割试训。不是现有风格 LoRA，也不替代工作台识别引擎。

## 数据边界

- 45 家验收、48 家开发仅提供身份索引用于排除；二者的原图、几何标签和评分均不进入本脚本。
- 冻结试点中的准入与排除记录全部保留。原图名、别名、同店键和源 PDF 哈希重叠即拒绝；同店/同源多页必须先合并分组，本版直接拒绝重复。
- 首批是代理核对的轮廓试训标签，不是人工金标准，不改变旧整店审核状态。
- 输入必须是已绑定 SHA256 的未叠图原页。多边形、黑白掩膜和审核叠图分开保存；训练器拒绝用叠图替代原页。
- 首批按门店哈希冻结 7/3 划分；扩充时必须显式传入父版目录与哈希，旧训练/验证门店全部继承，新增门店仅进训练。旧图像、掩膜、多边形及45/48保护清单不得变动。增强仅发生于训练门店，不把增强数量当作门店数。
- 验收身份索引只覆盖已登记的同店关系；不能保证整个资源库不存在未登记的重复设计。来源图名与跨店复用仍须人工/代理核查。

## 独立环境

不修改项目 Node 依赖，不把虚拟环境或大文件放进仓库。Python 3.12，CPU 试训使用 PyTorch；CUDA 选项需在有显卡环境另行验证。本次实际版本见运行目录 `environment.json`，包括 torch 2.15.0+cpu、numpy 2.5.4、Pillow 13.0.0、onnx 1.23.2、onnxruntime 1.31.1、onnxscript 0.7.2。

按 [PyTorch 官方安装方式](https://pytorch.org/get-started/locally/) 在独立环境安装 CPU 轮子。示例（`python` 应替换成虚拟环境解释器，Windows 不要使用 WindowsApps 占位程序）：

```powershell
uv venv --python 3.12 <仓库外的运行环境>
uv pip install --python <运行环境/python> torch==2.15.0+cpu --index-url https://download.pytorch.org/whl/cpu
uv pip install --python <运行环境/python> numpy==2.5.4 pillow==13.0.0 onnx==1.23.2 onnxruntime==1.31.1 onnxscript==0.7.2
```

依赖安装会下载软件；本工具无图纸上传或云端识别调用。

## 执行

```powershell
python tools/recognition-training/dataset.py build --inputs <冻结试点及45/48身份索引目录> --decisions <轮廓独立准入JSON> --resources <只读资源库> --out <新训练数据目录> --val-count 3
python tools/recognition-training/dataset.py validate <训练数据目录>
python tools/recognition-training/train.py --dataset <训练数据目录> --manifest-sha256 <manifest.json文件SHA256> --out <新试训目录> --epochs 160 --side 256 --threads 4 --batch-size 2 --device cpu
python tools/recognition-training/report.py --data <训练数据目录> --run <成功试训目录> --out <新审核页目录>
python -m unittest discover -s tools/recognition-training -p "test_*.py" -v
```

所有输出目录要求不存在，避免覆盖既有数据。`decisions.json` 需列出冻结试点所有门店。准入记录含 `status=admitted`、`reviewer`、`reason`、`identityReview`、原页绝对路径及哈希、图像尺寸、原页像素坐标多边形和渲染证据。排除记录含原因和处理人。尺寸/旋转必须先与原页核对。

数据输出：原页 PNG、原尺寸二值 mask PNG、polygon JSON、审核 PNG、完整准入/排除清单、身份索引、冻结划分及文件哈希。不能把外部修改后的数据沿用旧 manifest 哈希训练。

训练输出：初始化/位置基线/最佳/最终逐店指标、每轮日志、环境与参数、实际源代码快照、`best.pt`/`last.pt`、ONNX、预测掩膜和叠图、导出误差与全文件哈希。最佳权重只按内部验证 IoU 选择。位置基线只使用训练掩膜计算，用来揭示版式偏置。

导出采用 [官方 `torch.export` ONNX 路径](https://docs.pytorch.org/docs/stable/onnx_export.html)。PyTorch 与 ONNX Runtime CPU 卷积有小幅浮点误差，记录原始 logit 最大差值，并同时要求概率最大误差 <0.005、每图二值掩膜差异比例 <0.0001；阈值固定 0.5。此项仅验证导出一致性，不代表识别质量通过。

## 接入限制

本轮只产出 256×256 整页轮廓分割试验模型，不能直接作为编辑器可用轮廓；不含稳定矢量化、量尺、OCR、多入口、墙柱分类或道具摆放。入口由独立业务语义定义；灯箱和广告机三维仍采用墙面贴片，不能从平面内嵌表达推导墙洞/厚实体。项目业务代码与默认关闭的云识别开关不变。

先增加独立训练样本并消除文字误检与边界外扩，再冻结候选、以 48 家开发集复评。45 家只在验收阶段使用，不据其结果逐店调参。当前结果与失败记录见 `docs/recognition-outline-training-20261105.md`。

## 扩充与前后对比

```powershell
python tools/recognition-training/dataset.py build --inputs <冻结试点> --decisions <新准入JSON> --resources <只读资源库> --out <新目录> --parent-dataset <首批目录> --parent-manifest-sha256 <首批manifest的SHA256>
python tools/recognition-training/report.py --data <扩充数据> --run <新成功试训> --baseline-run <父版试训> --out <新审核页目录>
```

扩充模式不重新按数量排序分组。数据包附带父版 manifest，拒绝移走旧验证门店、改换来源或悄悄更换旧标签。确需修订旧标签时应单列修订版本和可比性说明，不能冒充本轮纯扩充。

同一图页含交底版与最终版时，允许根据独立标题/图框裁选版面，必须保留 `sourceImage`、原页 SHA256、原页尺寸、`cropBoxPx` 和 `cropBasis=document-panel-title`；打包逐像素验证裁图来源。不能按标签范围裁图。选择最终版不代表整店几何已由用户验收。

确认记录放入 `decisions.json.userConfirmations`，状态 `resolved` 的既有答复在新审核页只读展示。目视问题可记入运行目录的 `visual-review.json`（门店编号到说明的映射）；报告没有目视记录时明确显示待核查，不沿用旧模型的问题结论。原审核页和浏览器答复保持原样。

本轮采用相同模型与160轮训练，但17家训练的参数更新数为1440，原7家为640，不能宣称是相同算力预算的纯数据增益实验。固定3家仅是内部模型选择集，仍需48家开发复评及45家最终验收。

隔离测试使用标准库；可选 Pillow 裁图像素测试在完整训练环境执行，无 Pillow 的轻量 CI 会显式跳过这一项。扩充记录见 `docs/recognition-outline-expansion-20261105.md`。