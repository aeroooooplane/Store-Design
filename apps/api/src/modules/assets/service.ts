import { aliasedTable, and, asc, eq, ilike, or } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import { schema } from '@store/database'
import type { Database } from '@store/database'
import { isCatalogAssetRetired, wallArtAsset, WALL_ART_ID } from '@store/shared'
import type { Asset, AssetList, AssetListQuery, FileRef, FrontAxis } from '@store/shared'
import type { RequestContext } from '../../context/actor.ts'
import { authorize } from '../../context/policy.ts'
import { notFound } from '../../lib/app-error.ts'
import { versionedFileUrl } from '../../lib/file-url.ts'

const { assets, storedFiles } = schema
const glbFiles = aliasedTable(storedFiles, 'glb_files')
const previewFiles = aliasedTable(storedFiles, 'preview_files')
const whiteFiles = aliasedTable(storedFiles, 'white_files')
const finishFiles = aliasedTable(storedFiles, 'finish_files')
const otherMarketFiles = aliasedTable(storedFiles, 'other_market_files')
const imageFiles = aliasedTable(storedFiles, 'image_files')
const symbolFiles = aliasedTable(storedFiles, 'symbol_files')

interface AssetFiles {
  glb: FileRow | null
  preview: FileRow | null
  white: FileRow | null
  finish: FileRow | null
  otherMarket: FileRow | null
  image: FileRow | null
  symbol: FileRow | null
}

type FileRow = typeof storedFiles.$inferSelect

function fileRef(row: FileRow | null): FileRef | null {
  return row
    ? {
        fileId: row.id,
        url: versionedFileUrl(row.id, row.sha256),
        bytes: row.bytes,
        sha256: row.sha256,
      }
    : null
}

function toAsset(
  row: typeof assets.$inferSelect,
  { glb, preview, white, finish, otherMarket, image, symbol }: AssetFiles,
): Asset {
  if (row.id === WALL_ART_ID)
    return {
      ...wallArtAsset(),
      retired: isCatalogAssetRetired(row),
      productImage: fileRef(image),
      productImageMatch: image ? (row.productImageMatch as Asset['productImageMatch']) : null,
    }
  return {
    id: row.id,
    name:
      row.displayName ?? (row.variant ? `${row.standardName} · ${row.variant}` : row.standardName),
    standardName: row.standardName,
    variant: row.variant,
    materialCategory: row.materialCategory,
    siFamily: row.siFamily,
    category: row.category as Asset['category'],
    function: row.function,
    installation: row.installation as Asset['installation'],
    footprint: { w: row.width, d: row.depth, h: row.height },
    footprintSource: row.footprintSource as Asset['footprintSource'],
    extent: row.extent ?? null,
    front: row.front as FrontAxis | null,
    staffSide: row.staffSide as FrontAxis | null,
    facingConfidence: row.facingConfidence as Asset['facingConfidence'],
    placeable: row.placeable,
    retired: isCatalogAssetRetired(row),
    judgment: row.judgment,
    glb: fileRef(glb),
    whiteGlb: fileRef(white),
    finishGlb: fileRef(finish),
    market: row.market as Asset['market'],
    otherMarketGlb: fileRef(otherMarket),
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
      finish: finishFiles,
      otherMarket: otherMarketFiles,
      image: imageFiles,
      symbol: symbolFiles,
    })
    .from(assets)
    .leftJoin(glbFiles, eq(assets.glbFileId, glbFiles.id))
    .leftJoin(previewFiles, eq(assets.previewFileId, previewFiles.id))
    .leftJoin(whiteFiles, eq(assets.whiteGlbFileId, whiteFiles.id))
    .leftJoin(finishFiles, eq(assets.finishGlbFileId, finishFiles.id))
    .leftJoin(otherMarketFiles, eq(assets.otherMarketGlbFileId, otherMarketFiles.id))
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
      ilike(assets.displayName, pattern),
      ilike(assets.standardName, pattern),
      ilike(assets.variant, pattern),
    )
    if (match) filters.push(match)
  }
  const rows = await selectAssets(db, filters.length ? and(...filters) : undefined)
  const items = rows.map((r) => toAsset(r.asset, r))
  const art = wallArtAsset()
  if (
    !items.some((a) => a.id === art.id) &&
    (!query.function || query.function === art.function) &&
    (query.placeable === undefined || query.placeable === art.placeable) &&
    (!query.category || query.category === art.category) &&
    (!query.siFamily || query.siFamily === art.siFamily) &&
    (!query.q ||
      [art.id, art.name, art.standardName, art.variant].some((v) =>
        v.toLowerCase().includes(query.q!.toLowerCase()),
      ))
  )
    items.push(art)
  return { items, total: items.length }
}

export async function getAsset(db: Database, ctx: RequestContext, id: string): Promise<Asset> {
  authorize(ctx.actor, 'asset:read')
  const [row] = await selectAssets(db, eq(assets.id, id))
  if (!row && id === WALL_ART_ID) return wallArtAsset()
  if (!row) throw notFound('资产')
  return toAsset(row.asset, row)
}

/** Placeable assets by id, for validating and planning layouts on the server. */
/** Every catalogue model: layouts may use models without a web model as placeholders. */
export async function catalogAssets(db: Database): Promise<Map<string, Asset>> {
  const rows = await selectAssets(db, undefined)
  const result = new Map(rows.map((r) => [r.asset.id, toAsset(r.asset, r)]))
  if (!result.has(WALL_ART_ID)) result.set(WALL_ART_ID, wallArtAsset())
  return result
}

/** Models with a verified web model; the planner only chooses among these. */
export async function placeableAssets(db: Database): Promise<Map<string, Asset>> {
  const rows = await selectAssets(db, eq(assets.placeable, true))
  const result = new Map(rows.map((r) => [r.asset.id, toAsset(r.asset, r)]))
  if (!result.has(WALL_ART_ID)) result.set(WALL_ART_ID, wallArtAsset())
  return result
}
