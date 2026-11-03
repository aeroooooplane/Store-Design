import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
import { itemCorners } from './pilot-quality.mjs'
import { renderPdf, openPdf } from './pilot-input.mjs'
import { openingPieces } from '../../packages/shared/src/schemas/space.ts'
const req = createRequire(new URL('../../apps/api/package.json', import.meta.url)),
  PDFDocument = req('pdfkit')
export const escape = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  )
export function scene(plan) {
  const { space, layout } = plan,
    shapes = [],
    texts = []
  const poly = (points, stroke, fill, width = 0.025, closed = true) =>
    shapes.push({ points, stroke, fill, width, closed })
  poly(space.boundary, '#202b36', '#fafafa', 0.02)
  for (const o of space.obstacles)
    poly(o.polygon, o.addedLater ? '#c97a16' : '#6b7280', o.addedLater ? '#fff0d4' : '#d4d7da')
  for (const f of layout.fixtures ?? [])
    poly(
      [
        [f.cx - f.w / 2, f.cz - f.d / 2],
        [f.cx + f.w / 2, f.cz - f.d / 2],
        [f.cx + f.w / 2, f.cz + f.d / 2],
        [f.cx - f.w / 2, f.cz + f.d / 2],
      ],
      '#c97a16',
      '#fff0d4',
    )
  for (const e of space.openEdges ?? [])
    for (const p of openingPieces(space, e) ?? [e]) poly([p.a, p.b], '#8b5cf6', 'none', 0.04, false)
  for (const e of space.entrances)
    for (const p of openingPieces(space, e) ?? [e]) poly([p.a, p.b], '#129d6f', 'none', 0.05, false)
  layout.items.forEach((it, i) => {
    poly(itemCorners(it), '#2466aa', '#e4f0ff')
    texts.push({ at: [it.cx, it.cz], value: String(i + 1), color: '#164c88' })
    const r = (it.rotation * Math.PI) / 180
    poly(
      [
        [it.cx, it.cz],
        [it.cx - Math.sin(r) * 0.25, it.cz + Math.cos(r) * 0.25],
      ],
      '#2466aa',
      'none',
      0.02,
      false,
    )
  })
  // 原图辅助符号只表达组合内构件，不增加模型实例或重复计入BOM。
  for (const symbol of plan.sourceSymbols ?? []) poly(symbol.polygon, '#5893ad', 'none', 0.018)
  const points = shapes.flatMap((s) => s.points),
    xs = points.map((p) => p[0]),
    ys = points.map((p) => p[1]),
    span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), 1),
    fontSize = span / 65
  for (const t of texts) t.at[1] -= fontSize * 1.8
  const orientation = Math.sign(
    space.boundary.reduce((sum, p, i) => {
      const q = space.boundary[(i + 1) % space.boundary.length]
      return sum + p[0] * q[1] - q[0] * p[1]
    }, 0),
  )
  space.boundary.forEach((p, i) => {
    const q = space.boundary[(i + 1) % space.boundary.length],
      len = Math.hypot(p[0] - q[0], p[1] - q[1])
    if (len > fontSize * 6)
      texts.push({
        at: [
          (p[0] + q[0]) / 2 + ((orientation * (q[1] - p[1])) / len) * fontSize * 2.5,
          (p[1] + q[1]) / 2 - ((orientation * (q[0] - p[0])) / len) * fontSize * 2.5,
        ],
        value: String(Math.round(len * 1000)),
        color: '#555',
      })
  })
  const margin = span * 0.07
  return {
    shapes,
    texts,
    fontSize,
    bounds: [
      Math.min(...xs) - margin,
      Math.min(...ys) - margin,
      Math.max(...xs) - Math.min(...xs) + 2 * margin,
      Math.max(...ys) - Math.min(...ys) + 2 * margin,
    ],
  }
}
function svgShapes(s, map = (p) => p, widthScale = 1, alpha = 1) {
  return (
    s.shapes
      .map(
        (p) =>
          `<${p.closed ? 'polygon' : 'polyline'} points="${p.points
            .map(map)
            .map((v) => v.join(','))
            .join(
              ' ',
            )}" fill="${p.fill}" fill-opacity="${alpha}" stroke="${p.stroke}" stroke-width="${p.width * widthScale}"/>`,
      )
      .join('') +
    s.texts
      .map((t) => {
        const p = map(t.at)
        return `<text x="${p[0]}" y="${p[1]}" fill="${t.color}" text-anchor="middle" font-size="${s.fontSize * widthScale}">${escape(t.value)}</text>`
      })
      .join('')
  )
}
export function svgPlan(s) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1400" height="1000" viewBox="${s.bounds.join(' ')}"><rect x="${s.bounds[0]}" y="${s.bounds[1]}" width="${s.bounds[2]}" height="${s.bounds[3]}" fill="white"/>${svgShapes(s)}</svg>`
}
export function svgOverlay(s, plan, input) {
  const t = plan.transform,
    k = 1000 / t.mmPerPixel,
    map = ([x, z]) => [t.originPx[0] + x * k, t.originPx[1] + z * k]
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${input.h.render.widthPx}" height="${input.h.render.heightPx}" viewBox="0 0 ${input.h.render.widthPx} ${input.h.render.heightPx}"><image href="data:image/png;base64,${input.files.get('source/preview.png').toString('base64')}" width="100%" height="100%"/>${svgShapes(s, map, k, 0.15)}</svg>`
}
export async function renderPlan(plan, bom, title) {
  const s = scene(plan),
    doc = new PDFDocument({ size: 'A3', layout: 'landscape', margin: 30 }),
    chunks = []
  const done = new Promise((resolve, reject) => {
    doc.on('data', (b) => chunks.push(b))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)
  })
  doc.registerFont(
    'cjk',
    await readFile(new URL('../../apps/api/assets/fonts/NotoSansSC-Regular.ttf', import.meta.url)),
  )
  doc.font('cjk')
  doc.fontSize(17).text(title, 30, 22, { width: 1100 })
  doc
    .fontSize(10)
    .fillColor('#9a5d00')
    .text('校正审核图 · 未经交叉核对及用户抽审 · 单位：毫米 · 图形按JSON生成', 30, 48)
  const [bx, by, bw, bh] = s.bounds,
    k = Math.min(790 / bw, 690 / bh),
    ox = 30 + (790 - bw * k) / 2,
    oy = 95 + (690 - bh * k) / 2
  const point = (p) => [ox + (p[0] - bx) * k, oy + (p[1] - by) * k]
  for (const p of s.shapes) {
    const pts = p.points.map(point)
    doc.moveTo(...pts[0])
    pts.slice(1).forEach((v) => doc.lineTo(...v))
    if (p.closed) doc.closePath()
    doc.lineWidth(p.width * k)
    if (p.fill === 'none') doc.stroke(p.stroke)
    else doc.fillAndStroke(p.fill, p.stroke)
  }
  for (const t of s.texts) {
    const [x, y] = point(t.at)
    doc
      .fontSize(s.fontSize * k)
      .fillColor(t.color)
      .text(t.value, x - 60, y - (s.fontSize * k) / 2, {
        width: 120,
        align: 'center',
        lineBreak: false,
      })
  }
  doc
    .fontSize(10)
    .fillColor('#333')
    .text(
      '绿色：入口  紫色：开放边  灰色：原障碍  橙色：后加构件  蓝短线：模型+Z方向；浅蓝框：组合内构件原图轮廓（不另计资产）',
      30,
      800,
      { lineBreak: false },
    )
  let y = 90,
    x = 850
  doc.fontSize(12).fillColor('#222').text('道具实例与物料', x, y, { width: 300 })
  y += 25
  for (const [i, it] of plan.layout.items.entries()) {
    const line =
      `${i + 1}. ${it.name} / ${it.assetId ?? '型号未知'}\n${Math.round(it.w * 1000)} × ${Math.round(it.d * 1000)} × ${Math.round(it.h * 1000)}  角度 ${it.rotation}°` +
      (() => {
        const a = plan.sourceAnnotations?.items?.[it.id]
        return (
          (a?.bodyHeightMm ? `\n源图桌/柜体高 ${a.bodyHeightMm}；上述H为模型总高` : '') +
          (a?.includedComponents ?? [])
            .map((c) => `\n组合内含${c.count}个${c.label}，不另计资产`)
            .join('')
        )
      })()
    doc.fontSize(9)
    const h = doc.heightOfString(line, { width: 295 }) + 12
    if (y + h > 760) {
      doc.addPage()
      doc
        .font('cjk')
        .fontSize(15)
        .text(title + ' · 物料续页', 30, 25)
      x = 30
      y = 70
    }
    doc.fillColor('#333').text(line, x, y, { width: 295 })
    y += h
  }
  for (const row of bom.rows ?? []) {
    const line = `BOM ${row.label ?? row.id}：${row.quantity}${row.unit}`
    doc.fontSize(9)
    const h = doc.heightOfString(line, { width: 295 }) + 8
    if (y + h > 760) {
      doc.addPage()
      doc.font('cjk')
      x = 30
      y = 45
    }
    doc.text(line, x, y, { width: 295 })
    y += h
  }
  doc.end()
  const pdf = await done,
    parsed = await openPdf(pdf)
  let png
  try {
    png = (await renderPdf(parsed, 1, 1600)).png
  } finally {
    await parsed.destroy()
  }
  return { scene: s, svg: svgPlan(s), pdf, png }
}
