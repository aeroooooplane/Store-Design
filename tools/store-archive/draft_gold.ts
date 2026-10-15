// 阶段 3a：用工作台的本地识别（与网页、API 同一套代码）给金标准门店的主平面页出草稿。
// 结果写到 资源库/09_门店档案/_cache/gold/<store_id>/draft.json，供看图修正后生成 plan.json。
// 用法（仓库根目录，先 pnpm install）：node tools/store-archive/draft_gold.ts [--repo "D:/text demo"]
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Asset } from '../../packages/shared/src/index.ts'
import { functionFor } from '../../packages/shared/src/index.ts'
import { checkDraft, failureReason } from '../../apps/api/src/modules/recognition/check.ts'
import { recognizeVector } from '../../apps/api/src/modules/recognition/local.ts'
import { extractPageVector, pageScale } from '../../apps/web/src/features/recognition/pdf-vector.ts'

const LONG_SIDE_PX = 2400
const thisRepo = path.resolve(import.meta.dirname, '../..')
const at = process.argv.indexOf('--repo')
const repo = at >= 0 ? process.argv[at + 1]! : 'D:/text demo'
const archive = path.join(thisRepo, '资源库/09_门店档案')

const fromWeb = createRequire(path.join(thisRepo, 'apps/web/package.json'))
const pdfjs = (await import(
  pathToFileURL(fromWeb.resolve('pdfjs-dist/legacy/build/pdf.mjs')).href
)) as typeof import('pdfjs-dist/legacy/build/pdf.mjs')

const readJson = async <T>(file: string): Promise<T> => {
  const text = await readFile(file, 'utf8')
  return JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text) as T
}

/** 与 apps/web/src/scripts/local-regression.ts 相同：按模型库 manifest 组装识别用的目录。 */
async function loadCatalog(): Promise<Asset[]> {
  const manifest = await readJson<{
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
  }>(path.join(repo, '资源库/04_模型库/manifest.json'))
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
    front: null,
    staffSide: null,
    facingConfidence: null,
    placeable: Boolean(a.web_model),
    retired: Boolean(a.retired),
    judgment: null,
    glb: null,
    whiteGlb: null,
    finishGlb: null,
    preview: null,
    productImage: null,
    productImageMatch: null,
    planSymbol: null,
  }))
}

interface GoldRow {
  store_id: string
  门店: string
  分层: string
  主平面页: number
}
const gold = await readJson<GoldRow[]>(path.join(archive, '金标准名单.json'))
const sources = await readJson<{ sources: { source_id: string; path: string }[] }>(
  path.join(archive, '来源清单.json'),
)
const pathOf = new Map(sources.sources.map((s) => [s.source_id, s.path]))
const catalog = await loadCatalog()

for (const row of gold) {
  const file = path.join(repo, pathOf.get(row.store_id)!)
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(await readFile(file)),
    useSystemFonts: true,
    disableFontFace: true,
    verbosity: 0,
  }).promise
  const page = await doc.getPage(row.主平面页)
  const scale = pageScale(page, LONG_SIDE_PX)
  const viewport = page.getViewport({ scale })
  const vector = await extractPageVector(page, scale, pdfjs.OPS)
  const si = row.分层.split(' ')[0]!
  const draft = checkDraft(recognizeVector(vector, {}, catalog, si))
  const out = path.join(archive, '_cache/gold', row.store_id)
  await mkdir(out, { recursive: true })
  await writeFile(
    path.join(out, 'draft.json'),
    JSON.stringify(
      {
        store_id: row.store_id,
        page: row.主平面页,
        si,
        image: { longSidePx: LONG_SIDE_PX, width: viewport.width, height: viewport.height, pdfScale: scale },
        vector: { texts: vector.texts.length, lines: vector.lines.length, rects: vector.rects.length },
        failure: failureReason(draft),
        draft,
      },
      null,
      1,
    ),
  )
  const items = draft.items.filter((i) => i.source !== 'outside')
  console.log(
    `${row.store_id} ${row.门店} p${row.主平面页} | 文字 ${vector.texts.length} 线段 ${vector.lines.length} | ${failureReason(draft) ?? '成功'} | 比例 ${draft.scale ? `${draft.scale.method}${draft.scale.verified ? '✓' : ''}` : '-'} | 道具 ${items.length}（对应 ${items.filter((i) => i.assetId).length}）`,
  )
  await doc.destroy()
}
