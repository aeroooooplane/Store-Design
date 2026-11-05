"""单主平面轮廓：去除离散噪点、填内部小洞，不把凹轮廓凸包化。"""

from collections import deque
import numpy as np


def components(mask, diagonal=True):
    mask = np.asarray(mask, dtype=bool)
    seen = np.zeros(mask.shape, dtype=bool)
    h, w = mask.shape
    offsets = [(-1, 0), (1, 0), (0, -1), (0, 1)]
    if diagonal:
        offsets += [(-1, -1), (-1, 1), (1, -1), (1, 1)]
    result = []
    for y, x in zip(*np.where(mask)):
        if seen[y, x]:
            continue
        points = []
        q = deque([(y, x)])
        seen[y, x] = True
        while q:
            y, x = q.popleft()
            points.append((y, x))
            for dy, dx in offsets:
                yy, xx = y + dy, x + dx
                if 0 <= yy < h and 0 <= xx < w and mask[yy, xx] and not seen[yy, xx]:
                    seen[yy, xx] = True
                    q.append((yy, xx))
        result.append(points)
    return result


def clean_outline(mask):
    mask = np.asarray(mask, dtype=bool)
    parts = components(mask)
    out = np.zeros_like(mask)
    if not parts:
        return out
    largest = max(parts, key=len)
    yy, xx = zip(*largest)
    out[yy, xx] = True
    # 4连通背景与8连通前景互补，保留与外界连通的凹口。
    h, w = out.shape
    for hole in components(~out, diagonal=False):
        if not any(y in (0, h - 1) or x in (0, w - 1) for y, x in hole):
            yy, xx = zip(*hole)
            out[yy, xx] = True
    return out
