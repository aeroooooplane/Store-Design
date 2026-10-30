# 48 家开发集草稿校正与复评（2026-10-30）

本轮固定 48 家全部逐店查看原图、描写边界、读取量尺依据。31 家形成三项可判定的代理参照；17 家集中待确认，其中 11 家边界归属不明确，另 6 家仅缺主入口方向。所有记录仍为 `agent_visual_draft`，用户签核数为 0。45 家金标准未读取标注或评分，继续只作验收。

## 固定版本及结果

基线 `e15812eb75d483fbe8ae7f61a48a0b0c4cb7ab99`，候选 `49f5aa641bcf962e39b002ef4035aba9dce8d8fe`。两者使用同一冻结输入，包含矢量、OCR、尺寸链与模型目录快照。

| 指标              | 基线  | 候选  | 分母解释                                    |
| ----------------- | ----- | ----- | ------------------------------------------- |
| 生成闭合边界      | 40/48 | 40/48 | 全部固定样本，仅内部几何诊断                |
| 边界 IoU ≥ 0.90   | 9/37  | 14/37 | 37 家边界可判定；11 家歧义不评分            |
| 比例相对误差 ≤ 2% | 43/48 | 43/48 | 48 家均从原图尺寸建立参照；算法无比例按失败 |
| 主入口所在边      | 20/31 | 21/31 | 边界及主通道侧均可判定的 31 家              |
| 三项同时满足      | 9/31  | 13/31 | 同一 31 家可判定子集；其余 17 家未定        |

以上是**代理草稿参照下、可判定子集的开发复评**，不能简化为全体正式准确率、45 家验收成绩或整店合格率。描点精度约 ±6 原图像素；IoU 0.88–0.92 或比例误差 1%–3% 标为抽审优先。小圆角及圆弧按折线描绘。入口只评所在边，不评门净宽；多侧明确主通道时允许多条边。柱/管井净面积、后加构件、道具位置和型号未在本轮逐项标注或评分。

逐店可判定标志、排除原因、比例、IoU、入口和临界标记见 `recognition-development-20261030-evaluation.json`；原图指纹及每个点、尺寸值、原图判断依据见 `recognition-development-20261030-reference-drafts.json`。评分直接在原图像素坐标系比较，不做平移/缩放最佳对齐。多边形交集按顶点及边相交的纵坐标分带积分，不使用低分辨率截图像素估计。

## 改善、退化与失败

边界从不达标变为达标的 5 家：NEW-015、NEW-049、NEW-064、PDF-393、PDF-407。其中 NEW-064 的入口前后都未通过，因此三项总通过增加 4 家。PDF-202 的 IoU 约 0.90→0.95，前后都已达标。入口 NEW-015、PDF-095 从不通过变为通过，PDF-098 从通过变为不通过，净增 1 家。

明显退化：PDF-098 IoU 约 0.87→0.44，候选误并外围虚线与相邻空间；PDF-090 约 0.84→0.78，候选收缩到新增矮墙/柜体内侧。两项已查看叠图核实，必须修复，不能因通过数量提高而忽略。

其他已查看叠图的失败：PDF-259 把电井误选为空间；PDF-245 把外层虚线框选为空间；NEW-024、PDF-003、PDF-411 选取局部或错误轮廓。完整失败逐店记录保留在评估 JSON，不只列成功样本。

未生成闭合边界的 8 家：NEW-019、NEW-096、PDF-050、PDF-073、PDF-079、PDF-096、PDF-217、PDF-417。其中 NEW-019、NEW-096、PDF-417 无可用比例；PDF-073、PDF-079 比例偏差也明显，导致 5 家比例项目未通过。

原图校正发现的 OCR 问题包含 NEW-024 的 1150→1130、PDF-353 的 2600→2800、PDF-412 的 6550→16550；参照改读完整、清晰的原图尺寸，不据算法估计比例反推真值。

PR156 保持草稿，不合并。下一步优先补通用线型/几何回归，修复 PDF-098、PDF-090 的退化；继续使用同一输入包复评。不能按店号特判、替换失败样本或用 45 家调参。

## 本地交付物

- `C:/Users/insta360/Documents/Codex/recognition-development-inputs-20261030/`：48 家固定输入、PNG、模型快照与 SHA-256 清单。
- `C:/Users/insta360/Documents/Codex/recognition-development-runs-20261030/{baseline,candidate}/`：两个固定版本的完整识别结果。
- `C:/Users/insta360/Documents/Codex/recognition-development-review-20261030-corrected/`：`复评与歧义.html`、`开发集审核.html`、`待确认问题.json`、标注草稿、逐店 CSV/JSON、48 张原图及蓝/绿叠图。
- `C:/Users/insta360/Documents/Codex/recognition-development-evaluation-20261030/`：完整评价 JSON/CSV。

审核服务仅监听 `127.0.0.1:8767`，独立于主服务 5173/3001。原 8766 空白审核页及其本地存储保留；校正包采用独立版本键。页面支持逐店深链接、草稿导入导出；集中歧义页的答复保存在浏览器本地，可导出 JSON，不自动修改标注或发送给外部。

## 重放与验证

Node 24 和已安装的项目依赖下，先以 `freeze-development-inputs.mjs --dataset <candidates.json> --resource-root <资源根> --out <新输入目录>` 只读抽取。已有冻结包直接复用，禁止覆盖。再以 `run-development-inputs.mjs --inputs <固定输入目录> --engine <固定代码工作区> --out <版本结果目录>` 分别运行两个版本。识别/shared 源码存在未提交改动时拒绝运行；冻结输入不完整或指纹变化时也拒绝。

`evaluate-development-references.mjs` 接受 `--references`、`--dataset`、`--baseline`、`--candidate`、`--out`；输入参照必须明示代理草稿且匹配固定原图。`build-development-review.mjs` 加 `--inputs`、`--corrections` 生成带草稿的审核包；`build-development-summary.mjs --review <审核目录> --evaluation <复评目录> --references <参照JSON>` 生成集中歧义页。

本地工具检查：`node tools/recognition/check-review-template.mjs`（12 项），`node tools/recognition/check-development-metrics.mjs`（11 项），`node tools/recognition/check-development-references.mjs`（全部 48 家身份/指纹/几何/量尺/状态）。引擎本轮未修改；新增工具和参照文件不冒用此前 49f5aa64 的 CI 通过状态。
