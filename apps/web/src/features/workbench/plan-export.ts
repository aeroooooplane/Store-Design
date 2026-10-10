/** Computed styles the plan drawing takes from CSS; copied inline so the file stands alone. */
const STYLE_PROPS = [
  'fill',
  'fill-opacity',
  'stroke',
  'stroke-width',
  'stroke-opacity',
  'stroke-dasharray',
  'stroke-linecap',
  'stroke-linejoin',
  'opacity',
  'font-family',
  'font-weight',
  'display',
  'visibility',
] as const

/**
 * A self-contained copy of an on-screen plan: CSS-driven styles inlined, and strokes that do
 * not scale (vector-effect) widened to the output size, so the drawing looks the same at print
 * width as on screen.
 */
export function standaloneSvg(svg: SVGSVGElement, outputWidth: number): string {
  const clone = svg.cloneNode(true) as SVGSVGElement
  const shown = svg.getBoundingClientRect().width || outputWidth
  const scale = outputWidth / shown
  const source = [svg, ...svg.querySelectorAll('*')]
  const target = [clone, ...clone.querySelectorAll('*')]
  source.forEach((element, i) => {
    const copy = target[i]
    if (!copy || !(element instanceof SVGElement)) return
    const computed = getComputedStyle(element)
    const style: string[] = []
    for (const prop of STYLE_PROPS) {
      let value = computed.getPropertyValue(prop)
      if (!value) continue
      if (
        prop === 'stroke-width' &&
        computed.getPropertyValue('vector-effect') === 'non-scaling-stroke'
      ) {
        value = `${parseFloat(value) * scale}px`
      }
      style.push(`${prop}:${value}`)
    }
    if (computed.getPropertyValue('vector-effect') === 'non-scaling-stroke') {
      style.push('vector-effect:non-scaling-stroke')
    }
    copy.setAttribute('style', style.join(';'))
    copy.removeAttribute('class')
  })
  const viewBox = svg.viewBox.baseVal
  const height = Math.round((outputWidth * viewBox.height) / viewBox.width)
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  clone.setAttribute('width', String(outputWidth))
  clone.setAttribute('height', String(height))
  return new XMLSerializer().serializeToString(clone)
}

/** The plan as PNG (base64, white background) plus its standalone SVG, for delivery PDFs. */
export async function exportPlan(
  svg: SVGSVGElement,
  // About 300 dpi for the plan area of an A3 page.
  outputWidth = 4000,
): Promise<{ png: string; svg: string }> {
  const text = standaloneSvg(svg, outputWidth)
  const url = URL.createObjectURL(new Blob([text], { type: 'image/svg+xml' }))
  try {
    const image = new Image()
    image.src = url
    await image.decode()
    const canvas = document.createElement('canvas')
    canvas.width = image.naturalWidth || outputWidth
    canvas.height = image.naturalHeight
    const g = canvas.getContext('2d')
    if (!g) throw new Error('浏览器无法绘制平面图')
    g.fillStyle = '#ffffff'
    g.fillRect(0, 0, canvas.width, canvas.height)
    g.drawImage(image, 0, 0, canvas.width, canvas.height)
    const png = canvas.toDataURL('image/png')
    return { png: png.slice(png.indexOf(',') + 1), svg: text }
  } finally {
    URL.revokeObjectURL(url)
  }
}
