/** Rebuild offline outlines with the fontkit already installed by PDFKit; no new dependency. */
const fs = require('node:fs')
const path = require('node:path')
const { createRequire } = require('node:module')
const { gzipSync } = require('node:zlib')
const root = path.resolve(__dirname, '..')
const api = createRequire(root + '/apps/api/package.json')
const font = createRequire(api.resolve('pdfkit'))('fontkit').openSync(root + '/apps/api/assets/fonts/NotoSansSC-Bold.ttf')
const glyphs = {}, metrics = {}
for (const cp of font.characterSet) {
  if (cp < 32 || cp === 127) continue
  const g = font.glyphForCodePoint(cp)
  if (!g.id) continue
  const b = g.bbox, o = []
  let start
  for (const p of g.path.commands) {
    const a = p.args.map(v => Math.round(v * 10) / 10)
    if (p.command === 'moveTo') { start = a; o.push('m', ...a) }
    else if (p.command === 'lineTo') o.push('l', ...a)
    else if (p.command === 'quadraticCurveTo') o.push('q', a[2], a[3], a[0], a[1])
    else if (p.command === 'bezierCurveTo') o.push('b', a[4], a[5], ...a.slice(0, 4))
    else if (p.command === 'closePath' && start) o.push('l', ...start)
  }
  const ch = String.fromCodePoint(cp)
  glyphs[ch] = { ha: g.advanceWidth, x_min: b.minX || 0, x_max: b.maxX || 0, o: o.join(' ') }
  metrics[ch] = [g.advanceWidth, b.minX || 0, b.minY || 0, b.maxX || 0, b.maxY || 0]
}
const fontData = { glyphs, familyName: 'Noto Sans SC', ascender: font.ascent, descender: font.descent,
  underlinePosition: font.underlinePosition, underlineThickness: font.underlineThickness,
  boundingBox: { xMin: font.bbox.minX, xMax: font.bbox.maxX, yMin: font.bbox.minY, yMax: font.bbox.maxY },
  resolution: font.unitsPerEm, original_font_information: { license: 'SIL Open Font License 1.1; see OFL.txt' },
  cssFontWeight: 'bold', cssFontStyle: 'normal' }
fs.writeFileSync(root + '/apps/web/src/features/viewer3d/fonts/noto-logo.json.gz', gzipSync(JSON.stringify(fontData), { level: 9 }))
fs.writeFileSync(root + '/packages/shared/src/catalog/logo-metrics.json', JSON.stringify(metrics))
let x = 0
const paths = font.layout('LOGO').glyphs.map(g => {
  const svg = `<path transform="translate(${x} 0)" d="${g.path.toSVG()}"/>`
  x += g.advanceWidth
  return svg
})
fs.writeFileSync(root + '/apps/web/src/features/workbench/signage-thumbnails/custom-logo.svg',
  `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="300" viewBox="0 0 480 300"><rect width="480" height="300" fill="white"/><g fill="#333333" transform="translate(55 200) scale(.125 -.125)">${paths.join('')}</g></svg>\n`)
console.log(`已生成 ${Object.keys(glyphs).length} 个离线字形，请格式化 logo-metrics.json。`)
