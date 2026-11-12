import {
  LayoutSchema,
  SpaceSchema,
  normalizeRotation,
  polygonInsidePolygon,
  validateSpace,
} from '@store/shared'
import type { Layout, Space } from '@store/shared'
import { AppError } from '../../lib/app-error.ts'
import type { FineDraft } from './fine-contract.ts'
export function convertFine(d: FineDraft) {
  if (!d.calibration || d.boundary.length < 3 || !d.heightMm || !d.structureReviewed)
    throw new AppError('VALIDATION_FAILED', '请先核对范围、量尺、层高和开敞边')
  const c = d.calibration,
    length = Math.hypot(c.b[0] - c.a[0], c.b[1] - c.a[1])
  if (length < 5) throw new AppError('VALIDATION_FAILED', '量尺两点至少相距5像素')
  const scale = c.mm / length / 1000,
    ox = Math.min(...d.boundary.map((p) => p[0])),
    oy = Math.min(...d.boundary.map((p) => p[1]))
  const point = (p: [number, number]): [number, number] => [
    +(scale * (p[0] - ox)).toFixed(5),
    +(scale * (p[1] - oy)).toFixed(5),
  ]
  const boundary = d.boundary.map(point)
  if (d.openEdges.some((i) => i >= boundary.length))
    throw new AppError('VALIDATION_FAILED', '开敞边编号超出范围，请重新核对')
  const space: Space = {
    schemaVersion: 1,
    boundary,
    height: d.heightMm / 1000,
    entrances: d.entrances.map((e) => ({ ...e, a: point(e.a), b: point(e.b) })),
    openEdges: d.openEdges.map((i) => ({
      a: boundary[i]!,
      b: boundary[(i + 1) % boundary.length]!,
    })),
    obstacles: [],
    calibration: { method: 'manual', reference: '精细几何草稿原图两点量尺', verified: true },
  }
  const layout: Layout = { schemaVersion: 3, items: [], planning: null },
    omissions: { id: string; label: string; reason: string }[] = []
  for (const o of d.objects) {
    if (o.status === 'reject') continue
    const omit = (reason: string) => omissions.push({ id: o.id, label: o.label, reason })
    if (o.status !== 'keep') {
      omit('尚未确认')
      continue
    }
    const ps = o.points.map(point)
    if (o.kind === 'column') {
      if (!polygonInsidePolygon(ps, boundary)) {
        omit('柱跨越范围，保留原图轮廓；请人工核定范围或柱形')
        continue
      }
      space.obstacles.push({
        kind: 'column',
        polygon: ps,
        height: o.heightMm ? o.heightMm / 1000 : null,
        label: o.label,
      })
      continue
    }
    if (o.kind !== 'furniture') {
      omit(
        o.kind === 'wall-display'
          ? '屏幕保留二维图面；未确定安装面，不生成嵌墙实体'
          : '此类对象暂保留二维图面',
      )
      continue
    }
    if (ps.length !== 4 || !o.heightMm) {
      omit('需矩形外框与明确的道具高度；当前仅保留二维')
      continue
    }
    const [a, b, c1, d1] = ps as [
        [number, number],
        [number, number],
        [number, number],
        [number, number],
      ],
      u = [b[0] - a[0], b[1] - a[1]],
      v = [d1[0] - a[0], d1[1] - a[1]],
      w = Math.hypot(u[0]!, u[1]!),
      depth = Math.hypot(v[0]!, v[1]!)
    if (
      !w ||
      !depth ||
      Math.abs(u[0]! * v[0]! + u[1]! * v[1]!) > w * depth * 0.02 ||
      Math.hypot(c1[0] - (b[0] + d1[0] - a[0]), c1[1] - (b[1] + d1[1] - a[1])) > 0.01
    ) {
      omit('非矩形轮廓暂保留二维')
      continue
    }
    if (!polygonInsidePolygon(ps, boundary)) {
      omit('道具跨越范围，暂不建模')
      continue
    }
    const angle = normalizeRotation((Math.atan2(u[1]!, u[0]!) * 180) / Math.PI),
      swap = Math.round(angle / 90) % 2 !== 0
    layout.items.push({
      id: o.id,
      assetId: null,
      function: 'other',
      name: o.label,
      cx: (a[0] + c1[0]) / 2,
      cz: (a[1] + c1[1]) / 2,
      rotation: angle,
      w: swap ? depth : w,
      d: swap ? w : depth,
      h: o.heightMm / 1000,
      placeholder: true,
      locked: false,
    })
  }
  const parsedSpace = SpaceSchema.parse(space),
    issues = validateSpace(parsedSpace).filter((i) => i.severity === 'error')
  if (issues.length)
    throw new AppError('VALIDATION_FAILED', issues.map((i) => i.message).join('；'))
  return { space: parsedSpace, layout: LayoutSchema.parse(layout), omissions }
}
