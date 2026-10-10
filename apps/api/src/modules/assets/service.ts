import { aliasedTable, and, asc, eq, ilike, or } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import { schema } from '@store/database'
import type { Database } from '@store/database'
import type { Asset, AssetList, AssetListQuery, FileRef, FrontAxis } from '@store/shared'
import type { RequestContext } from '../../context/actor.ts'
import { authorize } from '../../context/policy.ts'
import { notFound } from '../../lib/app-error.ts'
import { fileUrl } from '../files/routes.ts'

const { assets, storedFiles } = schema
const glbFiles = aliasedTable(storedFiles, 'glb_files')
const previewFiles = aliasedTable(storedFiles, 'preview_files')
const whiteFiles = aliasedTable(storedFiles, 'white_files')
const imageFiles = aliasedTable(storedFiles, 'image_files')
const symbolFiles = aliasedTable(storedFiles, 'symbol_files')

interface AssetFiles {
  glb: FileRow | null
  preview: FileRow | null
  white: FileRow | null
  image: FileRow | null
  symbol: FileRow | null
}

type FileRow = typeof storedFiles.$inferSelect

function fileRef(row: FileRow | null): FileRef | null {
  return row ? { fileId: row.id, url: fileUrl(row.id), bytes: row.bytes, sha256: row.sha256 } : null
}

function toAsset(
  row: typeof assets.$inferSelect,
  { glb, preview, white, image, symbol }: AssetFiles,
): Asset {
  return {
    id: row.id,
    name: row.variant ? `${row.standardName} · ${row.variant}` : row.standardName,
    standardName: row.standardName,
    variant: row.variant,
    materialCategory: row.materialCategory,
    siFamily: row.siFamily,
    category: row.category as Asset['category'],
    function: row.function,
    installation: row.installation as Asset['installation'],
    footprint: { w: row.width, d: row.depth, h: row.height },
    footprintSource: row.footprintSource as Asset['footprintSource'],
    front: row.front as FrontAxis | null,
    staffSide: row.staffSide as FrontAxis | null,
    facingConfidence: row.facingConfidence as Asset['facingConfidence'],
    placeable: row.placeable,
    judgment: row.judgment,
    glb: fileRef(glb),
    whiteGlb: fileRef(white),
    preview: fileRef(preview),
    productImage: fileRef(image),
    productImageMatch: image ? (row.productImageMatch as Asset['productImageMatch']) : null,
    planSymbol: fileRef(symbol),
  }
}

function escapeLike(text: string): string {
  return `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
}

function selectAssets(db: Database, where: SQL | undefined) {
  return db
    .select({
      asset: assets,
      glb: glbFiles,
      preview: previewFiles,
      white: whiteFiles,
      image: imageFiles,
      symbol: symbolFiles,
    })
    .from(assets)
    .leftJoin(glbFiles, eq(assets.glbFileId, glbFiles.id))
    .leftJoin(previewFiles, eq(assets.previewFileId, previewFiles.id))
    .leftJoin(whiteFiles, eq(assets.whiteGlbFileId, whiteFiles.id))
    .leftJoin(imageFiles, eq(assets.productImageFileId, imageFiles.id))
    .leftJoin(symbolFiles, eq(assets.planSymbolFileId, symbolFiles.id))
    .where(where)
    .orderBy(asc(assets.function), asc(assets.standardName), asc(assets.id))
}

export async function listAssets(
  db: Database,
  ctx: RequestContext,
  query: AssetListQuery,
): Promise<AssetList> {
  authorize(ctx.actor, 'asset:read')
  const filters: SQL[] = []
  if (query.function) filters.push(eq(assets.function, query.function))
  if (query.placeable !== undefined) filters.push(eq(assets.placeable, query.placeable))
  if (query.siFamily) filters.push(eq(assets.siFamily, query.siFamily))
  if (query.category) filters.push(eq(assets.category, query.category))
  if (query.q) {
    const pattern = escapeLike(query.q)
    const match = or(
      ilike(assets.id, pattern),
      ilike(assets.standardName, pattern),
      ilike(assets.variant, pattern),
    )
    if (match) filters.push(match)
  }
  const rows = await selectAssets(db, filters.length ? and(...filters) : undefined)
  const items = rows.map((r) => toAsset(r.asset, r))
  return { items, total: items.length }
}

export async function getAsset(db: Database, ctx: RequestContext, id: string): Promise<Asset> {
  authorize(ctx.actor, 'asset:read')
  const [row] = await selectAssets(db, eq(assets.id, id))
  if (!row) throw notFound('资产')
  return toAsset(row.asset, row)
}

/** Placeable assets by id, for validating and planning layouts on the server. */
/** Every catalogue model: layouts may use models without a web model as placeholders. */
export async function catalogAssets(db: Database): Promise<Map<string, Asset>> {
  const rows = await selectAssets(db, undefined)
  return new Map(rows.map((r) => [r.asset.id, toAsset(r.asset, r)]))
}

/** Models with a verified web model; the planner only chooses among these. */
export async function placeableAssets(db: Database): Promise<Map<string, Asset>> {
  const rows = await selectAssets(db, eq(assets.placeable, true))
  return new Map(rows.map((r) => [r.asset.id, toAsset(r.asset, r)]))
}
