// 本地识别回归：对一批门店图纸 PDF 逐页提取矢量内容并跑本地识别（不经过网页和 API，不需要浏览器），
// 统计可识别的平面页有多少能成功、比例依据是什么、失败原因分布，用于改进识别规则。
// 用法（apps/web 目录）：node src/scripts/local-regression.ts <PDF 目录或文件> [--limit 20] [--pages 8] [--si SI1.0] [--verbose]
import { readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import type { Asset } from '@store/shared'
import { functionFor } from '@store/shared'
import {
  checkDraft,
  failureReason,
  matchCatalog,
} from '../../../api/src/modules/recognition/check.ts'
import { recognizeVector } from '../../../api/src/modules/recognition/local.ts'
import { extractPageVector, pageScale } from '../features/recognition/pdf-vector.ts'

const args = process.argv.slice(2)
const option = (name: string, fallback: string) => {
  const at = args.indexOf(`--${name}`)
  return at >= 0 ? (args[at + 1] ?? fallback) : fallback
}
const given = args.find((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--'))
if (!given) {
  console.error(
    '用法：node src/scripts/local-regression.ts <PDF 目录或文件> [--limit 20] [--pages 8]',
  )
  process.exit(1)
}
const target: string = given
const limit = Number(option('limit', '20'))
const maxPages = Number(option('pages', '8'))
const siStyle = option('si', 'SI1.0')
const verbose = args.includes('--verbose')
const LONG_SIDE_PX = 2400

/** The catalogue as the API would see it, read straight from the library manifest. */
async function loadCatalog(): Promise<Asset[]> {
  const root = path.resolve(import.meta.dirname, '../../../..')
  const text = await readFile(path.join(root, '资源库/04_模型库/manifest.json'), 'utf8')
  const manifest = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text) as {
    assets: {
      asset_id: string
      standard_name: string
      variant: string
      display_name?: string | null
      si_family: string
      category: Asset['category']
      web_model?: string | null
      retired?: unknown
      tight_face_bounds_xyz_mm: [number, number, number]
    }[]
  }
  return manifest.assets.map((a) => ({
    id: a.asset_id,
    name: a.display_name ?? (a.variant ? `${a.standard_name} · ${a.variant}` : a.standard_name),
    standardName: a.standard_name,
    variant: a.variant,
    materialCategory: '',
    siFamily: a.si_family,
    category: a.category,
    function: functionFor(a.standard_name),
    installation: 'floor',
    footprint: {
      w: Math.max(a.tight_face_bounds_xyz_mm[0], 1) / 1000,
      d: Math.max(a.tight_face_bounds_xyz_mm[1], 1) / 1000,
      h: Math.max(a.tight_face_bounds_xyz_mm[2], 1) / 1000,
    },
    footprintSource: 'source',
    extent: null,
    front: null,
    staffSide: null,
    facingConfidence: null,
    placeable: Boolean(a.web_model),
    retired: Boolean(a.retired),
    judgment: null,
    glb: null,
    whiteGlb: null,
    finishGlb: null,
    market: null,
    otherMarketGlb: null,
    preview: null,
    productImage: null,
    productImageMatch: null,
    planSymbol: null,
  }))
}

async function listPdfs(): Promise<string[]> {
  const info = await stat(target)
  if (info.isFile()) return [target]
  const names = (await readdir(target)).filter((n) => /\.pdf$/i.test(n)).sort()
  return names.slice(0, limit).map((n) => path.join(target, n))
}

interface PageResult {
  file: string
  page: number
  texts: number
  lines: number
  props: number
  matched: number
  status: 'ok' | 'failed' | 'skipped'
  reason: string
  scale: string
  size: string
  ms: number
}

const catalog = await loadCatalog()
const results: PageResult[] = []
for (const file of await listPdfs()) {
  const name = path.basename(file)
  let doc
  try {
    doc = await pdfjs.getDocument({
      data: new Uint8Array(await readFile(file)),
      useSystemFonts: true,
      disableFontFace: true,
      verbosity: 0,
    }).promise
  } catch (error) {
    console.log(`${name}: 无法打开（${error instanceof Error ? error.message : String(error)}）`)
    continue
  }
  for (let n = 1; n <= Math.min(doc.numPages, maxPages); n++) {
    const started = Date.now()
    const page = await doc.getPage(n)
    const vector = await extractPageVector(page, pageScale(page, LONG_SIDE_PX), pdfjs.OPS)
    // A plan page names props; covers, elevations and renderings do not.
    const propTexts = vector.texts.filter((t) => functionFor(t.text) !== 'other')
    // A plan page names at least two props and one of them is a catalogue model.
    const known = propTexts.filter((t) => matchCatalog(t.text, catalog, undefined, siStyle).asset)
    if (propTexts.length < 2 || known.length < 1 || vector.lines.length < 50) {
      results.push({
        file: name,
        page: n,
        texts: vector.texts.length,
        lines: vector.lines.length,
        props: propTexts.length,
        matched: 0,
        status: 'skipped',
        reason: '',
        scale: '',
        size: '',
        ms: Date.now() - started,
      })
      continue
    }
    const draft = checkDraft(recognizeVector(vector, {}, catalog, siStyle))
    const reason = failureReason(draft)
    const inside = draft.items.filter((i) => i.source !== 'outside')
    const size = draft.space
      ? (() => {
          const xs = draft.space.boundary.map((p) => p[0])
          const zs = draft.space.boundary.map((p) => p[1])
          return `${(Math.max(...xs) - Math.min(...xs)).toFixed(1)}×${(Math.max(...zs) - Math.min(...zs)).toFixed(1)}`
        })()
      : '-'
    results.push({
      file: name,
      page: n,
      texts: vector.texts.length,
      lines: vector.lines.length,
      props: inside.length,
      matched: inside.filter((i) => i.assetId).length,
      status: reason ? 'failed' : 'ok',
      reason: reason ?? '',
      scale: draft.scale
        ? `${draft.scale.method}${draft.scale.verified ? '✓' : ''} ${draft.scale.mmPerPixel.toFixed(2)}`
        : '-',
      size,
      ms: Date.now() - started,
    })
    if (verbose) {
      console.log(`  ${name} p${n}: ${draft.notes.join(' / ')}`)
      console.log(`    pending: ${draft.pending.join(' / ')}`)
    }
  }
  await doc.destroy()
}

const plans = results.filter((r) => r.status !== 'skipped')
console.log('文件 | 页 | 文字 | 线段 | 道具(对应) | 结果 | 比例 | 边界(m) | 耗时')
for (const r of plans) {
  console.log(
    `${r.file} | ${r.page} | ${r.texts} | ${r.lines} | ${r.props}(${r.matched}) | ${r.status}${r.reason ? `：${r.reason}` : ''} | ${r.scale} | ${r.size} | ${r.ms} ms`,
  )
}
const ok = plans.filter((r) => r.status === 'ok')
const reasons = new Map<string, number>()
for (const r of plans.filter((r) => r.status === 'failed')) {
  reasons.set(r.reason, (reasons.get(r.reason) ?? 0) + 1)
}
const scales = new Map<string, number>()
for (const r of plans) {
  const key = r.scale.split(' ')[0] ?? '-'
  scales.set(key, (scales.get(key) ?? 0) + 1)
}
console.log(
  `\n平面页 ${plans.length}（另 ${results.length - plans.length} 页跳过），成功 ${ok.length}（${plans.length ? Math.round((ok.length / plans.length) * 100) : 0}%）`,
)
console.log('失败原因：', [...reasons].map(([k, v]) => `${k} ×${v}`).join('；') || '无')
console.log('比例依据：', [...scales].map(([k, v]) => `${k} ×${v}`).join('；'))
console.log(
  `道具对应率：${plans.reduce((s, r) => s + r.matched, 0)} / ${plans.reduce((s, r) => s + r.props, 0)}`,
)
