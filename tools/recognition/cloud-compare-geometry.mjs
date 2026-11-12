import { isSimplePolygon } from '../../packages/shared/src/geometry/index.ts'

const point = (p) => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite)
const equal = (a, b) => a[0] === b[0] && a[1] === b[1]
const ring = (points) =>
  Array.isArray(points) &&
  points.length > 1 &&
  point(points[0]) &&
  point(points.at(-1)) &&
  equal(points[0], points.at(-1))
    ? points.slice(0, -1)
    : points
const distance = (p, a, b) => {
  const dx = b[0] - a[0],
    dy = b[1] - a[1],
    den = dx * dx + dy * dy
  const t = den ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / den)) : 0
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy)
}

// 只按请求指定的原图像素坐标校验；不猜测1000归一化、不吸附、不补尺度。
export function inspectGeometry(answer, { width, height }) {
  const issues = [],
    dimensions = []
  const issue = (code, path, message) => issues.push({ code, path, message, severity: 'error' })
  const inImage = (p) => point(p) && p[0] >= 0 && p[1] >= 0 && p[0] <= width && p[1] <= height
  const regions = Array.isArray(answer.regions) ? answer.regions.map((r) => ring(r.points)) : []
  if (!regions.length) issue('missing-regions', 'regions', '没有门店范围')
  const validRegions = []
  regions.forEach((points, i) => {
    if (
      !Array.isArray(points) ||
      points.length < 3 ||
      points.length > 200 ||
      !points.every(inImage)
    )
      return issue('invalid-region', `regions.${i}`, '区域坐标越界或格式错误')
    if (!isSimplePolygon(points))
      return issue('self-intersection', `regions.${i}`, '轮廓自交或退化')
    validRegions.push(points)
  })
  const onEdge = (p) =>
    validRegions.some((r) => r.some((a, i) => distance(p, a, r[(i + 1) % r.length]) <= 2))
  const entrances = Array.isArray(answer.entrances) ? answer.entrances : []
  if (!entrances.length)
    issue('entrances-unresolved', 'entrances', '入口未识别，不能确认为完整门店')
  entrances.forEach((entry, i) => {
    const p = entry.path
    if (!Array.isArray(p) || p.length < 2 || !p.every(inImage))
      return issue('invalid-entrance', `entrances.${i}`, '入口坐标格式错误或越界')
    const samples = [...p]
    for (let j = 1; j < p.length; j++)
      for (let k = 1; k < 10; k++)
        samples.push([
          p[j - 1][0] + ((p[j][0] - p[j - 1][0]) * k) / 10,
          p[j - 1][1] + ((p[j][1] - p[j - 1][1]) * k) / 10,
        ])
    if (!samples.every(onEdge))
      issue(
        'entrance-off-boundary',
        `entrances.${i}`,
        '入口路径穿入店内或越出边界，不能作为沿边界开口',
      )
  })
  for (const [i, d] of (Array.isArray(answer.dimensions) ? answer.dimensions : []).entries()) {
    if (/㎡|平方米|m\s*(?:²|2|\^2)/i.test(String(d.text))) {
      issue('area-as-length', `dimensions.${i}`, '面积文字被当成线性毫米尺寸')
      continue
    }
    if (!inImage(d.start) || !inImage(d.end) || !Number.isFinite(d.mm) || d.mm <= 0) {
      issue('invalid-dimension', `dimensions.${i}`, '尺寸端点或毫米值无效')
      continue
    }
    const px = Math.hypot(d.end[0] - d.start[0], d.end[1] - d.start[1])
    if (px === 0) {
      issue('zero-dimension', `dimensions.${i}`, '尺寸线两端重合')
      continue
    }
    dimensions.push({
      index: i,
      text: d.text,
      mm: d.mm,
      pixels: px,
      mmPerPixel: d.mm / px,
      start: d.start,
      end: d.end,
    })
  }
  const long = dimensions.filter((d) => d.mm >= 1000 && d.pixels >= 30)
  const ratios = long.map((d) => d.mmPerPixel).sort((a, b) => a - b),
    median = ratios[Math.floor(ratios.length / 2)]
  let scaleCandidate = null
  if (long.length < 2 || new Set(long.map((d) => d.mm)).size < 2)
    issue('insufficient-scale', 'dimensions', '缺少至少两种长度的比例依据')
  else {
    const deviations = long.map((d) => Math.abs(d.mmPerPixel / median - 1))
    if (deviations.some((d) => d > 0.05))
      issue('conflicting-scale', 'dimensions', '较长尺寸线给出互相冲突的比例，不能自动选一个')
    else scaleCandidate = { mmPerPixel: median, verified: false, readings: long }
  }
  if (
    !Number.isFinite(answer.ceilingHeight) ||
    answer.ceilingHeight < 1500 ||
    answer.ceilingHeight > 20000
  )
    issue('height-unresolved', 'ceilingHeight', '室内层高缺失或无效')
  if ((answer.obstacles ?? []).some((o) => !['column', 'shaft', 'internal_wall'].includes(o.type)))
    issue('obstacle-type-unresolved', 'obstacles', '部分障碍类型仍不明')
  return {
    coordinateSystem: 'requested-original-pixels',
    width,
    height,
    regionCount: regions.length,
    entranceCount: entrances.length,
    dimensionCount: dimensions.length,
    issues,
    scaleCandidate,
    dimensionReadings: dimensions,
    geometryChecksPassed: issues.length === 0,
    canAutoImport: false,
    requiresVisualReview: true,
    visualReviewed: false,
    automaticComplete: false,
  }
}
