import { roundM } from '@store/shared'
import type {
  Asset,
  DraftItem,
  Obstacle,
  Point,
  RecognitionDraft,
  RecognizeRequest,
  VectorContent,
} from '@store/shared'
import { countInLabel, matchCatalog, sizeInLabel } from '../check.ts'
import { findBoundary } from './boundary.ts'
import { OBSTACLE_WORDS, boxAround, boxFromLines, boxKey, sameBox } from './boxes.ts'
import {
  DEFAULT_ENTRANCE_M,
  axisLines,
  buildIndex,
  centre,
  contains,
  cropContent,
  isRed,
} from './lines.ts'
import type { Box, Text } from './lines.ts'
import { dimensionLine, dimensionMm, findScale } from './scale.ts'

export function recognizeVector(
  raw: VectorContent,
  request: Pick<RecognizeRequest, 'crop' | 'calibration'>,
  catalog: readonly Asset[],
  siStyle?: string,
): RecognitionDraft {
  const content = cropContent(raw, request.crop)
  const lines = axisLines(content)
  const boxes: Box[] = content.rects.map((r) => ({
    x: r.x,
    y: r.y,
    w: r.w,
    h: r.h,
    color: r.color,
  }))
  // Dimension texts and their lines first: dimension lines must not pass as walls.
  const dimensions = content.texts.flatMap((text) => {
    const mm = dimensionMm(text.text)
    // Plan dimensions start around 300 mm; smaller ones are logo or lintel heights.
    return mm !== null && mm >= 300 ? [{ text, mm, line: dimensionLine(text, lines) }] : []
  })
  // The shop area: a text saying 面积 with a number, else the largest bare "NN m²".
  const areaOf = (t: Text) => /(\d+(?:\.\d+)?)\s*(?:m²|㎡|平方米?)/.exec(t.text)?.[1] ?? null
  // CAD exports often split "店铺实测面积：31.5m²" into pieces on one row.
  const sameRow = (a: Text, b: Text) =>
    Math.abs(a.y + a.h / 2 - (b.y + b.h / 2)) < Math.max(a.h, b.h)
  const numberAfter = (t: Text) =>
    content.texts
      .filter(
        (o) =>
          o !== t &&
          sameRow(t, o) &&
          o.x > t.x &&
          /^\d+(?:\.\d+)?\s*(?:m|㎡|m²)?$/.test(o.text.trim()),
      )
      .sort((p, q) => p.x - q.x)[0]
  const named = content.texts.flatMap((t) => {
    if (!/面积/.test(t.text)) return []
    const own = areaOf(t)
    if (own) return [{ text: t.text.trim(), m2: Number(own) }]
    const next = numberAfter(t)
    const value = next ? /(\d+(?:\.\d+)?)/.exec(next.text)?.[1] : undefined
    return value && next ? [{ text: `${t.text.trim()}${next.text.trim()}`, m2: Number(value) }] : []
  })
  const bare = content.texts
    .filter((t) => /^\d+(?:\.\d+)?\s*(?:m²|㎡)$/.test(t.text.trim()))
    .sort((a, b) => Number(areaOf(b)) - Number(areaOf(a)))
  const areas = named.length
    ? named
    : bare.slice(0, 1).map((t) => ({ text: t.text.trim(), m2: Number(areaOf(t)) }))
  const dimensionLines = new Set(dimensions.flatMap((d) => (d.line ? [d.line] : [])))
  const wallLines = lines.filter((l) => !dimensionLines.has(l))
  const index = buildIndex(wallLines)
  const notes: string[] = []
  const pending: string[] = []

  // Labels: texts that are not dimensions, with the box they sit in.
  const pageArea = content.width * content.height
  const label = (within: Box | null) =>
    content.texts
      .filter((t) => dimensionMm(t.text) === null && t.text.trim().length >= 2)
      .map((text) => {
        // Product tags and notes ("X5", "go3s 黑") are not props: no box search for them.
        const match = matchCatalog(text.text, catalog, undefined, siStyle)
        const relevant =
          sizeInLabel(text.text) !== null ||
          match.function !== 'other' ||
          OBSTACLE_WORDS.some(([re]) => re.test(text.text))
        return {
          text,
          box: relevant
            ? (boxAround(centre(text), boxes, within, text.w * text.h * 1.5) ??
              boxFromLines(text, wallLines, index, within, pageArea))
            : null,
          sizeM: sizeInLabel(text.text),
          // The one size the catalogue has for this name (null when several sizes exist).
          knownM: match.asset ? Math.max(match.asset.footprint.w, match.asset.footprint.d) : null,
        }
      })
  // Prop labels sitting in a box anchor the boundary; boxes are looked up again once it is known.
  const anchors = label(null).flatMap((l) =>
    l.box && matchCatalog(l.text.text, catalog, undefined, siStyle).function !== 'other'
      ? [l.box]
      : [],
  )
  const boundary = findBoundary(content, wallLines, anchors)
  if (boundary) {
    notes.push(
      `边界取${anchors.length ? '包含道具的最小' : '图中最大的'}闭合矩形（${Math.round(boundary.w)} × ${Math.round(boundary.h)} px）；异形门店请在校对时调整`,
    )
  }
  const labelled = label(boundary)

  const { scale, notes: scaleNotes } = findScale(
    dimensions,
    areas,
    boundary,
    request.calibration,
    labelled,
  )
  notes.push(...scaleNotes)
  if (!scale) {
    return { space: null, items: [], scale: null, pending, confidence: 0, notes }
  }
  const toM = (px: number, axis: 0 | 1) =>
    roundM(((px - scale.originPx[axis]) * scale.mmPerPixel) / 1000)
  const lenM = (px: number) => roundM((px * scale.mmPerPixel) / 1000)

  const items: DraftItem[] = []
  const obstacles: Obstacle[] = []
  const entrances: NonNullable<RecognitionDraft['space']>['entrances'] = []
  const usedBoxes = new Set<string>()
  let ref = 0

  for (const { text, box } of labelled) {
    const label = text.text.trim()
    const obstacleKind = OBSTACLE_WORDS.find(([re]) => re.test(label))?.[1]
    if (obstacleKind && box && boundary && contains(boundary, centre(box))) {
      obstacles.push({
        kind: obstacleKind,
        polygon: [
          [toM(box.x, 0), toM(box.y, 1)],
          [toM(box.x + box.w, 0), toM(box.y, 1)],
          [toM(box.x + box.w, 0), toM(box.y + box.h, 1)],
          [toM(box.x, 0), toM(box.y + box.h, 1)],
        ],
        height: null,
        label,
      })
      usedBoxes.add(boxKey(box))
      continue
    }
    if (/入口|人流通道/.test(label)) continue
    // A second label in a box already placed ("收银" inside the 收银台) adds nothing.
    if (box && usedBoxes.has(boxKey(box))) continue

    const drawn = box ? { w: lenM(box.w), d: lenM(box.h) } : undefined
    const match = matchCatalog(label, catalog, drawn, siStyle)
    if (match.function === 'other' && !match.asset) continue
    const count = countInLabel(label)
    const red = isRed(text.color) || (box ? isRed(box.color) : false)
    // Red boxes without their own text belong to the nearest red label (e.g. "边桌配件柜*2").
    const ownBoxes: Box[] = box ? [box] : []
    if (count > 1 || !box) {
      const [tx, ty] = centre(text)
      const reach = Math.max(content.width, content.height) * 0.15
      const nearby = boxes
        .filter(
          (b) =>
            !usedBoxes.has(boxKey(b)) &&
            !(box && sameBox(b, box)) &&
            isRed(b.color) &&
            !labelled.some((l) => l.box && sameBox(l.box, b)),
        )
        .map((b) => ({ b, dist: Math.hypot(centre(b)[0] - tx, centre(b)[1] - ty) }))
        .filter((e) => e.dist < reach)
        .sort((p, q) => p.dist - q.dist)
        .slice(0, Math.max(0, count - ownBoxes.length))
      ownBoxes.push(...nearby.map((e) => e.b))
    }
    const place = (b: Box | null, index: number): DraftItem => {
      const footprint = match.asset?.footprint
      const w = b ? lenM(b.w) : (footprint?.w ?? 1)
      const d = b ? lenM(b.h) : (footprint?.d ?? 1)
      const [px, py] = b ? centre(b) : centre(text)
      // A box longer the other way than the model turns the model by 90°.
      const rotation = footprint && b && b.w >= b.h !== footprint.w >= footprint.d ? 90 : 0
      const source = red
        ? 'requested'
        : boundary && !contains(boundary, [px, py])
          ? 'outside'
          : 'existing'
      return {
        ref: `r${++ref}`,
        label: count > 1 ? `${label}（第 ${index + 1} 件）` : label,
        assetId: match.asset?.id ?? null,
        function: match.function,
        source,
        cx: toM(px, 0),
        cz: toM(py, 1),
        w: footprint ? (rotation ? footprint.d : footprint.w) : w,
        d: footprint ? (rotation ? footprint.w : footprint.d) : d,
        rotation,
        confidence: Math.min(match.confidence, b ? 0.95 : 0.55),
        note:
          [match.note, b ? null : '图上没有对应的图框，位置按文字中心']
            .filter(Boolean)
            .join('；') || null,
      }
    }
    if (ownBoxes.length) {
      ownBoxes.forEach((b, position) => {
        usedBoxes.add(boxKey(b))
        items.push(place(b, position))
      })
      if (count > ownBoxes.length) {
        pending.push(
          `「${label}」标注 ${count} 件，图上只找到 ${ownBoxes.length} 个图框，请补充其余的`,
        )
      }
    } else {
      items.push(place(null, 0))
    }
  }

  let space: RecognitionDraft['space'] = null
  if (boundary) {
    const b = boundary
    const polygon: [number, number][] = [
      [toM(b.x, 0), toM(b.y, 1)],
      [toM(b.x + b.w, 0), toM(b.y, 1)],
      [toM(b.x + b.w, 0), toM(b.y + b.h, 1)],
      [toM(b.x, 0), toM(b.y + b.h, 1)],
    ]
    const entranceText =
      content.texts.find((t) => /主入口|主人流通道/.test(t.text)) ??
      content.texts.find((t) => /入口|人流通道/.test(t.text))
    if (entranceText) {
      const [tx, ty] = centre(entranceText)
      const sides: { a: Point; b: Point; dist: number }[] = polygon.map((p, i) => {
        const q = polygon[(i + 1) % polygon.length] ?? p
        const px = [toM(tx, 0), toM(ty, 1)] as const
        const horizontal = p[1] === q[1]
        const dist = horizontal ? Math.abs(px[1] - p[1]) : Math.abs(px[0] - p[0])
        return { a: p, b: q, dist }
      })
      const side = sides.sort((p, q) => p.dist - q.dist)[0]
      if (side) {
        const horizontal = side.a[1] === side.b[1]
        const along = horizontal ? toM(tx, 0) : toM(ty, 1)
        const lo = Math.min(horizontal ? side.a[0] : side.a[1], horizontal ? side.b[0] : side.b[1])
        const hi = Math.max(horizontal ? side.a[0] : side.a[1], horizontal ? side.b[0] : side.b[1])
        const start = Math.max(
          lo,
          Math.min(hi - DEFAULT_ENTRANCE_M, along - DEFAULT_ENTRANCE_M / 2),
        )
        const end = Math.min(hi, start + DEFAULT_ENTRANCE_M)
        entrances.push(
          horizontal
            ? { a: [roundM(start), side.a[1]], b: [roundM(end), side.a[1]], kind: 'main' }
            : { a: [side.a[0], roundM(start)], b: [side.a[0], roundM(end)], kind: 'main' },
        )
        notes.push(
          `入口按「${entranceText.text.trim()}」文字所靠的边界边放置，宽度默认 ${DEFAULT_ENTRANCE_M} m`,
        )
        pending.push('入口宽度按默认 1.5 m，请核对')
      }
    }
    space = { boundary: polygon, entrances, obstacles, height: null }
  }

  const confidence = boundary ? (scale.verified ? 0.9 : 0.7) : 0.3
  return { space, items, scale, pending, confidence, notes }
}
