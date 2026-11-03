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
import { WALL_REACH_M, countInLabel, matchCatalog, sizeInLabel } from '../check.ts'
import { findBoundary } from './boundary.ts'
import { chainLineTest, chainScale } from './dimension-chain.ts'
import type { ChainReading } from './dimension-chain.ts'
import { inRing, ringArea } from './region.ts'
import { findOutline } from './outline.ts'
import type { PxPoint } from './region.ts'
import {
  ADDED_LATER_WORDS,
  OBSTACLE_WORDS,
  boxAround,
  boxFromLines,
  boxKey,
  boxOfSize,
  fitsSize,
  sameBox,
} from './boxes.ts'
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
  /** Dimension chain spans with their numbers, read from the page picture (raw page pixels). */
  pageChains: readonly ChainReading[] = [],
): RecognitionDraft {
  const content = cropContent(raw, request.crop)
  // The scale is the page's: spans in the crop first, the whole page's when it has too few.
  const crop = request.crop
  const inCrop = crop
    ? pageChains.filter((r) => {
        const mid = (r.a + r.b) / 2
        const [x, y] = r.horizontal ? [mid, r.at] : [r.at, mid]
        return x >= crop.x && x <= crop.x + crop.w && y >= crop.y && y <= crop.y + crop.h
      })
    : pageChains
  const chains = inCrop.length >= 2 ? inCrop : pageChains
  const chain = chainScale(chains)
  const chainMmPerPixel = chain && chain.used.length >= 2 ? chain.mmPerPixel : null
  // The read chains' own lines are left out of the outline. Boxes keep them (props are often
  // dimensioned along their own sides), but a box between two chain lines is no prop.
  const onChain = chainLineTest(inCrop, crop ?? undefined)
  const drawn = content.lines.filter((l) => !onChain(l))
  const betweenChains = (b: Box) => {
    const side = (x1: number, y1: number, x2: number, y2: number) => onChain({ x1, y1, x2, y2 })
    const right = b.x + b.w
    const bottom = b.y + b.h
    return (
      (side(b.x, b.y, right, b.y) && side(b.x, bottom, right, bottom)) ||
      (side(b.x, b.y, b.x, bottom) && side(right, b.y, right, bottom))
    )
  }
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
  const propBox = (text: Text, within: Box | null) => {
    const found =
      boxAround(centre(text), boxes, within, text.w * text.h * 1.5) ??
      boxFromLines(text, wallLines, index, within, pageArea)
    const box = found && !betweenChains(found) ? found : null
    // With the chains' scale known before the boundary, a name written beside its prop finds
    // the prop by the model's size here already, so it can anchor the boundary.
    const footprint = chainMmPerPixel
      ? matchCatalog(text.text, catalog, undefined, siStyle).asset?.footprint
      : undefined
    if (!footprint || !chainMmPerPixel) return box
    const w = (footprint.w * 1000) / chainMmPerPixel
    const d = (footprint.d * 1000) / chainMmPerPixel
    if (box && fitsSize(box, w, d)) return box
    const sized = boxOfSize(text, wallLines, index, w, d, Math.max(w, d) * 1.2 + text.h * 2, (b) =>
      within ? !contains(within, centre(b)) : false,
    )
    return sized ?? box
  }
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
          box: relevant ? propBox(text, within) : null,
          sizeM: sizeInLabel(text.text),
          // The one size the catalogue has for this name (null when several sizes exist).
          knownM: match.asset ? Math.max(match.asset.footprint.w, match.asset.footprint.d) : null,
        }
      })
  // Prop labels sitting in a box anchor the boundary; boxes are looked up again once it is known.
  const unbounded = label(null)
  const anchors = unbounded.flatMap((l) =>
    l.box && matchCatalog(l.text.text, catalog, undefined, siStyle).function !== 'other'
      ? [l.box]
      : [],
  )
  // The stated shop area in px², by a cross-checked scale read without the boundary (dimension
  // lines, sized prop names): it tells the shop from a room inside it or the frame around it.
  const shopM2 = Math.max(
    0,
    ...named.filter((a) => /店|铺|总面积/.test(a.text) && a.m2 >= 5).map((a) => a.m2),
  )
  const early = shopM2
    ? findScale(dimensions, [], null, request.calibration, unbounded, undefined, chains).scale
    : null
  const expectedArea = early?.verified ? (shopM2 * 1e6) / early.mmPerPixel ** 2 : null
  // Pixels per metre, from the dimension chains or roughly from the sized prop names: to tell a
  // wall body from a cabinet.
  const perMetre = unbounded.flatMap((l) => {
    const m = l.sizeM ?? l.knownM
    return l.box && m ? [Math.max(l.box.w, l.box.h) / m] : []
  })
  perMetre.sort((a, b) => a - b)
  const pxPerM = chainMmPerPixel
    ? 1000 / chainMmPerPixel
    : perMetre.length
      ? (perMetre[Math.floor(perMetre.length / 2)] ?? null)
      : null
  // Any outline first: the closed region of the drawing that holds the props (corners, slanted
  // walls, arcs); a rectangle of drawn sides when no region closes round them.
  const titleBlockPoints = content.texts
    .filter((t) =>
      /^(?:client|project|scale|drawing (?:title|number)|drawn by|checked by)\b/i.test(
        t.text.trim(),
      ),
    )
    .map((t): PxPoint => centre(t))
  const hints = {
    expectedArea,
    thinPx: pxPerM ? pxPerM * 0.25 : null,
    pxPerM,
    avoid: titleBlockPoints,
  }
  const selected = findOutline(content.width, content.height, drawn, anchors, hints)
  const region = selected?.points ?? null
  const rectangle = region
    ? null
    : findBoundary(content, wallLines, anchors, { pageEdges: !request.crop, expectedArea })
  const boundary: Box | null = region
    ? (() => {
        const xs = region.map((p) => p[0])
        const ys = region.map((p) => p[1])
        const x = Math.min(...xs)
        const y = Math.min(...ys)
        return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y }
      })()
    : rectangle
  /** The outline in pixels: the region, or the rectangle's corners. */
  const outline: PxPoint[] | null = region
    ? region
    : rectangle
      ? [
          [rectangle.x, rectangle.y],
          [rectangle.x + rectangle.w, rectangle.y],
          [rectangle.x + rectangle.w, rectangle.y + rectangle.h],
          [rectangle.x, rectangle.y + rectangle.h],
        ]
      : null
  const insideOutline = (p: PxPoint) => (outline ? inRing(p, outline) : false)
  if (region) {
    notes.push(
      `边界取${selected?.source === 'lease' ? '红色租赁线候选' : selected?.source === 'stroke' ? '独立线条轮廓' : '图中线段'}中包含道具的闭合区域（${region.length} 个顶点）；请在原图上核对，需要时用“描边界”修正`,
    )
  } else if (rectangle) {
    notes.push(
      `边界取${anchors.length ? '包含道具的最小' : '图中最大的'}闭合矩形（${Math.round(rectangle.w)} × ${Math.round(rectangle.h)} px）；异形门店请用“描边界”调整`,
    )
  }
  const labelled = label(boundary)

  const { scale, notes: scaleNotes } = findScale(
    dimensions,
    areas,
    boundary,
    request.calibration,
    labelled,
    outline ? ringArea(outline) : undefined,
    chains,
  )
  notes.push(...scaleNotes)
  if (!scale) {
    return { space: null, items: [], scale: null, pending, confidence: 0, notes }
  }
  // On the wall: within this of the outline a prop is the shop's (a screen on the wall's face,
  // its centre a little past the traced edge).
  const wallReachPx = (WALL_REACH_M * 1000) / scale.mmPerPixel
  const onOutline = ([x, y]: PxPoint) =>
    outline?.some(([x1, y1], i) => {
      const [x2, y2] = outline[(i + 1) % outline.length] ?? [x1, y1]
      const len2 = (x2 - x1) ** 2 + (y2 - y1) ** 2
      const t = len2
        ? Math.max(0, Math.min(1, ((x - x1) * (x2 - x1) + (y - y1) * (y2 - y1)) / len2))
        : 0
      return Math.hypot(x - x1 - t * (x2 - x1), y - y1 - t * (y2 - y1)) <= wallReachPx
    }) ?? false
  const toM = (px: number, axis: 0 | 1) =>
    roundM(((px - scale.originPx[axis]) * scale.mmPerPixel) / 1000)
  const lenM = (px: number) => roundM((px * scale.mmPerPixel) / 1000)

  const items: DraftItem[] = []
  const obstacles: Obstacle[] = []
  const entrances: NonNullable<RecognitionDraft['space']>['entrances'] = []
  const usedBoxes = new Set<string>()
  let ref = 0

  for (const { text, box: labelBox } of labelled) {
    let box = labelBox
    const label = text.text.trim()
    const obstacleKind = OBSTACLE_WORDS.find(([re]) => re.test(label))?.[1]
    if (obstacleKind && box && boundary && insideOutline(centre(box))) {
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
        ...(ADDED_LATER_WORDS.test(label) ? { addedLater: true } : {}),
      })
      usedBoxes.add(boxKey(box))
      continue
    }
    if (/入口|人流通道/.test(label)) continue
    // A second label in a box already placed ("收银" inside the 收银台) adds nothing.
    if (box && usedBoxes.has(boxKey(box))) continue

    const drawn = box ? { w: lenM(box.w), d: lenM(box.h) } : undefined
    const match = matchCatalog(label, catalog, drawn, siStyle)
    // A prop of known size whose box does not fit (the name written beside it, the box found
    // being the gap round the text; a screen drawn as a strip on the wall): the closed box of
    // its size nearest the name.
    const footprintPx = match.asset
      ? {
          w: (match.asset.footprint.w * 1000) / scale.mmPerPixel,
          d: (match.asset.footprint.d * 1000) / scale.mmPerPixel,
        }
      : null
    if (footprintPx && !(box && fitsSize(box, footprintPx.w, footprintPx.d))) {
      const sized = boxOfSize(
        text,
        wallLines,
        index,
        footprintPx.w,
        footprintPx.d,
        Math.max(footprintPx.w, footprintPx.d) * 1.2 + text.h * 2,
        (b) => usedBoxes.has(boxKey(b)),
      )
      if (sized) box = sized
    }
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
        : boundary && !insideOutline([px, py]) && !onOutline([px, py])
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
  if (boundary && outline) {
    const polygon: [number, number][] = outline.map(([x, y]) => [toM(x, 0), toM(y, 1)])
    const entranceText =
      content.texts.find((t) => /主入口|主人流通道/.test(t.text)) ??
      content.texts.find((t) => /入口|人流通道/.test(t.text))
    if (entranceText) {
      const [tx, ty] = centre(entranceText)
      // The edge nearest the text, any direction; the entrance is centred on the text along it.
      const p: Point = [toM(tx, 0), toM(ty, 1)]
      const sides = polygon.map((a, i) => {
        const b = polygon[(i + 1) % polygon.length] ?? a
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1
        const u: Point = [(b[0] - a[0]) / len, (b[1] - a[1]) / len]
        const t = Math.max(0, Math.min(len, (p[0] - a[0]) * u[0] + (p[1] - a[1]) * u[1]))
        const dist = Math.hypot(p[0] - (a[0] + u[0] * t), p[1] - (a[1] + u[1] * t))
        return { a, u, len, t, dist }
      })
      const side = sides.filter((s) => s.len >= 0.3).sort((q, r) => q.dist - r.dist)[0]
      if (side) {
        const width = Math.min(DEFAULT_ENTRANCE_M, side.len)
        const start = Math.max(0, Math.min(side.len - width, side.t - width / 2))
        const at = (t: number): [number, number] => [
          roundM(side.a[0] + side.u[0] * t),
          roundM(side.a[1] + side.u[1] * t),
        ]
        entrances.push({ a: at(start), b: at(start + width), kind: 'main' })
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
