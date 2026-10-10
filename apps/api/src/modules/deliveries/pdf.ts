import path from 'node:path'
import { fileURLToPath } from 'node:url'
import PDFDocument from 'pdfkit'
import type { LegendEntry } from '@store/shared'

/** Bundled CJK font (Noto Sans SC, SIL OFL), cut to GB2312 + symbols; see assets/fonts. */
const FONT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../assets/fonts')
const FONTS = {
  regular: path.join(FONT_DIR, 'NotoSansSC-Regular.ttf'),
  bold: path.join(FONT_DIR, 'NotoSansSC-Bold.ttf'),
}

/** A3 landscape in points; the manuals' plans and renders are landscape. */
const PAGE = { width: 1190.55, height: 841.89, margin: 36 }
const COLOR = {
  ink: '#1f2328',
  muted: '#6b7280',
  line: '#d0d5dd',
  badge: '#ffd200',
  paper: '#f5f6f7',
}
const HEADER_H = 46
const FOOTER_H = 22

export interface DeliveryView {
  no: number
  name: string
  material: Buffer
  white: Buffer
}

export interface DeliveryContent {
  /** 影石xxx店 */
  title: string
  /** e.g. "边厅店 · 国内 · SI1.0" */
  subtitle: string
  date: string
  plan: Buffer
  legend: LegendEntry[]
  /** Facts about the shop (area, size, height, plan name). */
  facts: string[]
  /** Assumptions, compromises and open points (完整版 only). */
  notes: string[]
  views: DeliveryView[]
}

export interface PdfResult {
  data: Buffer
  pages: { kind: string; view?: number }[]
}

const mmText = (m: number) => Math.round(m * 1000)

/**
 * An image decoded and embedded once, then drawn on several pages (overview and full page).
 * pdfkit accepts its opened image wherever a source is expected; the typings lack openImage.
 */
function open(doc: PDFKit.PDFDocument, data: Buffer): Buffer {
  return (doc as unknown as { openImage(src: Buffer): Buffer }).openImage(data)
}

function newDocument(title: string): PDFKit.PDFDocument {
  const doc = new PDFDocument({
    size: [PAGE.width, PAGE.height],
    margin: PAGE.margin,
    autoFirstPage: false,
    bufferPages: true,
    info: { Title: title, Author: '影石Insta360 门店空间设计', Creator: 'store-design' },
  })
  doc.registerFont('regular', FONTS.regular)
  doc.registerFont('bold', FONTS.bold)
  return doc
}

function finish(doc: PDFKit.PDFDocument, footer: string): Promise<Buffer> {
  const range = doc.bufferedPageRange()
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i)
    // The footer sits in the bottom margin; without this pdfkit would start a new page for it.
    doc.page.margins.bottom = 0
    const y = PAGE.height - PAGE.margin + 4
    doc.font('regular').fontSize(8).fillColor(COLOR.muted)
    doc.text(footer, PAGE.margin, y, { lineBreak: false })
    doc.text(`${i + 1} / ${range.count}`, PAGE.width - PAGE.margin - 80, y, {
      width: 80,
      align: 'right',
      lineBreak: false,
    })
  }
  const chunks: Buffer[] = []
  return new Promise((resolve, reject) => {
    doc.on('data', (chunk: Buffer) => chunks.push(chunk))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)
    doc.end()
  })
}

function header(doc: PDFKit.PDFDocument, title: string, right?: string) {
  doc.font('bold').fontSize(18).fillColor(COLOR.ink)
  doc.text(title, PAGE.margin, PAGE.margin - 4, { lineBreak: false })
  if (right) {
    doc.font('regular').fontSize(9).fillColor(COLOR.muted)
    doc.text(right, PAGE.width / 2, PAGE.margin + 4, {
      width: PAGE.width / 2 - PAGE.margin,
      align: 'right',
      lineBreak: false,
    })
  }
  doc
    .moveTo(PAGE.margin, PAGE.margin + HEADER_H - 16)
    .lineTo(PAGE.width - PAGE.margin, PAGE.margin + HEADER_H - 16)
    .lineWidth(0.6)
    .strokeColor(COLOR.line)
    .stroke()
}

/** Body area below the header and above the footer. */
const BODY = {
  x: PAGE.margin,
  y: PAGE.margin + HEADER_H,
  width: PAGE.width - 2 * PAGE.margin,
  height: PAGE.height - 2 * PAGE.margin - HEADER_H - FOOTER_H,
}

/** Yellow numbered badge as on the manuals' plans. */
function badge(doc: PDFKit.PDFDocument, no: number, x: number, y: number, size = 14) {
  doc.roundedRect(x, y, size, size, 3).fill(COLOR.badge)
  doc
    .font('bold')
    .fontSize(size * 0.58)
    .fillColor(COLOR.ink)
  doc.text(String(no).padStart(2, '0'), x, y + size * 0.16, {
    width: size,
    align: 'center',
    lineBreak: false,
  })
}

/** Legend columns (points): size W×D×H in mm, and the count. */
const SIZE_W = 96
const COUNT_W = 26

function legendBlock(
  doc: PDFKit.PDFDocument,
  legend: LegendEntry[],
  x: number,
  y: number,
  width: number,
) {
  doc.font('bold').fontSize(12).fillColor(COLOR.ink).text('图例', x, y, { lineBreak: false })
  let row = y + 22
  const rowH = legend.length > 22 ? 16 : 20
  for (const entry of legend) {
    badge(doc, entry.no, x, row, rowH - 5)
    const size = `${mmText(entry.size.w)}×${mmText(entry.size.d)}×${mmText(entry.size.h)}`
    doc
      .font('regular')
      .fontSize(rowH > 16 ? 9.5 : 8.5)
      .fillColor(COLOR.ink)
    doc.text(`${entry.name}${entry.placeholder ? '（占位）' : ''}`, x + rowH + 2, row + 1, {
      width: width - rowH - 2 - SIZE_W - COUNT_W,
      height: rowH,
      ellipsis: true,
      lineBreak: false,
    })
    doc.fillColor(COLOR.muted)
    doc.text(size, x + width - SIZE_W - COUNT_W, row + 1, {
      width: SIZE_W,
      align: 'right',
      lineBreak: false,
    })
    doc.fillColor(COLOR.ink)
    doc.text(`×${entry.count}`, x + width - COUNT_W, row + 1, {
      width: COUNT_W,
      align: 'right',
      lineBreak: false,
    })
    row += rowH
  }
  return row
}

function textBlock(
  doc: PDFKit.PDFDocument,
  heading: string,
  lines: string[],
  x: number,
  y: number,
  width: number,
) {
  if (!lines.length) return y
  doc.font('bold').fontSize(12).fillColor(COLOR.ink).text(heading, x, y, { lineBreak: false })
  doc.font('regular').fontSize(9).fillColor(COLOR.ink)
  let at = y + 20
  for (const line of lines) {
    doc.text(`· ${line}`, x, at, { width, lineGap: 1.5 })
    at = doc.y + 3
  }
  return at
}

/** The plan with the legend (and, in the full version, facts and notes) beside it. */
function planPage(doc: PDFKit.PDFDocument, content: DeliveryContent, full: boolean) {
  doc.addPage()
  header(
    doc,
    full ? `${content.title} · 平面方案` : content.title,
    full ? `${content.subtitle} · ${content.date}` : undefined,
  )
  const side = 300
  const gap = 24
  const plan = { x: BODY.x, y: BODY.y, width: BODY.width - side - gap, height: BODY.height }
  doc.image(content.plan, plan.x, plan.y, {
    fit: [plan.width, plan.height],
    align: 'center',
    valign: 'center',
  })
  const x = BODY.x + plan.width + gap
  let y = legendBlock(doc, content.legend, x, BODY.y, side)
  if (full) {
    y = textBlock(doc, '概况', content.facts, x, y + 14, side)
    textBlock(doc, '设计说明与校核', content.notes, x, y + 10, side)
  }
}

/** One large picture with its view name; keeps the picture's proportions. */
function viewPage(doc: PDFKit.PDFDocument, image: Buffer, title: string) {
  doc.addPage()
  header(doc, title)
  doc.image(image, BODY.x, BODY.y, {
    fit: [BODY.width, BODY.height],
    align: 'center',
    valign: 'center',
  })
}

/** Contact sheet of every view (效果图总览 or 白模). */
function gridPage(
  doc: PDFKit.PDFDocument,
  title: string,
  views: { no: number; name: string; image: Buffer }[],
  note?: string,
) {
  doc.addPage()
  header(doc, title, note)
  const columns = views.length <= 4 ? 2 : views.length <= 9 ? 3 : 4
  const rows = Math.ceil(views.length / columns)
  const gap = 14
  const captionH = 16
  const cellW = (BODY.width - gap * (columns - 1)) / columns
  const cellH = (BODY.height - gap * (rows - 1)) / rows
  const imageH = Math.min(cellH - captionH, cellW / 1.5)
  const imageW = imageH * 1.5
  views.forEach((view, i) => {
    const col = i % columns
    const row = Math.floor(i / columns)
    const x = BODY.x + col * (cellW + gap) + (cellW - imageW) / 2
    const y = BODY.y + row * (cellH + gap)
    doc.rect(x, y, imageW, imageH).fill(COLOR.paper)
    doc.image(view.image, x, y, { fit: [imageW, imageH], align: 'center', valign: 'center' })
    doc.font('regular').fontSize(9).fillColor(COLOR.ink)
    doc.text(`${String(view.no).padStart(2, '0')} ${view.name}`, x, y + imageH + 3, {
      width: imageW,
      lineBreak: false,
    })
  })
}

const viewTitle = (view: DeliveryView) => `${String(view.no).padStart(2, '0')} ${view.name}`

/**
 * 完整版: plan page with legend, facts and notes; material overview; one page per material view;
 * white-model check sheet (双PDF交付规则).
 */
export async function fullPdf(content: DeliveryContent): Promise<PdfResult> {
  const doc = newDocument(`${content.title}完整方案`)
  const pages: PdfResult['pages'] = []
  const views = content.views.map((v) => ({
    ...v,
    material: open(doc, v.material),
    white: open(doc, v.white),
  }))
  planPage(doc, content, true)
  pages.push({ kind: 'plan' })
  gridPage(
    doc,
    `${content.title} · 效果图总览`,
    views.map((v) => ({ no: v.no, name: v.name, image: v.material })),
  )
  pages.push({ kind: 'overview' })
  for (const view of views) {
    viewPage(doc, view.material, `${content.title} · ${viewTitle(view)}`)
    pages.push({ kind: 'material', view: view.no })
  }
  gridPage(
    doc,
    `${content.title} · 白模与校核`,
    views.map((v) => ({ no: v.no, name: v.name, image: v.white })),
    '白模图与效果图为同一场景、同一相机，只切换材质',
  )
  pages.push({ kind: 'white' })
  return { data: await finish(doc, `${content.title} · 完整方案 · ${content.date}`), pages }
}

/**
 * 展示版: first page only the shop name, the plan and its legend; then one material view per page
 * in its own proportions. No overview, white model or text pages (双PDF交付规则).
 */
export async function showPdf(content: DeliveryContent): Promise<PdfResult> {
  const doc = newDocument(`${content.title}方案`)
  const pages: PdfResult['pages'] = []
  planPage(doc, content, false)
  pages.push({ kind: 'plan' })
  for (const view of content.views) {
    viewPage(doc, view.material, viewTitle(view))
    pages.push({ kind: 'material', view: view.no })
  }
  return { data: await finish(doc, content.title), pages }
}
