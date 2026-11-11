"""训练专用：强调店外文字、尺寸与邻区墨线附近的负样本，不改变推理。"""

import math
import torch
import torch.nn.functional as F


def negative_ink_weights(ink, target, strength):
    if not math.isfinite(strength) or strength < 0:
        raise ValueError("难负样本权重必须为非负有限数")
    if ink.shape != target.shape or ink.ndim != 4 or ink.shape[1] != 1:
        raise ValueError("墨量与标签必须是同尺寸单通道批次")
    # 墨量取自当前训练原图（含相同仿射），不推断文字类别或擦除尺寸。
    # 标签外背景才加权；店内文字/家具不被当成负样本。
    with torch.no_grad():
        neighborhood = F.max_pool2d(ink.clamp(0, 1), 5, stride=1, padding=2)
        return 1 + strength * (target < 0.5).to(ink.dtype) * neighborhood
