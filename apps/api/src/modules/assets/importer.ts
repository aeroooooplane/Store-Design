import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { sql } from 'drizzle-orm'
import { z } from 'zod'
import { schema } from '@store/database'
import type { Database } from '@store/database'
import { AssetCategorySchema, FrontAxisSchema, ImageMatchSchema, roundM } from '@store/shared'
import type { ItemFunction } from '@store/shared'
import { contentTypeFor, isLfsPointer, resolveStoredFile, sha256File } from '../../lib/storage.ts'
import type { StorageRoots } from '../../lib/storage.ts'
import { WhiteRecordSchema } from './white-models.ts'

/**
 * The model library inside the resource root (资源库). Every file is found through
 * manifest.json, whose paths are relative to this folder (see 资源库/04_模型库/README.md).
 */
export const LIBRARY_DIR = '04_模型库'
const inLibrary = (relative: string) => `${LIBRARY_DIR}/${relative}`
const MIN_EXTENT_M = 0.001

const ManifestSchema = z.object({
  assets: z.array(
    z.looseObject({
      asset_id: z.string().regex(/^asset-\d+$/),
      standard_name: z.string().min(1),
      variant: z.string(),
      /** 模型选用表 name; the manual name stays in standard_name / variant. */
      display_name: z.string().min(1).nullish(),
      /** 模型选用表 删除: kept for old layouts, no longer offered. */
      retired: z.looseObject({ date: z.string() }).nullish(),
      material_category: z.string().min(1),
      si_family: z.string().min(1),
      judgment: z.string().nullish(),
      preview: z.string().nullish(),
      named_sha256: z.string().nullish(),
      category: AssetCategorySchema,
      /** Folder with model.glb, white.glb and their records; null without a web model. */
      web_model: z.string().nullish(),
      product_image: z.string().nullish(),
      product_image_match: ImageMatchSchema.nullish(),
      plan_symbol: z.object({ svg: z.string(), png: z.string().nullable() }).nullish(),
      // Flat artwork (KV/LOGO 画面) has a zero extent in one axis.
      tight_face_bounds_xyz_mm: z.tuple([z.number().min(0), z.number().min(0), z.number().min(0)]),
    }),
  ),
})

const ConversionSchema = z.looseObject({
  id: z.string(),
  bytes: z.int().positive(),
  glbSha256: z.string().regex(/^[0-9a-f]{64}$/),
  dimensions: z.object({
    w: z.number().positive(),
    h: z.number().positive(),
    d: z.number().positive(),
  }),
})

const FacingSchema = z.object({
  assets: z.record(
    z.string(),
    z.looseObject({
      front: FrontAxisSchema,
      staffSide: FrontAxisSchema.optional(),
      confidence: z.enum(['high', 'medium', 'low']),
      installation: z.enum(['floor', 'wall']).optional(),
    }),
  ),
})

/**
 * Catalogue function from the reviewed standard name. Order matters: specific phrases first
 * (a 边桌收银柜 is a cashier, a 开箱储物柜 an unboxing table).
 */
const FUNCTION_RULES: [RegExp, ItemFunction][] = [
  [/收银/, 'cashier'],
  [/开箱/, 'unboxing_table'],
  [/中岛/, 'island_table'],
  [/配件边柜|边桌配件柜/, 'side_cabinet'],
  [/配件柜/, 'accessory_cabinet'],
  [/储物柜/, 'storage'],
  [/展示台|试飞台/, 'display_stand'],
  [/凳|沙发/, 'seating'],
  [/广告机|屏|水牌/, 'screen'],
  [/LOGO|画面|灯箱|侧招|标识/i, 'signage'],
]

export function functionFor(standardName: string): ItemFunction {
  return FUNCTION_RULES.find(([pattern]) => pattern.test(standardName))?.[1] ?? 'other'
}

export interface CatalogImportReport {
  assets: number
  withGlb: number
  /** Web models that also have a current light white-model copy. */
  withWhite: number
  placeable: number
  withPreview: number
  withProductImage: number
  withPlanSymbol: number
  problems: string[]
}

async function readJson(file: string): Promise<unknown> {
  const text = await readFile(file, 'utf8')
  // Some manifests were written with a UTF-8 byte order mark.
  return JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text) as unknown
}

async function optionalJson(file: string): Promise<unknown> {
  try {
    return await readJson(file)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

interface FileFacts {
  key: string
  sha256: string
  bytes: number
}

/** Hashes a resource file; returns null (with a reason) when it is absent or only an LFS pointer. */
async function inspect(roots: StorageRoots, key: string): Promise<FileFacts | string> {
  let resolved: { file: string; bytes: number }
  try {
    resolved = await resolveStoredFile(roots, 'resource', key)
  } catch {
    return `缺少文件 ${key}`
  }
  if (await isLfsPointer(resolved.file, resolved.bytes)) return `未下载的 LFS 指针 ${key}`
  return { key, sha256: await sha256File(resolved.file), bytes: resolved.bytes }
}

async function registerFile(db: Database, facts: FileFacts, kind: string): Promise<string> {
  const values = {
    root: 'resource',
    storageKey: facts.key,
    kind,
    contentType: contentTypeFor(facts.key),
    bytes: facts.bytes,
    sha256: facts.sha256,
  }
  const [row] = await db
    .insert(schema.storedFiles)
    .values(values)
    .onConflictDoUpdate({
      target: [schema.storedFiles.root, schema.storedFiles.storageKey],
      set: { kind, contentType: values.contentType, bytes: values.bytes, sha256: values.sha256 },
    })
    .returning({ id: schema.storedFiles.id })
  if (!row) throw new Error('stored_files upsert returned no row')
  return row.id
}

/**
 * Imports (or refreshes) the model catalogue from 资源库. Idempotent: rerunning updates rows in
 * place. A web model is attached only when its bytes match the conversion record.
 */
export async function importCatalog(
  db: Database,
  roots: StorageRoots,
): Promise<CatalogImportReport> {
  const manifest = ManifestSchema.parse(
    await readJson(path.join(roots.resource, LIBRARY_DIR, 'manifest.json')),
  )
  const facingRaw = await optionalJson(path.join(roots.resource, inLibrary('facing.json')))
  const facing = facingRaw === undefined ? {} : FacingSchema.parse(facingRaw).assets
  const report: CatalogImportReport = {
    assets: 0,
    withGlb: 0,
    withWhite: 0,
    placeable: 0,
    withPreview: 0,
    withProductImage: 0,
    withPlanSymbol: 0,
    problems: [],
  }

  for (const entry of manifest.assets) {
    const id = entry.asset_id
    const web = entry.web_model ? inLibrary(entry.web_model) : null
    const conversionRaw = web
      ? await optionalJson(path.join(roots.resource, web, 'conversion.json'))
      : undefined
    const conversion =
      conversionRaw === undefined ? undefined : ConversionSchema.parse(conversionRaw)

    let glb: FileFacts | undefined
    if (web && conversion) {
      const facts = await inspect(roots, `${web}/model.glb`)
      if (typeof facts === 'string') report.problems.push(`${id}: ${facts}`)
      else if (facts.sha256 !== conversion.glbSha256 || facts.bytes !== conversion.bytes)
        report.problems.push(`${id}: model.glb 与 conversion.json 的哈希或字节数不一致，未挂接`)
      else glb = facts
    }
    // The light white model counts only if it was built from this exact model.glb.
    let white: FileFacts | undefined
    if (web && glb) {
      const recordRaw = await optionalJson(path.join(roots.resource, web, 'white.json'))
      const record = recordRaw === undefined ? undefined : WhiteRecordSchema.safeParse(recordRaw)
      if (record?.success && record.data.sourceSha256 === glb.sha256) {
        const facts = await inspect(roots, `${web}/white.glb`)
        if (typeof facts === 'string') report.problems.push(`${id}: ${facts}`)
        else if (facts.sha256 !== record.data.sha256)
          report.problems.push(`${id}: white.glb 与 white.json 的哈希不一致，未挂接`)
        else white = facts
      } else if (record) {
        report.problems.push(`${id}: 白模轻量版已过期或记录无效，请运行 pnpm catalog:white`)
      }
    }
    let preview: FileFacts | undefined
    if (entry.preview) {
      const facts = await inspect(roots, inLibrary(entry.preview))
      if (typeof facts === 'string') report.problems.push(`${id}: ${facts}`)
      else preview = facts
    }
    // Product picture and plan symbol from the category gallery (品类图库).
    const optionalFile = async (relative: string | null | undefined) => {
      if (!relative) return undefined
      const facts = await inspect(roots, inLibrary(relative))
      if (typeof facts !== 'string') return facts
      report.problems.push(`${id}: ${facts}`)
      return undefined
    }
    const productImage = await optionalFile(entry.product_image)
    const planSymbol = await optionalFile(entry.plan_symbol?.svg)

    const face = facing[id]
    // Facing review recorded wall pieces; other 软装 stand on the floor; the rest is unknown.
    const installation =
      face?.installation ?? (entry.material_category === '软装物料' ? 'floor' : null)
    const [x, y, z] = entry.tight_face_bounds_xyz_mm
    const raw = conversion
      ? { w: conversion.dimensions.w, d: conversion.dimensions.d, h: conversion.dimensions.h }
      : { w: x / 1000, d: y / 1000, h: z / 1000 } // SketchUp: X width, Y depth, Z up
    // Zero-thickness artwork is stored as 1 mm so every footprint stays a real box.
    const footprint = {
      w: Math.max(raw.w, MIN_EXTENT_M),
      d: Math.max(raw.d, MIN_EXTENT_M),
      h: Math.max(raw.h, MIN_EXTENT_M),
    }
    if (Object.values(raw).some((v) => v < MIN_EXTENT_M))
      report.problems.push(`${id}: 某一方向尺寸为 0（平面画面），按 1 mm 记录`)
    const placeable = glb !== undefined && installation === 'floor'

    await db.transaction(async (tx) => {
      const glbFileId = glb ? await registerFile(tx, glb, 'glb') : null
      const whiteGlbFileId = white ? await registerFile(tx, white, 'glb') : null
      const previewFileId = preview ? await registerFile(tx, preview, 'preview') : null
      const productImageFileId = productImage
        ? await registerFile(tx, productImage, 'product_image')
        : null
      const planSymbolFileId = planSymbol ? await registerFile(tx, planSymbol, 'plan_symbol') : null
      const values = {
        id,
        standardName: entry.standard_name,
        variant: entry.variant,
        displayName: entry.display_name ?? null,
        materialCategory: entry.material_category,
        siFamily: entry.si_family,
        category: entry.category,
        function: functionFor(entry.standard_name),
        installation,
        width: roundM(footprint.w),
        depth: roundM(footprint.d),
        height: roundM(footprint.h),
        footprintSource: conversion ? 'glb' : 'source',
        front: face?.front ?? null,
        staffSide: face?.staffSide ?? null,
        facingConfidence: face?.confidence ?? null,
        placeable,
        retired: Boolean(entry.retired),
        judgment: entry.judgment ?? null,
        glbFileId,
        whiteGlbFileId,
        previewFileId,
        productImageFileId,
        productImageMatch: productImage ? (entry.product_image_match ?? null) : null,
        planSymbolFileId,
        sourceSha256: entry.named_sha256 ?? null,
      }
      const { id: _id, ...update } = values
      await tx
        .insert(schema.assets)
        .values(values)
        .onConflictDoUpdate({
          target: schema.assets.id,
          set: { ...update, importedAt: sql`now()` },
        })
    })

    report.assets++
    if (glb) report.withGlb++
    if (white) report.withWhite++
    if (placeable) report.placeable++
    if (preview) report.withPreview++
    if (productImage) report.withProductImage++
    if (planSymbol) report.withPlanSymbol++
  }
  return report
}
