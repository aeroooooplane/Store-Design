import type { PDFDocumentProxy } from 'pdfjs-dist'

/** Words of a PDF page (pdf.js text content), joined without spaces. */
async function pageText(doc: PDFDocumentProxy, n: number): Promise<string> {
  const page = await doc.getPage(n)
  const content = await page.getTextContent()
  return content.items
    .map((item) => ('str' in item ? item.str : ''))
    .join('')
    .replace(/\s+/g, '')
}

const PLAN = /平面布置|FIXTUREFURNISHINGPLAN|家具定位|道具定位/i
const INDEX = /图纸目录|DRAWINGFILENAME|TABLEOFDRAWINGS/i
const RENDER = /效果图|RENDERING/i
/** Other plans of a drawing set that also name the tables. */
const OTHER_PLAN =
  /插座|强电|弱电|照明|配电|天花|地面|地坪|灯具|监控|索引|SOCKET|CEILING|LIGHTING|FLOOR|ELECTRIC/i

/**
 * Picks the plan page (the furnishing plan 平面布置图, not the socket, ceiling or floor plans that
 * also name the tables) and the render page: the last of the first run of picture pages (no text,
 * or a short 效果图 title), since shop-front views come first and the inside views after. The
 * user can change both.
 */
export async function guessPages(
  doc: PDFDocumentProxy,
): Promise<{ plan: number | null; render: number | null }> {
  let plan: { page: number; score: number } | null = null
  const titled: number[] = []
  const blank: number[] = []
  const texts: string[] = []
  const last = Math.min(doc.numPages, 40)
  for (let n = 1; n <= last; n++) {
    const text = await pageText(doc, n)
    // Title blocks differ only in their drawing numbers.
    texts[n] = text.replace(/\d+/g, '#')
    if (!INDEX.test(text)) {
      const islands = Math.min((text.match(/中岛(桌|台)/g) ?? []).length, 6)
      const score =
        islands * 5 +
        (PLAN.test(text) ? 40 : 0) -
        (OTHER_PLAN.test(text) ? 30 : 0) -
        (/大样/.test(text) ? 20 : 0)
      if ((islands > 0 || PLAN.test(text)) && (!plan || score > plan.score))
        plan = { page: n, score }
    }
    if (n === 1) continue
    // Render pages carry a picture and at most a title (效果图 / RENDERING).
    if (RENDER.test(text) && text.length < 40) titled.push(n)
    else if (text.length === 0) blank.push(n)
  }
  // Else a run of three or more pages that carry only the same title block.
  const same: number[] = []
  for (let n = 2; n <= last; n++) {
    const text = texts[n] ?? ''
    const run = [n - 1, n, n + 1].filter((m) => m >= 2 && texts[m] === text).length
    if (text.length < 600 && run >= 2 && (texts[n - 1] === text || texts[n + 1] === text))
      same.push(n)
  }
  return {
    plan: plan?.page ?? null,
    render: lastOfFirstRun(titled) ?? lastOfFirstRun(blank) ?? lastOfFirstRun(same),
  }
}

/** The last page of the first run of consecutive pages (inside views follow the shop front). */
function lastOfFirstRun(pages: number[]): number | null {
  let end: number | null = null
  for (const n of pages) {
    if (end !== null && n !== end + 1) break
    end = n
  }
  return end
}

/** Which of two pictures is the plan: the name says so (平面 / 效果), else the first one. */
export function guessRoles<T extends { name: string }>(
  files: T[],
): { plan: T | null; render: T | null } {
  const plan = files.find((f) => /平面|plan/i.test(f.name)) ?? null
  const render = files.find((f) => f !== plan && /效果|render/i.test(f.name)) ?? null
  const rest = files.filter((f) => f !== plan && f !== render)
  return { plan: plan ?? rest.shift() ?? null, render: render ?? rest.shift() ?? null }
}

export const pictureType = (file: File): 'image/png' | 'image/jpeg' | null =>
  file.type === 'image/png' ? 'image/png' : file.type === 'image/jpeg' ? 'image/jpeg' : null
