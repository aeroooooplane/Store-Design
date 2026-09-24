# 本地训练

用户已确认无GPU，先完成本机能执行的范围。Python 3.11独立环境位于 `.venv`，不会修改Demo的Node依赖。原始门店图纸没有上传，只有公开基础模型与依赖的下载。

## 分开运行（项目根目录）

```powershell
node tools/training/prepare-layout.mjs
node --test tools/training/layout-model.test.mjs
node tools/training/train-layout.mjs
& tools/training/.venv/Scripts/python.exe tools/training/prepare-style.py
& tools/training/.venv/Scripts/python.exe -u tools/training/train-style.py --mode smoke --style SI1.0
& tools/training/.venv/Scripts/python.exe -u tools/training/train-style.py --mode smoke --style SI2.0
```

也可在允许本地脚本运行的PowerShell中执行 `tools/training/run-local.ps1`，脚本不更改系统执行策略。重复运行会覆盖同名实验结果，需要保留实验时先复制对应 runs 子目录。

## 数据与模型

- `素材库/04_training/layout-v0/labels.json`：12家体验桌数量，11家面积有效。徐州3张产品体验桌，另有开箱桌，不计入目标；马来西亚PDH面积未转录，排除面积训练。
- `geometry-drafts.json`：4家图纸几何草标注，其中2家缺少足够尺寸基准；所有几何仍不具备训练资格，避免伪精确。
- `model.json`：11家训练的面积→产品体验桌数量回归权重；不是整张布局生成网络，也不使用SI作为输入。3000次梯度更新，固定正则系数0.1。
- `evaluation.json`：按门店留一验证，所有标准化在训练折内计算；均值基线也只使用训练折。最终权重使用全部11家，不另声称有独立测试集。
- `style-v0/metadata.jsonl`：22图，按店分为18训练图、4验证图；验证店PDF-194和PDF-296。
- `style-v0/runs/smoke-SI*/`：tiny模型LoRA，80步、64×64，保存权重、每步loss、验证噪声MSE及同种子前后图。

tiny Stable Diffusion 是测试模型，输出没有实用的门店视觉质量；这些权重只能与同一tiny基模加载，**不能装到SD1.5当作已训练的SI风格**。验证loss仅检查训练管线，不代表风格、人眼质量、几何一致性或泛化能力。正式训练必须重训。

## 以后有GPU时

在GPU机器安装Python3.11及与CUDA匹配的PyTorch，再安装 requirements.txt 其余依赖。`requirements-lock.txt` 是本机CPU的完整快照，不要在GPU环境盲目覆盖CUDA版本。

```powershell
python tools/training/train-style.py --mode gpu --style SI1.0 --steps 800
python tools/training/train-style.py --mode gpu --style SI2.0 --steps 800
```

GPU模式默认SD1.5、512px、rank4、学习率1e-4、FP32、梯度检查点，800步只是首轮试验参数，不是质量保证；本机未验证该规模的显存需求。可用 `--base-model` 指向兼容的本地Diffusers SD模型目录。当前实现不支持SDXL/FLUX，不支持断点续训，不自动租GPU、不上传数据。数据扩充与图纸版本核对后再开展正式训练，避免对9家训练店过拟合。

参考：[Diffusers官方LoRA训练](https://huggingface.co/docs/diffusers/main/training/lora)、[tiny测试基模](https://huggingface.co/hf-internal-testing/tiny-stable-diffusion-pipe)。
