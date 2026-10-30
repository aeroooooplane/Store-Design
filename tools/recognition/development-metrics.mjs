// 对原图像素坐标中的简单多边形计算面积交并比；不平移、不缩放对齐预测。
export const area = (p) =>
  Math.abs(
    p.reduce((a, [x, y], i) => {
      const q = p[(i + 1) % p.length]
      return a + x * q[1] - q[0] * y
    }, 0),
  ) / 2
const cross = (a, b) => a[0] * b[1] - a[1] * b[0]
const minus = (a, b) => [a[0] - b[0], a[1] - b[1]]
const edges = (p) => p.map((a, i) => [a, p[(i + 1) % p.length]])
function intervals(p, y) {
  const xs = edges(p)
    .filter(([a, b]) => a[1] > y !== b[1] > y)
    .map(([a, b]) => a[0] + ((y - a[1]) * (b[0] - a[0])) / (b[1] - a[1]))
    .sort((a, b) => a - b)
  return xs.filter((_, i) => i % 2 === 0).map((x, i) => [x, xs[i * 2 + 1]])
}
export function intersectionArea(a, b) {
  const ys = [...a, ...b].map((p) => p[1])
  for (const [p, q] of edges(a))
    for (const [r, s] of edges(b)) {
      const u = minus(q, p),
        v = minus(s, r),
        den = cross(u, v)
      if (Math.abs(den) < 1e-10) continue
      const t = cross(minus(r, p), v) / den,
        w = cross(minus(r, p), u) / den
      if (t > 0 && t < 1 && w > 0 && w < 1) ys.push(p[1] + t * u[1])
    }
  const breaks = [...new Set(ys)].sort((a, b) => a - b)
  let total = 0
  for (let k = 1; k < breaks.length; k++) {
    const dy = breaks[k] - breaks[k - 1],
      y = (breaks[k] + breaks[k - 1]) / 2,
      aa = intervals(a, y),
      bb = intervals(b, y)
    let width = 0,
      i = 0,
      j = 0
    while (i < aa.length && j < bb.length) {
      width += Math.max(0, Math.min(aa[i][1], bb[j][1]) - Math.max(aa[i][0], bb[j][0]))
      if (aa[i][1] < bb[j][1]) i++
      else j++
    }
    total += width * dy
  }
  return total
}
export function iou(a, b) {
  if (a.length < 3 || b.length < 3) return 0
  const hit = intersectionArea(a, b),
    union = area(a) + area(b) - hit
  return union > 0 ? Math.max(0, Math.min(1, hit / union)) : 0
}
const distanceToSegment = (p, a, b) => {
  const d = minus(b, a),
    v = minus(p, a),
    t = Math.max(0, Math.min(1, (v[0] * d[0] + v[1] * d[1]) / (d[0] ** 2 + d[1] ** 2 || 1)))
  return Math.hypot(p[0] - a[0] - t * d[0], p[1] - a[1] - t * d[1])
}
// 仅核对所在边，不把自动默认门宽当成准确门净宽。圆弧的相邻折线段可属于同一入口侧。
export function entranceMatches(boundary, accepted, entrances, tolerance) {
  return entrances.some(([a, b]) => {
    const center = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2],
      distances = edges(boundary).map(([p, q]) => distanceToSegment(center, p, q)),
      best = Math.min(...distances)
    return best <= tolerance && accepted.some((i) => distances[i] <= best + 1e-6)
  })
}
