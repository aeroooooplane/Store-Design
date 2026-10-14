import pptxgenjs from 'pptxgenjs'
import sharp from 'sharp'
import { DISPLAY_ORIENTATION_LABELS, HERO_SLOT, summarizeDisplay } from '@store/shared'
import type { DisplayRules, DisplayTable, Market } from '@store/shared'

// The typings describe a CommonJS module; under NodeNext the ES build's default export is the class.
const PptxGenJS = pptxgenjs as unknown as typeof pptxgenjs.default

/** A picture ready for the deck: a data URI and its pixel size (for fitting without stretching). */
export interface DeckImage {
  data: string
  width: number
  height: number
}

/** A label position on a picture, 0–1 from the top-left corner. */
export interface DeckMark {
  x: number
  y: number
}

export interface DisplayDeckInput {
  /** 影石xxx店 */
  title: string
  date: string
  market: Market
  /** e.g. "SI2.0 · 边厅店"; shown under the overview title. */
  subtitle: string
  rules: DisplayRules
  tables: DisplayTable[]
  plan: DeckImage | null
  /** Table label → position on the plan picture. */
  planMarks: Record<string, DeckMark>
  /** One picture with every table marked, for the overview. */
  overview: { image: DeckImage; marks: Record<string, DeckMark> } | null
  /** Table label → the picture that shows it best, with its mark. */
  tableViews: Record<string, { image: DeckImage; mark: DeckMark } | undefined>
  /** Photo of a slot content (unit id), already chosen for the store's SI style. */
  photos: Record<string, DeckImage | undefined>
  /** Side of the end slot on landscape tables as seen from the entrance. */
  landscapeEnd: 'left' | 'right'
  /** Open points (单店单议, empty slots) listed on the last slide. */
  pending: string[]
}

/** Shrinks a PNG/JPEG for embedding (JPEG, longest side ≤ maxSide) and reads its size. */
export async function deckImage(data: Buffer, maxSide = 1600): Promise<DeckImage> {
  const { data: jpeg, info } = await sharp(data)
    .rotate()
    .resize({ width: maxSide, height: maxSide, fit: 'inside', withoutEnlargement: true })
    .flatten({ background: '#ffffff' })
    .jpeg({ quality: 85 })
    .toBuffer({ resolveWithObject: true })
  return {
    data: `data:image/jpeg;base64,${jpeg.toString('base64')}`,
    width: info.width,
    height: info.height,
  }
}

// 16:9, inches (LAYOUT_WIDE).
const W = 13.333
const H = 7.5
const PANEL = 3.65
const FONT = 'Microsoft YaHei'
const RED = 'E60012'
const INK = '1F2328'
const GREY = 'E9EBEE'
const LINE = '6B7280'
const MUTED = '8A8F98'

interface Box {
  x: number
  y: number
  w: number
  h: number
}

type Slide = pptxgenjs.default.Slide
type Pptx = InstanceType<typeof PptxGenJS>
type TableRow = pptxgenjs.default.TableRow

/** Draws a picture inside a box without stretching; returns where it landed. */
function picture(slide: Slide, image: DeckImage, box: Box): Box {
  const scale = Math.min(box.w / image.width, box.h / image.height)
  const w = image.width * scale
  const h = image.height * scale
  const placed = { x: box.x + (box.w - w) / 2, y: box.y + (box.h - h) / 2, w, h }
  slide.addImage({ data: image.data, ...placed })
  return placed
}

/** Red round label (editable text in an ellipse) centred on a point. */
function marker(slide: Slide, label: string, cx: number, cy: number, size = 0.34) {
  slide.addText(label, {
    shape: 'ellipse',
    x: cx - size / 2,
    y: cy - size / 2,
    w: size,
    h: size,
    fill: { color: RED },
    line: { color: 'FFFFFF', width: 1 },
    color: 'FFFFFF',
    bold: true,
    fontFace: FONT,
    fontSize: size > 0.3 ? 12 : 9,
    align: 'center',
    valign: 'middle',
    margin: 0,
  })
}

function marks(slide: Slide, placed: Box, list: [string, DeckMark | undefined][], size?: number) {
  for (const [label, mark] of list)
    if (mark) marker(slide, label, placed.x + placed.w * mark.x, placed.y + placed.h * mark.y, size)
}

function text(
  slide: Slide,
  value: string,
  box: Box,
  size: number,
  color = INK,
  bold = false,
  align: 'left' | 'center' | 'right' = 'left',
) {
  slide.addText(value, {
    ...box,
    fontFace: FONT,
    fontSize: size,
    color,
    bold,
    align,
    valign: 'middle',
    margin: 0,
  })
}

const brand = (market: Market) => (market === 'domestic' ? '影石 Insta360' : 'Insta360')

function leftPanel(slide: Slide, input: DisplayDeckInput, title: string) {
  slide.addShape('rect', {
    x: 0,
    y: 0,
    w: PANEL,
    h: H,
    fill: { color: '000000' },
    line: { color: '000000', width: 0 },
  })
  text(slide, brand(input.market), { x: 0.35, y: 0.35, w: 3, h: 0.4 }, 13, 'FFFFFF', true)
  text(slide, title, { x: 0.35, y: 1.0, w: 3.1, h: 0.6 }, 24, 'FFFFFF', true)
}

const unitLabel = (rules: DisplayRules, unit: string | null) =>
  unit ? (rules.units.find((u) => u.id === unit)?.label ?? unit) : '待定'

/** Slot rectangles in table units; the table outline is (0, 0)–(width, height). */
function slotGeometry(table: DisplayTable, end: 'left' | 'right') {
  const rects: Record<string, Box> = {}
  if (table.kind === 'side') {
    const portrait = table.orientation === 'portrait'
    const size = { width: portrait ? 1.3 : 3.6, height: portrait ? 3.6 : 1.3 }
    table.slots.forEach((s, i) => {
      rects[s.slot] = portrait
        ? { x: 0.15, y: 0.15 + i * 1.15, w: 1, h: 1 }
        : { x: 0.15 + i * 1.15, y: 0.15, w: 1, h: 1 }
    })
    return { ...size, rects, strip: null as Box | null }
  }
  if (table.orientation === 'portrait') {
    ;['L', 'R'].forEach((side, c) =>
      [1, 2, 3].forEach((n, r) => {
        rects[`${side}${n}`] = { x: c ? 1.6 : 0.15, y: 0.2 + r * 1.45, w: 0.85, h: 1.25 }
      }),
    )
    rects.E = { x: 0.75, y: 4.55, w: 1.1, h: 0.7 }
    return { width: 2.6, height: 5.4, rects, strip: { x: 1.07, y: 0.2, w: 0.46, h: 4.15 } }
  }
  const width = 6.4
  const flip = (b: Box): Box => (end === 'left' ? b : { ...b, x: width - b.x - b.w })
  ;['T', 'B'].forEach((row, r) =>
    [1, 2, 3].forEach((n, c) => {
      rects[`${row}${n}`] = flip({ x: 1.25 + c * 1.7, y: r ? 1.6 : 0.15, w: 1.5, h: 0.85 })
    }),
  )
  rects.E = flip({ x: 0.15, y: 0.85, w: 0.9, h: 0.9 })
  return { width, height: 2.6, rects, strip: flip({ x: 1.25, y: 1.1, w: 4.9, h: 0.4 }) }
}

/**
 * The slot diagram of one table drawn with native shapes, fitted into a box: outline, slots with
 * the product names (hero slot in red), the accessory-module strip. Returns slot boxes in inches.
 */
function tableDiagram(
  slide: Slide,
  table: DisplayTable,
  rules: DisplayRules,
  box: Box,
  end: 'left' | 'right',
  font: number,
) {
  const g = slotGeometry(table, end)
  const scale = Math.min(box.w / g.width, box.h / g.height)
  const ox = box.x + (box.w - g.width * scale) / 2
  const oy = box.y + (box.h - g.height * scale) / 2
  const at = (b: Box): Box => ({
    x: ox + b.x * scale,
    y: oy + b.y * scale,
    w: b.w * scale,
    h: b.h * scale,
  })
  const outline = { x: ox, y: oy, w: g.width * scale, h: g.height * scale }
  slide.addShape('roundRect', {
    ...outline,
    rectRadius: 0.08,
    fill: { color: GREY },
    line: { color: '5B7DBA', width: 1 },
  })
  if (g.strip && table.modules.length) {
    const strip = at(g.strip)
    const vertical = strip.h > strip.w
    const n = table.modules.length
    table.modules.forEach((m, i) => {
      const cell = vertical
        ? { x: strip.x, y: strip.y + (strip.h / n) * i, w: strip.w, h: strip.h / n }
        : { x: strip.x + (strip.w / n) * i, y: strip.y, w: strip.w / n, h: strip.h }
      slide.addText(`${m}`, {
        ...cell,
        shape: 'rect',
        fill: { color: 'FFFFFF' },
        line: { color: LINE, width: 0.5 },
        fontFace: FONT,
        fontSize: Math.max(6, font - 2),
        color: MUTED,
        align: 'center',
        valign: 'middle',
        margin: 0,
      })
    })
  }
  const placed: Record<string, Box> = {}
  for (const s of table.slots) {
    const rect = g.rects[s.slot]
    if (!rect) continue
    const b = at(rect)
    placed[s.slot] = b
    slide.addText(unitLabel(rules, s.unit), {
      ...b,
      shape: 'roundRect',
      rectRadius: 0.06,
      fill: { color: 'FFFFFF' },
      line: { color: s.hero ? RED : '5B7DBA', width: s.hero ? 2 : 1 },
      color: s.unit ? (s.hero ? RED : INK) : MUTED,
      bold: s.hero,
      fontFace: FONT,
      fontSize: font,
      align: 'center',
      valign: 'middle',
      margin: 1,
    })
  }
  return { outline, slots: placed }
}

function flowArrow(slide: Slide, box: Box) {
  const y = box.y + box.h / 2
  slide.addShape('line', {
    x: box.x,
    y,
    w: box.w,
    h: 0,
    line: {
      color: 'F08A24',
      width: 1.5,
      dashType: 'sysDot',
      beginArrowType: 'triangle',
      endArrowType: 'triangle',
    },
  })
  slide.addText('主人流方向', {
    x: box.x + box.w / 2 - 0.75,
    y: y - 0.18,
    w: 1.5,
    h: 0.36,
    fill: { color: 'FFFFFF' },
    fontFace: FONT,
    fontSize: 12,
    bold: true,
    color: INK,
    align: 'center',
    valign: 'middle',
    margin: 0,
  })
}

/** Dashed photo frame with the slot's tray photo, joined to the slot by a dashed line. */
function photoFrame(
  slide: Slide,
  image: DeckImage | undefined,
  frame: Box,
  from: { x: number; y: number },
  to: { x: number; y: number },
) {
  slide.addShape('roundRect', {
    ...frame,
    rectRadius: 0.08,
    fill: { color: 'FFFFFF' },
    line: { color: '9AA0A6', width: 1, dashType: 'dash' },
  })
  const inner = { x: frame.x + 0.08, y: frame.y + 0.08, w: frame.w - 0.16, h: frame.h - 0.16 }
  if (image) picture(slide, image, inner)
  else text(slide, '暂无照片', inner, 10, MUTED, false, 'center')
  const w = to.x - from.x
  const h = to.y - from.y
  slide.addShape('line', {
    x: Math.min(from.x, to.x),
    y: Math.min(from.y, to.y),
    w: Math.abs(w),
    h: Math.abs(h),
    flipH: w < 0 !== h < 0 && h !== 0 && w !== 0,
    line: { color: '9AA0A6', width: 1, dashType: 'dash' },
  })
}

function tableTitle(t: DisplayTable) {
  return t.kind === 'side'
    ? `边桌（${DISPLAY_ORIENTATION_LABELS[t.orientation]}）`
    : `${t.seat ?? '加桌'} 中岛桌（${DISPLAY_ORIENTATION_LABELS[t.orientation]}）`
}

function coverSlide(pptx: Pptx, input: DisplayDeckInput) {
  const slide = pptx.addSlide()
  slide.background = { color: '000000' }
  text(slide, brand(input.market), { x: 0.7, y: 0.7, w: 5, h: 0.6 }, 22, 'FFFFFF', true)
  text(slide, input.title, { x: 0.7, y: 2.7, w: 11.5, h: 1.1 }, 44, 'FFFFFF', true)
  text(slide, '中岛桌展陈方案', { x: 0.7, y: 3.85, w: 8, h: 0.7 }, 28, 'BFC3C9', true)
  text(slide, input.date, { x: 0.7, y: 6.6, w: 4, h: 0.4 }, 14, 'FFFFFF')
}

function overviewSlide(pptx: Pptx, input: DisplayDeckInput) {
  const slide = pptx.addSlide()
  leftPanel(slide, input, '平面布局图总览')
  text(slide, input.subtitle, { x: 0.35, y: 1.65, w: 3.1, h: 0.35 }, 11, 'BFC3C9')
  input.tables.forEach((t, i) => marker(slide, t.label, 0.55 + i * 0.45, 2.35, 0.32))
  if (input.overview) {
    const placed = picture(slide, input.overview.image, { x: 0.2, y: 2.85, w: PANEL - 0.4, h: 3.0 })
    marks(
      slide,
      placed,
      input.tables.map((t) => [t.label, input.overview?.marks[t.label]]),
      0.3,
    )
  }
  const right = { x: PANEL + 0.3, w: W - PANEL - 0.55 }
  if (input.plan) {
    const placed = picture(slide, input.plan, { x: right.x, y: 0.3, w: right.w, h: 4.3 })
    marks(
      slide,
      placed,
      input.tables.map((t) => [t.label, input.planMarks[t.label]]),
    )
  }
  const n = Math.max(input.tables.length, 1)
  const cell = right.w / n
  input.tables.forEach((t, i) => {
    const box = { x: right.x + cell * i + 0.08, y: 4.8, w: cell - 0.16, h: 2.2 }
    const { outline } = tableDiagram(
      slide,
      t,
      input.rules,
      box,
      input.landscapeEnd,
      n > 4 ? 5 : 5.5,
    )
    const captionY = Math.min(outline.y + outline.h + 0.06, 7.1)
    text(
      slide,
      `${t.label}\u3000${tableTitle(t)}`,
      { x: box.x, y: captionY, w: box.w, h: 0.3 },
      10,
      INK,
      true,
      'center',
    )
  })
}

function tableSlide(pptx: Pptx, input: DisplayDeckInput, t: DisplayTable) {
  const slide = pptx.addSlide()
  leftPanel(slide, input, '平面布局图')
  slide.addText(`${t.label}桌`, {
    shape: 'roundRect',
    rectRadius: 0.2,
    x: 0.35,
    y: 1.7,
    w: 1.1,
    h: 0.5,
    fill: { color: RED },
    color: 'FFFFFF',
    bold: true,
    fontFace: FONT,
    fontSize: 18,
    align: 'center',
    valign: 'middle',
    margin: 0,
  })
  text(slide, tableTitle(t), { x: 1.6, y: 1.7, w: 2, h: 0.5 }, 11, 'BFC3C9')
  const view = input.tableViews[t.label]
  if (view)
    marks(
      slide,
      picture(slide, view.image, { x: 0.2, y: 2.45, w: PANEL - 0.4, h: 2.3 }),
      [[t.label, view.mark]],
      0.3,
    )
  if (input.plan)
    marks(
      slide,
      picture(slide, input.plan, { x: 0.2, y: 4.95, w: PANEL - 0.4, h: 2.35 }),
      [[t.label, input.planMarks[t.label]]],
      0.3,
    )

  const area = { x: PANEL + 0.3, y: 0.3, w: W - PANEL - 0.55, h: 6.9 }
  const cx = area.x + area.w / 2
  const photo = (unit: string | null) => (unit ? input.photos[unit] : undefined)
  const portrait = t.orientation === 'portrait'
  if (t.kind === 'island' && portrait) {
    const d = tableDiagram(
      slide,
      t,
      input.rules,
      { x: cx - 1.4, y: 0.35, w: 2.8, h: 5.75 },
      input.landscapeEnd,
      12,
    )
    const fw = 2.35
    for (const s of t.slots) {
      const b = d.slots[s.slot]
      if (!b) continue
      const leftSide = s.slot.startsWith('L')
      const fh = Math.min(1.35, b.h + 0.1)
      const frame = {
        x: leftSide ? d.outline.x - 0.35 - fw : d.outline.x + d.outline.w + 0.35,
        y: b.y + b.h / 2 - fh / 2,
        w: fw,
        h: fh,
      }
      const from = { x: leftSide ? b.x : b.x + b.w, y: b.y + b.h / 2 }
      const to = { x: leftSide ? frame.x + frame.w : frame.x, y: from.y }
      photoFrame(slide, photo(s.unit), frame, from, to)
    }
    flowArrow(slide, { x: area.x + 1.2, y: 6.55, w: area.w - 2.4, h: 0.4 })
  } else if (t.kind === 'island') {
    const endLeft = input.landscapeEnd === 'left'
    const tw = 6.0
    const tx = endLeft ? area.x + area.w - tw - 0.2 : area.x + 0.2
    const d = tableDiagram(
      slide,
      t,
      input.rules,
      { x: tx, y: 2.55, w: tw, h: 2.45 },
      input.landscapeEnd,
      12,
    )
    for (const s of t.slots) {
      const b = d.slots[s.slot]
      if (!b) continue
      if (s.slot === HERO_SLOT.portrait) {
        // End slot: photo on the open side of the table.
        const fw = 1.75
        const frame = {
          x: endLeft ? d.outline.x - 0.3 - fw : d.outline.x + d.outline.w + 0.3,
          y: b.y + b.h / 2 - 0.65,
          w: fw,
          h: 1.3,
        }
        const from = { x: endLeft ? b.x : b.x + b.w, y: b.y + b.h / 2 }
        photoFrame(slide, photo(s.unit), frame, from, {
          x: endLeft ? frame.x + fw : frame.x,
          y: from.y,
        })
        continue
      }
      const top = s.slot.startsWith('T')
      const frame = { x: b.x + b.w / 2 - 0.75, y: top ? 0.45 : 5.2, w: 1.5, h: 1.65 }
      const from = { x: b.x + b.w / 2, y: top ? b.y : b.y + b.h }
      photoFrame(slide, photo(s.unit), frame, from, {
        x: from.x,
        y: top ? frame.y + frame.h : frame.y,
      })
    }
    flowArrow(slide, { x: area.x + 1.2, y: 7.08, w: area.w - 2.4, h: 0.3 })
  } else {
    const d = tableDiagram(
      slide,
      t,
      input.rules,
      portrait ? { x: cx - 0.75, y: 0.6, w: 1.5, h: 5.6 } : { x: cx - 2.6, y: 2.8, w: 5.2, h: 1.9 },
      input.landscapeEnd,
      12,
    )
    for (const s of t.slots) {
      const b = d.slots[s.slot]
      if (!b) continue
      const frame = portrait
        ? { x: d.outline.x + d.outline.w + 0.45, y: b.y + 0.02, w: 2.6, h: b.h - 0.04 }
        : { x: b.x + b.w / 2 - 0.85, y: 0.6, w: 1.7, h: 1.9 }
      const from = portrait ? { x: b.x + b.w, y: b.y + b.h / 2 } : { x: b.x + b.w / 2, y: b.y }
      const to = portrait ? { x: frame.x, y: from.y } : { x: from.x, y: frame.y + frame.h }
      photoFrame(slide, photo(s.unit), frame, from, to)
    }
    flowArrow(slide, { x: area.x + 1.2, y: 6.6, w: area.w - 2.4, h: 0.4 })
  }
  if (t.notes.length)
    text(slide, t.notes.join('；'), { x: area.x, y: 0.05, w: area.w, h: 0.28 }, 10, RED)
}

function quantitySlide(pptx: Pptx, input: DisplayDeckInput) {
  const slide = pptx.addSlide()
  text(slide, '产品与托盘数量明细', { x: 0.5, y: 0.3, w: 8, h: 0.6 }, 24, INK, true)
  text(slide, `${input.title} · ${input.subtitle}`, { x: 0.5, y: 0.85, w: 10, h: 0.35 }, 11, MUTED)
  const summary = summarizeDisplay(input.rules, input.tables)
  const head = (labels: string[]) =>
    labels.map((l) => ({ text: l, options: { bold: true, fill: { color: 'D9DCE1' } } }))
  const productRows: TableRow[] = [head(['类目', '型号', '数量'])]
  for (const category of [...new Set(summary.products.map((p) => p.category ?? ''))]) {
    const rows = summary.products.filter((p) => (p.category ?? '') === category)
    rows.forEach((p, i) =>
      productRows.push([
        ...(i === 0
          ? [{ text: category, options: { rowspan: rows.length, valign: 'middle' as const } }]
          : []),
        { text: p.name },
        { text: String(p.count), options: { align: 'center' as const } },
      ]),
    )
  }
  productRows.push([
    { text: '合计', options: { colspan: 2, bold: true } },
    { text: String(summary.productTotal), options: { bold: true, align: 'center' } },
  ])
  const trayRows: TableRow[] = [head(['托盘种类', '托盘位数量'])]
  for (const t of summary.trays)
    trayRows.push([{ text: t.name }, { text: String(t.count), options: { align: 'center' } }])
  trayRows.push([
    { text: '合计', options: { bold: true } },
    { text: String(summary.trayTotal), options: { bold: true, align: 'center' } },
  ])
  const style = {
    fontFace: FONT,
    fontSize: 9.5,
    color: INK,
    border: { type: 'solid' as const, pt: 0.75, color: '9AA0A6' },
    rowH: 0.27,
    valign: 'middle' as const,
    margin: [1, 4, 1, 4] as [number, number, number, number],
  }
  slide.addText('产品数量明细（运营用）', {
    x: 0.5,
    y: 1.3,
    w: 5.6,
    h: 0.35,
    fontFace: FONT,
    fontSize: 13,
    bold: true,
    color: INK,
  })
  slide.addTable(productRows, { ...style, x: 0.5, y: 1.7, w: 5.6, colW: [1.2, 3.4, 1.0] })
  slide.addText('托盘数量明细（供应商用）', {
    x: 6.4,
    y: 1.3,
    w: 3.7,
    h: 0.35,
    fontFace: FONT,
    fontSize: 13,
    bold: true,
    color: INK,
  })
  slide.addTable(trayRows, { ...style, x: 6.4, y: 1.7, w: 3.7, colW: [2.7, 1.0] })

  const islands = input.tables.filter((t) => t.kind === 'island').length
  const links = summary.products
    .filter((p) => /link/i.test(p.name))
    .reduce((s, p) => s + p.count, 0)
  const lines = [
    `iPad：${islands + 1} 台（中岛桌数 + 1；如有 AG 配件柜再加 1）`,
    `笔记本：${links} 台（与 Link 数量相同）`,
    // The iPad rule is already worked out above.
    ...input.rules.notes.filter((n) => !/^iPad/i.test(n.text)).map((n) => n.text),
    ...input.pending.map((p) => `待确认：${p}`),
  ]
  slide.addText('说明', {
    x: 10.35,
    y: 1.3,
    w: 2.6,
    h: 0.35,
    fontFace: FONT,
    fontSize: 13,
    bold: true,
    color: INK,
  })
  slide.addText(
    lines.map((l) => ({ text: l, options: { bullet: true, breakLine: true } })),
    {
      x: 10.35,
      y: 1.7,
      w: 2.6,
      h: 5.4,
      fontFace: FONT,
      fontSize: 10,
      color: INK,
      valign: 'top',
      paraSpaceAfter: 4,
    },
  )
}

/**
 * The editable display-plan PPT (16:9): cover, plan overview with every table labelled, one
 * slide per island table and per side table (slot diagram, tray photos, the table marked on the
 * render and the plan), and the product and tray counts. Everything except pictures is native
 * text, shapes and tables so that the store team can edit it.
 */
export async function buildDisplayDeck(input: DisplayDeckInput): Promise<Buffer> {
  const pptx = new PptxGenJS()
  pptx.layout = 'LAYOUT_WIDE'
  pptx.author = '影石Insta360 门店空间设计'
  pptx.title = `${input.title}中岛桌展陈方案`
  pptx.theme = { headFontFace: FONT, bodyFontFace: FONT }
  coverSlide(pptx, input)
  overviewSlide(pptx, input)
  for (const t of input.tables) tableSlide(pptx, input, t)
  quantitySlide(pptx, input)
  return (await pptx.write({ outputType: 'nodebuffer' })) as Buffer
}
