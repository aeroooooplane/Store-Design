import type { RecognitionScale, RecognizeRequest } from '@store/shared'
import { AXIS_TOLERANCE_PX, RATIO_TOLERANCE, centre } from './lines.ts'
import type { Box, Line, Text } from './lines.ts'

/** Dimension text: "5400", "5400 mm", "6.5米", "3450 长墙净尺寸" → millimetres. */
export function dimensionMm(text: string): number | null {
  const t = text.trim()
  const metres = /^(\d+(?:\.\d+)?)\s*(?:米|m)$/i.exec(t)
  if (metres?.[1]) return Number(metres[1]) * 1000
  const mm = /^(\d{3,5})(\s*mm)?(?:\s+\S{1,12})?$/i.exec(t)
  if (mm?.[1]) {
    const value = Number(mm[1])
    // "500mm" with its unit is a logo or lintel height; plan dimension chains are bare numbers.
    return mm[2] && value < 1000 ? null : value
  }
  return null
}

/**
 * The dimension line a dimension text labels: the nearest line parallel to the text that runs
 * past it and is longer than it (the text sits on or right beside its line; other parallel
 * lines, like prop boxes, are farther away).
 */
export function dimensionLine(text: Text, lines: Line[]): Line | null {
  const horizontal = text.w >= text.h
  const [cx, cy] = centre(text)
  const reach = Math.max(text.h, text.w) * 3
  const textLength = Math.max(text.w, text.h)
  let best: { line: Line; gap: number } | null = null
  for (const l of lines) {
    const isDir = horizontal
      ? Math.abs(l.y1 - l.y2) <= AXIS_TOLERANCE_PX
      : Math.abs(l.x1 - l.x2) <= AXIS_TOLERANCE_PX
    if (!isDir) continue
    const pos = horizontal ? (l.y1 + l.y2) / 2 : (l.x1 + l.x2) / 2
    const gap = Math.abs(pos - (horizontal ? cy : cx))
    const along = horizontal ? cx : cy
    const [s, e] = horizontal ? [l.x1, l.x2] : [l.y1, l.y2]
    const length = Math.abs(e - s)
    if (gap > reach || length < textLength * 1.5) continue
    if (along < Math.min(s, e) - text.h || along > Math.max(s, e) + text.h) continue
    if (!best || gap < best.gap) best = { line: l, gap }
  }
  return best?.line ?? null
}

const lineLength = (l: Line) => Math.hypot(l.x1 - l.x2, l.y1 - l.y2)

/** Pixel length a dimension text measures: its dimension line, else the boundary side beside it. */
function dimensionPixels(text: Text, line: Line | null, boundary: Box | null): number | null {
  if (line) return lineLength(line)
  if (!boundary) return null
  const horizontal = text.w >= text.h
  const [cx, cy] = centre(text)
  const near = Math.max(boundary.w, boundary.h) * 0.15
  if (
    horizontal &&
    Math.min(Math.abs(cy - boundary.y), Math.abs(cy - boundary.y - boundary.h)) < near
  ) {
    return boundary.w
  }
  if (
    !horizontal &&
    Math.min(Math.abs(cx - boundary.x), Math.abs(cx - boundary.x - boundary.w)) < near
  ) {
    return boundary.h
  }
  return null
}

interface ScaleResult {
  scale: RecognitionScale | null
  notes: string[]
}

export function findScale(
  dimensions: { text: Text; mm: number; line: Line | null }[],
  areas: { text: string; m2: number }[],
  boundary: Box | null,
  calibration: RecognizeRequest['calibration'],
  labelled: { text: Text; box: Box | null; sizeM: number | null; knownM: number | null }[],
): ScaleResult {
  const originPx: [number, number] = boundary ? [boundary.x, boundary.y] : [0, 0]
  if (calibration) {
    const px = Math.hypot(calibration.a[0] - calibration.b[0], calibration.a[1] - calibration.b[1])
    if (px > 0) {
      return {
        scale: {
          method: 'manual',
          reference: `用户指定 ${calibration.mm} mm 对应 ${px.toFixed(1)} px`,
          mmPerPixel: calibration.mm / px,
          originPx,
          verified: true,
        },
        notes: ['比例来自用户校准'],
      }
    }
  }
  const ratios: { ratio: number; text: string; kind: 'dimension' | 'item' | 'area' }[] = []
  for (const d of dimensions) {
    const px = dimensionPixels(d.text, d.line, boundary)
    if (px && px > 0) ratios.push({ ratio: d.mm / px, text: d.text.text.trim(), kind: 'dimension' })
  }
  // Prop names that carry a size ("1.8米开箱桌") measure their own box.
  for (const l of labelled) {
    if (!l.box) continue
    // A name without a size still measures its box when the catalogue knows one size for it.
    const sizeM = l.sizeM ?? l.knownM
    if (sizeM === null) continue
    const longPx = Math.max(l.box.w, l.box.h)
    if (longPx > 0) {
      ratios.push({ ratio: (sizeM * 1000) / longPx, text: l.text.text.trim(), kind: 'item' })
    }
  }
  // "店铺实测面积：31.5m²" against the boundary's area gives (or checks) the scale too.
  if (boundary) {
    for (const a of areas) {
      ratios.push({
        ratio: Math.sqrt((a.m2 * 1e6) / (boundary.w * boundary.h)),
        text: a.text,
        kind: 'area',
      })
    }
  }
  if (!ratios.length) {
    return { scale: null, notes: ['图上没有尺寸标注、面积，也没有带尺寸的道具名称'] }
  }
  // The value most of the readings agree on; a lone odd one (a "200mm" logo height) is outvoted,
  // and so is any reading that would make the shop absurdly small or large.
  const cluster = (r: number) => ratios.filter((o) => Math.abs(o.ratio - r) / r <= RATIO_TOLERANCE)
  const plausible = (r: number) => {
    if (!boundary) return 0.5
    const m2 = (boundary.w * boundary.h * r * r) / 1e6
    return m2 >= 3 && m2 <= 2000 ? 0.5 : 0
  }
  const agreeing =
    ratios
      .map((r) => ({
        members: cluster(r.ratio),
        score: cluster(r.ratio).length + plausible(r.ratio),
      }))
      .sort((a, b) => b.score - a.score)[0]?.members ?? []
  const ratio = agreeing.reduce((sum, r) => sum + r.ratio, 0) / agreeing.length
  const verified = agreeing.length >= 2
  const dims = agreeing.filter((r) => r.kind === 'dimension')
  const items = agreeing.filter((r) => r.kind === 'item')
  const areasUsed = agreeing.filter((r) => r.kind === 'area')
  const reference = [
    dims.length ? `尺寸标注 ${dims.map((r) => r.text).join('、')}` : '',
    items.length ? `道具名称 ${items.map((r) => r.text).join('、')} 与其图框` : '',
    areasUsed.length ? `${areasUsed.map((r) => r.text).join('、')} 与边界` : '',
  ]
    .filter(Boolean)
    .join('；')
  return {
    scale: {
      method: dims.length ? 'dimension' : items.length ? 'item_label' : 'area',
      reference,
      mmPerPixel: ratio,
      originPx,
      verified,
    },
    notes: [
      `比例按 ${agreeing.length} 处依据${verified ? '交叉核对' : ''}得出（1 px = ${ratio.toFixed(2)} mm）` +
        (ratios.length > agreeing.length
          ? `，另有 ${ratios.length - agreeing.length} 处不一致已忽略`
          : ''),
    ],
  }
}
