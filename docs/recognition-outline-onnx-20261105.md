# 轮廓模型ONNX数值一致性修复

上一轮20家真实训练完成，但导出概率差0.005569845超过0.005上限。此次保持原checkpoint和阈值不变，仅在导出副本使用FP64累积GroupNorm均值/中心化方差，再转回输入类型做仿射变换；卷积仍为FP32。导出关闭PyTorch图优化以保留显式统计表达，ONNX Runtime使用默认优化。

逐层检查PDF-402：所有卷积权重及归一化仿射参数与原模型一致；第一层卷积最大差8.94e-8，首个GroupNorm后升至0.00157595，最终logit差约0.02009。关闭MKLDNN、切换ORT优化、仅以FP32改写中心化方差均未解决。记录在本机`outline-layer-diagnosis.log`、`outline-trace-layers.log`和此前失败诊断中。这里只定位当前计算路径的数值误差，不宣称所有平台/模型均有相同问题。

原训练20图加8类合成输入（全白、全黑、常量灰、低对比度、噪声、棋盘、细线、阶跃）共28项：最大概率差 **0.0000205934**，阈值分割像素差 **0**，全部通过原有概率<0.005及单图掩膜差<0.0001标准。真实20图最大差约0.00001094。不读取48家标签或45家验收集来调整导出。

数据manifest：`21d24d47cfaef1ccdfee25b0bda24ff42561399b9550f953aa6a9a5e52a8a762`。

原checkpoint：`ab4ce1a5859393c5f45962d93432f69ceb3c896a236a2f1f4e41d1d9d0063466`。

产物在`C:/Users/insta360/Documents/Codex/outline-onnx-export-20261105-v1/`，含新ONNX、逐输入误差、来源manifest及三份工具源代码快照、文件哈希。旧失败模型及全部训练输出不变。ONNX通过表示计算一致，不能将原70.71%内部IoU解释为生产达标。

## 执行

```powershell
python tools/recognition-training/export_model.py --dataset <训练包> --manifest-sha256 <数据manifest哈希> --checkpoint <best.pt> --checkpoint-sha256 <权重哈希> --out <不存在的新目录>
```

工具校验数据隔离、指定哈希、checkpoint绑定及像素/多边形一致性后执行导出，自动比较20图和8类合成输入。训练器以后也使用此导出路径。原训练结构、优化器、参数、损失和模型选择不变。

本地39项Python回归通过，新增权重不变/原模型不修改、常量及低对比度归一化检查。轻量CI缺少Pillow/PyTorch时显式跳过3项依赖运行时的测试；本地完整环境全部执行。全仓检查及CI结果见本PR。

FP64统计增加推理成本；本轮只验证本机Windows CPU、固定256输入，CUDA、WebGPU、移动端均未验证。模型尚未接入工作台；后续轮廓误检修复与48家开发复评单独分支/PR，45家继续隔离。
