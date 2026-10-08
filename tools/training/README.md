# 本地训练

旧CPU试验使用Python 3.11的 `.venv`。本轮Windows RTX 4070环境单独位于 `.venv4070`（Python 3.12、PyTorch 2.6.0+cu124），不修改旧环境或Demo的Node依赖。图纸和训练在本机处理，网络只用于下载用户指定仓库、依赖和公开基模。当前检查与结果见 `docs/rtx4070-training-plan.md`。

## 分开运行（项目根目录）

```powershell
node tools/training/prepare-layout.mjs
node --test tools/training/layout-model.test.mjs
node tools/training/train-layout.mjs
& tools/training/.venv/Scripts/python.exe tools/training/prepare-style.py
& tools/training/.venv/Scripts/python.exe -u tools/training/train-style.py --mode smoke --style SI1.0
& tools/training/.venv/Scripts/python.exe -u tools/training/train-style.py --mode smoke --style SI2.0
```

旧 `run-local.ps1` 只用于CPU流程。风格训练现在拒绝覆盖非空结果目录，重复试验必须用 `--output-dir` 指定新的目录。

## 数据与模型

- `资源库/99_历史归档/训练实验/layout-v0/labels.json`：12家体验桌数量，11家面积有效。徐州3张产品体验桌，另有开箱桌，不计入目标；马来西亚PDH面积未转录，排除面积训练。
- `geometry-drafts.json`：4家图纸几何草标注，其中2家缺少足够尺寸基准；所有几何仍不具备训练资格，避免伪精确。
- `model.json`：11家训练的面积→产品体验桌数量回归权重；不是整张布局生成网络，也不使用SI作为输入。3000次梯度更新，固定正则系数0.1。
- `evaluation.json`：按门店留一验证，所有标准化在训练折内计算；均值基线也只使用训练折。最终权重使用全部11家，不另声称有独立测试集。
- `style-v0/metadata.jsonl`：22图，按店分为18训练图、4验证图；验证店PDF-194和PDF-296。
- `style-v0/runs/smoke-SI*/`：tiny模型LoRA，80步、64×64，保存权重、每步loss、验证噪声MSE及同种子前后图。

tiny Stable Diffusion 是测试模型，输出没有实用的门店视觉质量；这些权重只能与同一tiny基模加载，**不能装到SD1.5当作已训练的SI风格**。验证loss仅检查训练管线，不代表风格、人眼质量、几何一致性或泛化能力。正式训练必须重训。

## 本机GPU试训

本机已用真实CUDA张量运算验证4070可用。`requirements-lock.txt` 是旧CPU的快照，不要覆盖当前CUDA环境。

```powershell
& tools/training/.venv4070/Scripts/python.exe tools/training/train-style.py --mode gpu --style SI1.0 --steps 80 --precision bf16 --variant fp16 --revision 451f4fe16113bff5a5d2269ed5ad43b0592e9a14 --output-dir 资源库/99_历史归档/训练实验/rtx4070-pilot/SI1.0-new-run
# SI2.0单独运行，替换style及output-dir；同一GPU不要同时启动两份。
```

GPU模式默认SD1.5、512px、rank4、学习率1e-4、FP32、梯度检查点；本机示例明确选择BF16计算和fp16基模文件。先80步验证管线，默认800步也不是质量保证。可用 `--base-model` 指向兼容的本地Diffusers SD模型目录。当前不支持SDXL/FLUX、断点续训；不自动租GPU、不上传数据。现有中心裁正方形仅用于管线试验，扩充时应采用保留构图的比例分桶。数据扩充与图纸版本核对后再做正式训练，避免对9家训练店过拟合。

参考：[Diffusers官方LoRA训练](https://huggingface.co/docs/diffusers/main/training/lora)、[tiny测试基模](https://huggingface.co/hf-internal-testing/tiny-stable-diffusion-pipe)。
