import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { and, eq, notInArray, sql } from 'drizzle-orm'
import { z } from 'zod'
import { schema } from '@store/database'
import type { Database } from '@store/database'
import {
  AssetCategorySchema,
  FrontAxisSchema,
  ImageMatchSchema,
  InstallationSchema,
  MarketSchema,
  functionFor,
  roundM,
} from '@store/shared'
import { contentTypeFor, isLfsPointer, resolveStoredFile, sha256File } from '../../lib/storage.ts'
import type { StorageRoots } from '../../lib/storage.ts'
import { FinishRecordSchema, WhiteRecordSchema } from './light-records.ts'
import type { LightKind } from './light-records.ts'

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
  /** Models with a version per market (LOGO): the market model.glb shows … */
  market: MarketSchema.optional(),
  /** … and the other market's file next to it, the same size (build-logo-models.ts). */
  variants: z
    .partialRecord(
      MarketSchema,
      z.object({
        file: z.string().regex(/^[\w.-]+\.glb$/),
        bytes: z.int().positive(),
        glbSha256: z.string().regex(/^[0-9a-f]{64}$/),
      }),
    )
    .optional(),
})

/**
 * Body sizes for models whose box takes in loose parts (a 开箱桌 with its stools): placement,
 * collision and dimensions use the body, the model is still drawn whole (body-footprint.json).
 */
const BodyFootprintSchema = z.object({
  assets: z.record(
    z.string(),
    z.looseObject({
      w: z.number().positive(),
      d: z.number().positive(),
      /** Centre of the body relative to the centre of the whole model, [X, Z] in metres. */
      offset: z.tuple([z.number(), z.number()]),
    }),
  ),
})

const FacingSchema = z.object({
  assets: z.record(
    z.string(),
    z.looseObject({
      front: FrontAxisSchema,
      staffSide: FrontAxisSchema.optional(),
      confidence: z.enum(['high', 'medium', 'low']),
      installation: InstallationSchema.optional(),
    }),
  ),
})

export interface CatalogImportReport {
  assets: number
  withGlb: number
  /** Web models that also have a current light white-model copy. */
  withWhite: number
  /** Web models that also have a current light material copy. */
  withFinish: number
  placeable: number
  withPreview: number
  withProductImage: number
  withPlanSymbol: number
  /** Models no longer in manifest.json, retired in the database by this import. */
  retiredMissing: number
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

const LIGHT_MODELS: Record<
  LightKind,
  { record: z.ZodType<{ sourceSha256: string; sha256: string }>; title: string; command: string }
> = {
  white: { record: WhiteRecordSchema, title: '白模轻量版', command: 'pnpm catalog:white' },
  finish: { record: FinishRecordSchema, title: '材质轻量版', command: 'pnpm catalog:finish' },
}

/** A light model (white.glb, finish.glb) counts only if it was built from this exact model.glb. */
async function lightModel(
  roots: StorageRoots,
  report: CatalogImportReport,
  id: string,
  web: string,
  glb: FileFacts,
  kind: LightKind,
): Promise<FileFacts | undefined> {
  const { record: schema, title, command } = LIGHT_MODELS[kind]
  const recordRaw = await optionalJson(path.join(roots.resource, web, `${kind}.json`))
  const record = recordRaw === undefined ? undefined : schema.safeParse(recordRaw)
  if (record?.success && record.data.sourceSha256 === glb.sha256) {
    const facts = await inspect(roots, `${web}/${kind}.glb`)
    if (typeof facts === 'string') report.problems.push(`${id}: ${facts}`)
    else if (facts.sha256 !== record.data.sha256)
      report.problems.push(`${id}: ${kind}.glb 与 ${kind}.json 的哈希不一致，未挂接`)
    else return facts
  } else if (record) {
    report.problems.push(`${id}: ${title}已过期或记录无效，请运行 ${command}`)
  }
  return undefined
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
  const bodyRaw = await optionalJson(path.join(roots.resource, inLibrary('body-footprint.json')))
  const bodies = bodyRaw === undefined ? {} : BodyFootprintSchema.parse(bodyRaw).assets
  const report: CatalogImportReport = {
    assets: 0,
    withGlb: 0,
    withWhite: 0,
    withFinish: 0,
    placeable: 0,
    withPreview: 0,
    withProductImage: 0,
    withPlanSymbol: 0,
    retiredMissing: 0,
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
    // The other market's version of a LOGO, checked against its record like model.glb.
    let otherMarket: FileFacts | undefined
    const other = conversion?.market === 'domestic' ? 'overseas' : 'domestic'
    const variant = conversion?.market ? conversion.variants?.[other] : undefined
    if (web && glb && variant) {
      const facts = await inspect(roots, `${web}/${variant.file}`)
      if (typeof facts === 'string') report.problems.push(`${id}: ${facts}`)
      else if (facts.sha256 !== variant.glbSha256 || facts.bytes !== variant.bytes)
        report.problems.push(
          `${id}: ${variant.file} 与 conversion.json 的哈希或字节数不一致，未挂接`,
        )
      else otherMarket = facts
    }
    const white = web && glb ? await lightModel(roots, report, id, web, glb, 'white') : undefined
    const finish = web && glb ? await lightModel(roots, report, id, web, glb, 'finish') : undefined
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
    // A corrected body (a 开箱桌 without its stools) replaces the model box; the whole model is
    // kept as the extent around it, for drawing and the stool check.
    const body = bodies[id]
    if (body && (body.w > raw.w + 0.01 || body.d > raw.d + 0.01))
      report.problems.push(`${id}: 桌体尺寸大于整个模型，未采用桌体尺寸校正`)
    const corrected = body && body.w <= raw.w + 0.01 && body.d <= raw.d + 0.01 ? body : null
    // Zero-thickness artwork is stored as 1 mm so every footprint stays a real box.
    const footprint = {
      w: Math.max(corrected?.w ?? raw.w, MIN_EXTENT_M),
      d: Math.max(corrected?.d ?? raw.d, MIN_EXTENT_M),
      h: Math.max(raw.h, MIN_EXTENT_M),
    }
    const extent = corrected
      ? {
          w: roundM(raw.w),
          d: roundM(raw.d),
          cx: roundM(-corrected.offset[0]) + 0,
          cz: roundM(-corrected.offset[1]) + 0,
        }
      : null
    if (Object.values(raw).some((v) => v < MIN_EXTENT_M))
      report.problems.push(`${id}: 某一方向尺寸为 0（平面画面），按 1 mm 记录`)
    // Wall and ceiling pieces are placed by hand; the planner only picks floor models by function.
    const placeable = glb !== undefined && installation !== null

    await db.transaction(async (tx) => {
      const glbFileId = glb ? await registerFile(tx, glb, 'glb') : null
      const whiteGlbFileId = white ? await registerFile(tx, white, 'glb') : null
      const finishGlbFileId = finish ? await registerFile(tx, finish, 'glb') : null
      const otherMarketGlbFileId = otherMarket ? await registerFile(tx, otherMarket, 'glb') : null
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
        extent,
        footprintSource: conversion ? 'glb' : 'source',
        front: face?.front ?? null,
        staffSide: face?.staffSide ?? null,
        facingConfidence: face?.confidence ?? null,
        placeable,
        retired: Boolean(entry.retired),
        judgment: entry.judgment ?? null,
        glbFileId,
        whiteGlbFileId,
        finishGlbFileId,
        market: otherMarket ? (conversion?.market ?? null) : null,
        otherMarketGlbFileId,
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
    if (finish) report.withFinish++
    if (placeable) report.placeable++
    if (preview) report.withPreview++
    if (productImage) report.withProductImage++
    if (planSymbol) report.withPlanSymbol++
  }
  // A model taken out of manifest.json (e.g. 全景相机 LOGO, 10-15) is retired where it was
  // imported before: old layouts still show it, it is no longer offered or planned.
  const listed = manifest.assets.map((entry) => entry.asset_id)
  const dropped = await db
    .update(schema.assets)
    .set({ retired: true, importedAt: sql`now()` })
    .where(and(notInArray(schema.assets.id, listed), eq(schema.assets.retired, false)))
    .returning({ id: schema.assets.id })
  report.retiredMissing = dropped.length
  return report
}
