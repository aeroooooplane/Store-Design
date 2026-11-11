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
导出数值修复：仅导出副本以FP64累计GroupNorm统计，卷积与训练保持FP32；原权重可用 export_model.py 单独重新导出，无需重训。验证20家原图与8类合成输入，原阈值不变。详见 docs/recognition-outline-onnx-20261105.md。

轮廓训练对照可选 --positive-weight 1 --affine-augment；不指定时保留原策略。固定48家复评使用 evaluate_development.py 和按SHA绑定的冻结JSON；drawing_input.py只按无标签的整页/边缘亮度处理黑底，对比度规则须在评分前固定。outline_mask.py的最大块清理仅供实验，不作为自动默认；development_report.py保留原始/清理四组指标，生成独立审核页。开发反馈必须另开冻结版本并保留失败结果，45家不参与。详见 docs/recognition-outline-development-20261105.md。


## 独立难例扩充与黑底增强

本轮扩充使用同一 `dataset.py build --parent-dataset ... --parent-manifest-sha256 ...` 契约；仍继承原20家图像/标签及3家内部验证，新增12家只进入训练。14家新候选中另外2家归属待确认、旧4家暂缓记录均保留，不用不确定标签补数。

训练可加 `--normalize-polarity`，使原页走与开发复评相同的黑底处理；预处理选择写入权重，`export_model.py` 自动继承，旧权重默认不开启。`--black-background-augment` 必须与此开关同时启用，仅对训练门店生成深灰底/低对比变体，以50%概率使用；不增加门店数，不改变验证标签或坐标。增强图保存到运行目录 `augmentation-inputs/`，供追溯及数值检查。

候选主平面未发现天然整页黑底原图，不能把派生增强称作新增真实黑底门店。两组训练及选择规则在本轮48家评分前冻结，48家反馈仅用于独立样本分层，45家继续只读身份索引。完整数据、对照结果、退化清单及局限见 `docs/recognition-outline-hardcases-20261109.md`。

补充标注审核生成命令：

```powershell
python tools/recognition-training/annotation_report.py --source <新增原页与decisions/questions目录> --inputs <冻结名单目录> --training-data <本轮训练数据目录> --out <独立审核目录>
```

复评页可从冻结JSON的 `trainingCounts` 读取真实训练/验证数量，并按 `priorRegressionStoreIds` 单列前轮退化样本；有补充审核证据时链接集中歧义，不要求重做旧48家审核。审核数据单独导出，测试用答复不能合并为真实用户审核结果。

## 多区域范围确认与邻区退化复评

2026-11-10已落实QHC-01/02：大连华南万象汇左下疏散通道排除；哈尔滨松雷连接通道排除，主店与上方库房分别保留。范围归属由用户确认，像素顶点仍为代理校正，不升级为人工金标准。

单区域继续使用 `polygonPx`。非连通区域使用 `polygonsPx`（多个独立闭合点列），两字段不得同时存在。打包及训练读取逐个区域栅格化为并集，不用凸包或细桥连接，不使用最大连通块丢弃库房；该契约暂不表达内孔。原单轮廓标签序列化保持不变，扩充仍要求旧图像、掩膜、JSON及划分哈希一致。完整训练环境还逐像素核对掩膜与全部区域，轻量CI缺Pillow时只跳过数值部分。

本轮新增6家独立邻区/凹口样本及2家答复后准入样本，累计37训练、原3家内部验证。40家数据与黑底派生输入不含45验收或48开发身份。两组160轮仅比较固定前景权重1和0.75，候选按3家验证选择后冻结再评48家；结果及退化清单见 `docs/recognition-outline-regressions-20261110.md`。

补充审核页用 `decisions.json.resolvedQuestions` 关联原 `user-confirmations.json`（逐SHA绑定），只读显示已确认范围，并随导出保留原答复来源。已解决问题不再出现在待答列表，旧审核包和浏览器数据不覆盖；无新问题时，复评页仍可跳转查看新增标注。

## 显式扩充内部验证

补强验证时使用 `--validation-extension <JSON>`，同时绑定父版目录和manifest哈希。声明包含 `newValidationIds`、`parentManifestSha256`、`frozenAt`、`reason`、`modelInferenceBeforeSelection: false`；只能把全新且未参与历史训练的独立门店指定为验证，不能重分旧训练/验证，仍验证保护清单和旧文件字节一致。调用者必须先核对所有历史训练版本、冻结名单及原页标签；声明本身不是未见过数据的证明。未指定时扩充行为不变，新增样本仍为训练。详见 [11家内部验证](../../docs/recognition-outline-validation-20261111.md)。

## 店外墨线难负样本对照

`train.py --negative-ink-weight 2` 只在训练标签外的5×5墨线邻域提高负样本BCE权重，按总权重归一，softDice不变；默认0保留旧损失。墨量从相同仿射后的完整训练原图取得，店内文字/道具不加负样本权重，不擦图、不裁图，推理无标签依赖。参数、损失源码、训练数据及候选选择在48家评分前冻结；OCR语义和尺寸数值提取不属于此开关。源码快照 `source-negative_loss.py` 与训练器一并保留，复现实验需恢复同一运行目录中的全部源码。结果和未解决样本见 [本轮对照](../../docs/recognition-outline-negative-20261111.md)。
