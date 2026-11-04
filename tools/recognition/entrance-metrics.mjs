// 原图像素坐标，多入口路径长度加权覆盖。重复预测单独扣分，不奖励只命中一个入口。
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1])
const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
export function expandEntrance(path) {
  if (
    !path ||
    !['polyline', 'arc'].includes(path.kind) ||
    !Array.isArray(path.points) ||
    path.points.length < 2 ||
    path.points.length > 2000 ||
    path.points.some((p) => !Array.isArray(p) || p.length !== 2 || !p.every(Number.isFinite))
  )
    throw Error('入口路径无效')
  if (path.kind === 'polyline') return path.points
  if (path.points.length !== 3) throw Error('圆弧必须是3点')
  const [a, b, c] = path.points,
    d = 2 * cross(a, b, c)
  if (Math.abs(d) < 0.01) throw Error('圆弧三点共线')
  const aa = a[0] ** 2 + a[1] ** 2,
    bb = b[0] ** 2 + b[1] ** 2,
    cc = c[0] ** 2 + c[1] ** 2
  const o = [
    (aa * (b[1] - c[1]) + bb * (c[1] - a[1]) + cc * (a[1] - b[1])) / d,
    (aa * (c[0] - b[0]) + bb * (a[0] - c[0]) + cc * (b[0] - a[0])) / d,
  ]
  const r = dist(a, o),
    tau = 2 * Math.PI,
    positive = (v) => ((v % tau) + tau) % tau,
    angle = (p) => Math.atan2(p[1] - o[1], p[0] - o[0])
  const start = angle(a),
    end = positive(angle(c) - start),
    mid = positive(angle(b) - start),
    sweep = mid <= end ? end : end - tau
  const n = Math.max(8, Math.ceil((Math.abs(sweep) * r) / 4))
  if (n > 20000) throw Error('圆弧采样超限')
  return Array.from({ length: n + 1 }, (_, i) => [
    o[0] + r * Math.cos(start + (sweep * i) / n),
    o[1] + r * Math.sin(start + (sweep * i) / n),
  ])
}
function segments(paths) {
  if (!Array.isArray(paths) || paths.length > 100) throw Error('入口数量无效')
  return paths.flatMap((p, index) => {
    const points = expandEntrance(p)
    return points.slice(1).map((b, i) => {
      const a = points[i],
        length = dist(a, b)
      if (length < 1e-8) throw Error('入口存在重复点')
      return { a, b, index, length, dir: [(b[0] - a[0]) / length, (b[1] - a[1]) / length] }
    })
  })
}
function samples(segs) {
  return segs.flatMap((s) => {
    const n = Math.ceil(s.length / 4)
    if (n > 20000) throw Error('路径采样超限')
    return Array.from({ length: n }, (_, i) => ({
      p: [
        s.a[0] + ((s.b[0] - s.a[0]) * (i + 0.5)) / n,
        s.a[1] + ((s.b[1] - s.a[1]) * (i + 0.5)) / n,
      ],
      dir: s.dir,
      weight: s.length / n,
      index: s.index,
    }))
  })
}
function matched(sample, target, tolerance, interior = false) {
  return target.some((s) => {
    if (Math.abs(sample.dir[0] * s.dir[0] + sample.dir[1] * s.dir[1]) < Math.cos(Math.PI / 6))
      return false
    const projection =
      ((sample.p[0] - s.a[0]) * s.dir[0] + (sample.p[1] - s.a[1]) * s.dir[1]) / s.length
    if (interior && (projection <= 0 || projection >= 1)) return false
    const t = Math.max(0, Math.min(1, projection))
    return (
      dist(sample.p, [s.a[0] + (s.b[0] - s.a[0]) * t, s.a[1] + (s.b[1] - s.a[1]) * t]) <= tolerance
    )
  })
}
export function scoreEntrances(
  reference,
  predicted,
  { coverage = 'partial', tolerance = 12 } = {},
) {
  if (
    !['partial', 'complete', 'unknown'].includes(coverage) ||
    !Number.isFinite(tolerance) ||
    tolerance <= 0
  )
    throw Error('评分选项无效')
  const refs = segments(reference),
    pred = segments(predicted),
    rs = samples(refs),
    ps = samples(pred)
  const sum = (a) => a.reduce((s, p) => s + p.weight, 0),
    referenceLength = sum(rs),
    predictedLength = sum(ps)
  if (coverage === 'complete' && !referenceLength) throw Error('完整参照不可为空')
  const covered = sum(rs.filter((p) => matched(p, pred, tolerance))),
    hit = sum(ps.filter((p) => matched(p, refs, tolerance)))
  const duplicate = sum(
    ps.filter((p) =>
      matched(
        p,
        pred.filter((s) => s.index < p.index),
        1,
        true,
      ),
    ),
  )
  const knownReferenceCoverage = referenceLength ? covered / referenceLength : null
  const complete = coverage === 'complete',
    precision = complete
      ? predictedLength
        ? Math.max(0, (hit - duplicate) / predictedLength)
        : 0
      : null,
    recall = complete ? knownReferenceCoverage : null
  const f1 = complete
    ? precision + recall
      ? (2 * precision * recall) / (precision + recall)
      : 0
    : null
  return {
    coverage,
    tolerancePx: tolerance,
    referencePaths: reference.length,
    predictedPaths: predicted.length,
    referenceLengthPx: referenceLength,
    predictedLengthPx: predictedLength,
    knownReferenceCoverage,
    precision,
    recall,
    f1,
    duplicatePredictedLengthPx: duplicate,
    pass: complete ? precision >= 0.9 && recall >= 0.9 && duplicate < 1 : null,
  }
}
