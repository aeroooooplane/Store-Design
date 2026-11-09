"""按整页和边缘亮度识别黑底线图；不读取轮廓标签。"""

import numpy as np
from PIL import ImageOps


def synthetic_dark_page(image):
    """独立原页的深灰底/低对比线增强；不改变像素位置，不读取标签。"""
    gray = image.convert("L")
    return gray.point([12 + round((255 - value) * 0.55) for value in range(256)])


def normalize_polarity(image):
    gray = image.convert("L")
    pixels = np.asarray(gray)
    band = max(1, round(min(pixels.shape) * 0.05))
    border = np.concatenate(
        [
            pixels[:band].ravel(),
            pixels[-band:].ravel(),
            pixels[:, :band].ravel(),
            pixels[:, -band:].ravel(),
        ]
    )
    inverted = float(np.median(pixels)) < 127 and float(np.median(border)) < 127
    # 黑底截图的背景常为深灰，单纯反色仍留下大片浅灰底；拉伸动态范围。
    return (
        ImageOps.autocontrast(ImageOps.invert(gray), cutoff=0.5) if inverted else gray
    ), inverted
