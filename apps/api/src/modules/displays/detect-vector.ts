import { entranceFrame, entranceSideOf, orderTables, sideEntrance } from '@store/shared'
import type {
  Asset,
  EntranceSide,
  RecognitionDraft,
  SiStyle,
  TaskTable,
  VectorContent,
} from '@store/shared'
import { recognizeVector } from '../recognition/local.ts'

const NOT_DISPLAY = /开箱|收银|储物柜(?!.*托盘)|配件柜|吧台|休息/
const ISLAND = /中岛(桌|台)/
const SIDE = /边桌|边柜/
const clamp01 = (value: number) => Math.min(1, Math.max(0, value))

interface PxBox {
  x: number
  y: number
  w: number
  h: number
}

/**
 * Outlines a 1.8 m table could have on a vector plan: two parallel straight edges about a table
 * long (rounded corners shorten them) a table depth apart. CAD exports draw tables with lines,
 * so this works where the page has no rectangles.
 */
export function tableOutlines(lines: VectorContent['lines'], pxPerM: number): PxBox[] {
  const long = 1.8 * pxPerM
  const [minLen, maxLen] = [0.55 * long, 1.08 * long]
  const [minGap, maxGap] = [0.6 * pxPerM, 1.15 * pxPerM]
  type Seg = { a: number; b: number; at: number }
  const across: Seg[] = []
  const down: Seg[] = []
  for (const l of lines) {
    const dx = Math.abs(l.x2 - l.x1)
    const dy = Math.abs(l.y2 - l.y1)
    if (dy <= 1.5 && dx >= minLen && dx <= maxLen)
      across.push({ a: Math.min(l.x1, l.x2), b: Math.max(l.x1, l.x2), at: (l.y1 + l.y2) / 2 })
    else if (dx <= 1.5 && dy >= minLen && dy <= maxLen)
      down.push({ a: Math.min(l.y1, l.y2), b: Math.max(l.y1, l.y2), at: (l.x1 + l.x2) / 2 })
  }
  const boxes: PxBox[] = []
  const pair = (segs: Seg[], horizontal: boolean) => {
    segs.sort((p, q) => p.at - q.at)
    for (let i = 0; i < segs.length; i++) {
      const p = segs[i]
      if (!p) continue
      for (let j = i + 1; j < segs.length; j++) {
        const q = segs[j]
        if (!q) continue
        const gap = q.at - p.at
        if (gap > maxGap) break
        if (gap < minGap) continue
        const overlap = Math.min(p.b, q.b) - Math.max(p.a, q.a)
        if (overlap < 0.8 * Math.min(p.b - p.a, q.b - q.a)) continue
        if (Math.abs(p.b - p.a - (q.b - q.a)) > 0.15 * long) continue
        const a = Math.min(p.a, q.a)
        const b = Math.max(p.b, q.b)
        boxes.push(
          horizontal ? { x: a, y: p.at, w: b - a, h: gap } : { x: p.at, y: a, w: gap, h: b - a },
        )
      }
    }
  }
  pair(across, true)
  pair(down, false)
  // Double outlines give near copies; keep one of each.
  const kept: PxBox[] = []
  for (const box of boxes.sort((p, q) => q.w * q.h - p.w * p.h)) {
    const [cx, cy] = [box.x + box.w / 2, box.y + box.h / 2]
    if (!kept.some((k) => Math.hypot(k.x + k.w / 2 - cx, k.y + k.h / 2 - cy) < 0.25 * long))
      kept.push(box)
  }
  return kept
}

/**
 * Island tables and side tables with trays on a vector PDF page. Island tables follow their
 * “中岛桌” labels inside the shop: each takes the nearest table outline (its long side gives
 * portrait or landscape), else the recogniser's prop or the label itself with an unknown size.
 * Side tables come from the recogniser. Positions are pixels of the picture.
 */
export function fromVector(
  draft: RecognitionDraft,
  vector: VectorContent,
  picture: { width: number; height: number },
): { tables: TaskTable[]; entrance: EntranceSide | null } {
  const scale = draft.scale
  if (!scale) return { tables: [], entrance: null }
  const k = 1000 / scale.mmPerPixel
  // The recogniser works in the vector content's pixels; the picture may be another size.
  const sx = picture.width / vector.width
  const sy = picture.height / vector.height
  const toVec = (x: number, z: number): [number, number] => [
    scale.originPx[0] + x * k,
    scale.originPx[1] + z * k,
  ]
  const toPx = (x: number, z: number): [number, number] => {
    const [vx, vy] = toVec(x, z)
    return [vx * sx, vy * sy]
  }
  const long = 1.8 * k
  // Labels in a legend or title block lie outside the shop.
  const shop = draft.space
    ? (() => {
        const pts = draft.space.boundary.map(([x, z]) => toVec(x, z))
        const xs = pts.map((p) => p[0])
        const ys = pts.map((p) => p[1])
        const pad = 1.5 * long
        return {
          x0: Math.min(...xs) - pad,
          x1: Math.max(...xs) + pad,
          y0: Math.min(...ys) - pad,
          y1: Math.max(...ys) + pad,
        }
      })()
    : null
  const inShop = ([x, y]: [number, number]) =>
    !shop || (x >= shop.x0 && x <= shop.x1 && y >= shop.y0 && y <= shop.y1)
  const labels = vector.texts
    .filter((t) => ISLAND.test(t.text) && !/大样/.test(t.text) && !NOT_DISPLAY.test(t.text))
    .map((t) => ({ text: t.text, at: [t.x + t.w / 2, t.y + t.h / 2] as [number, number] }))
    .filter((l) => inShop(l.at))
  // An outline whose nearest label names an unboxing table or a cashier is not an island table.
  const others = vector.texts
    .filter((t) => NOT_DISPLAY.test(t.text))
    .map((t) => [t.x + t.w / 2, t.y + t.h / 2] as [number, number])
  const centreOf = (b: PxBox): [number, number] => [b.x + b.w / 2, b.y + b.h / 2]
  const gap = (p: [number, number], q: [number, number]) => Math.hypot(p[0] - q[0], p[1] - q[1])
  const outlines = tableOutlines(vector.lines, k).filter((b) => {
    const c = centreOf(b)
    const island = Math.min(...labels.map((l) => gap(l.at, c)), Infinity)
    const other = Math.min(...others.map((o) => gap(o, c)), Infinity)
    return island <= other
  })
  const nearest = (p: [number, number], b: PxBox) =>
    Math.hypot(Math.max(b.x - p[0], 0, p[0] - b.x - b.w), Math.max(b.y - p[1], 0, p[1] - b.y - b.h))
  // Greedy: the closest label–outline pairs first, each used once.
  const pairs = labels
    .flatMap((l, li) => outlines.map((b, bi) => ({ li, bi, d: nearest(l.at, b) })))
    .filter((p) => p.d <= 1.2 * long)
    .sort((p, q) => p.d - q.d)
  const boxOf = new Map<number, PxBox>()
  const usedBoxes = new Set<number>()
  for (const p of pairs) {
    if (boxOf.has(p.li) || usedBoxes.has(p.bi)) continue
    const box = outlines[p.bi]
    if (!box) continue
    boxOf.set(p.li, box)
    usedBoxes.add(p.bi)
  }
  const recognised = draft.items
    .filter(
      (i) => i.source !== 'outside' && (i.function === 'island_table' || ISLAND.test(i.label)),
    )
    .map((i) => ({ item: i, at: toVec(i.cx, i.cz) }))
  const tables: TaskTable[] = []
  const add = (
    kind: 'island' | 'side',
    at: [number, number],
    size: [number, number] | null,
    label: string,
  ) =>
    tables.push({
      id: `t${tables.length + 1}`,
      kind,
      x: clamp01((at[0] * sx) / picture.width),
      y: clamp01((at[1] * sy) / picture.height),
      w: size ? clamp01((size[0] * sx) / picture.width) : 0,
      h: size ? clamp01((size[1] * sy) / picture.height) : 0,
      render: null,
      label,
    })
  labels.forEach((l, li) => {
    const box = boxOf.get(li)
    if (box) {
      add('island', [box.x + box.w / 2, box.y + box.h / 2], [box.w, box.h], l.text)
      return
    }
    // A second label of a table already found (e.g. “1.8米中岛桌” above, “GO系列” below).
    const taken = [...boxOf.values()].some((b) => gap(l.at, centreOf(b)) <= 1.0 * long)
    if (taken) return
    // No outline: the recogniser's prop for this label, else the label's own place.
    const near = recognised
      .map((r) => ({ ...r, d: Math.hypot(r.at[0] - l.at[0], r.at[1] - l.at[1]) }))
      .filter((r) => r.d <= 0.8 * long)
      .sort((p, q) => p.d - q.d)[0]
    const outlined = near && !/没有对应的图框/.test(near.item.note ?? '')
    add(
      'island',
      near ? near.at : l.at,
      outlined && near ? [near.item.w * k, near.item.d * k] : null,
      l.text,
    )
  })
  for (const item of draft.items) {
    if (item.source === 'outside' || NOT_DISPLAY.test(item.label) || ISLAND.test(item.label))
      continue
    const side =
      item.function === 'side_cabinet' && (SIDE.test(item.label) || /托盘/.test(item.label))
    if (!side) continue
    const outlined = !/没有对应的图框/.test(item.note ?? '')
    add('side', toVec(item.cx, item.cz), outlined ? [item.w * k, item.d * k] : null, item.label)
  }
  let entrance: EntranceSide | null = null
  if (draft.space?.entrances.length) {
    const boundary = draft.space.boundary.map(([x, z]) => toPx(x, z))
    const entrances = draft.space.entrances.map((e) => ({ ...e, a: toPx(...e.a), b: toPx(...e.b) }))
    entrance = entranceSideOf(entranceFrame({ boundary, entrances }))
  } else {
    // “主人流方向 / 主入口” written on the plan: the side of the tables it lies on.
    const flow = vector.texts.find((t) => /主人流|主入口|人流方向|主客流/.test(t.text))
    if (flow && tables.length) {
      const fx =
        (flow.x + flow.w / 2) * sx -
        (tables.reduce((s, t) => s + t.x, 0) / tables.length) * picture.width
      const fy =
        (flow.y + flow.h / 2) * sy -
        (tables.reduce((s, t) => s + t.y, 0) / tables.length) * picture.height
      entrance =
        Math.abs(fy) >= Math.abs(fx) ? (fy > 0 ? 'bottom' : 'top') : fx > 0 ? 'right' : 'left'
    }
  }
  return { tables, entrance }
}

export function detectVectorTables(
  vector: VectorContent,
  picture: { width: number; height: number },
  assets: readonly Asset[],
  si: SiStyle,
  hasRender: boolean,
) {
  const recognition = recognizeVector(vector, {}, assets, si)
  const found = fromVector(recognition, vector, picture)
  const entrance = found.entrance ?? 'bottom'
  const notes = found.tables.length
    ? [
        `本地识别找到中岛桌 ${found.tables.filter((t) => t.kind === 'island').length} 张、边桌 ${found.tables.filter((t) => t.kind === 'side').length} 张`,
      ]
    : [
        recognition.scale
          ? '本地识别没有找到中岛桌，请手动添加或检查所选 PDF 页'
          : '本地识别没有读出比例，无法定位桌子，请检查图纸尺寸标注',
      ]
  if (!found.entrance) notes.push('没有读出主入口方向，暂按“下方”处理，请核对')
  if (hasRender && found.tables.length) notes.push('效果图上的标签先排成一行，请拖到对应的桌子上')
  const tables = found.tables.map((table, i) => ({
    ...table,
    render: hasRender ? { x: (i + 1) / (found.tables.length + 1), y: 0.62 } : null,
  }))
  const byId = new Map(tables.map((table) => [table.id, table]))
  const ordered = orderTables(
    tables.map((t) => ({
      id: t.id,
      kind: t.kind,
      cx: t.x * picture.width,
      cz: t.y * picture.height,
      w: t.w * picture.width,
      d: t.h * picture.height,
    })),
    sideEntrance(
      entrance,
      tables.map((t) => ({ cx: t.x * picture.width, cz: t.y * picture.height })),
    ),
  )
  return {
    tables: ordered.flatMap((t) => {
      const item = byId.get(t.id)
      return item ? [item] : []
    }),
    entrance,
    method: found.tables.length ? 'local' : 'manual',
    notes,
    recognition,
  }
}
