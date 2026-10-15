import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import type { Database } from '@store/database'
import { EDITED_NOTE, applyDisplayEdits, safeFileName, storeTitle, unitPhoto } from '@store/shared'
import type {
  DisplayExport,
  DisplayRules,
  DisplayRulesView,
  DisplayTable,
  SiStyle,
} from '@store/shared'
import { AppError } from '../../lib/app-error.ts'
import { fileUrl } from '../../lib/file-url.ts'
import { resolveStoredFile } from '../../lib/storage.ts'
import type { StorageRoots } from '../../lib/storage.ts'
import { registerStoredFile, writeStorageFile } from '../../lib/stored-files.ts'
import { buildDisplayChecklist } from './checklist.ts'
import { buildDisplayDeck, deckImage } from './deck.ts'
import type { DeckImage, DisplayDeckInput } from './deck.ts'
import { currentDisplayRules } from './importer.ts'
import { DISPLAY_RESOURCE_DIR } from './workbook.ts'

const PPTX = 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
/** Exports kept on a task or node; older files stay registered but drop off the list. */
const KEEP_EXPORTS = 10

/** The rules in force, or a clear message that `pnpm display:import` has not run. */
export async function requireRules(db: Database) {
  const row = await currentDisplayRules(db)
  if (!row) {
    throw new AppError('INVALID_STATE', '还没有导入展陈规则，请先运行 pnpm display:import')
  }
  return row
}

export async function rulesView(db: Database): Promise<DisplayRulesView> {
  const row = await requireRules(db)
  return {
    version: row.version,
    importedAt: row.importedAt.toISOString(),
    rules: row.rules,
    photos: row.rules.photos.flatMap((p) =>
      p.fileId ? [{ unit: p.unit, si: p.si, kind: p.kind, url: fileUrl(p.fileId) }] : [],
    ),
  }
}

export const applyEdits = applyDisplayEdits

/** Tray pictures (the guide's renders) of every slot content in the deck, for the SI version. */
export async function loadPhotos(
  roots: StorageRoots,
  rules: DisplayRules,
  si: SiStyle,
  tables: DisplayTable[],
): Promise<Record<string, DeckImage>> {
  const units = new Set(tables.flatMap((t) => t.slots.map((s) => s.unit)).filter((u) => u !== null))
  const photos: Record<string, DeckImage> = {}
  for (const unit of units) {
    const photo = unitPhoto(rules, unit, si)
    if (!photo) continue
    try {
      const { file } = await resolveStoredFile(
        roots,
        'resource',
        `${DISPLAY_RESOURCE_DIR}/${photo.file}`,
      )
      photos[unit] = await deckImage(await readFile(file), 900)
    } catch {
      // A missing photo shows as “暂无照片” in the deck.
    }
  }
  return photos
}

/** Open points of a plan for the last slide. */
export function pendingOf(tables: DisplayTable[]): string[] {
  const out = new Set<string>()
  for (const t of tables) {
    for (const note of t.notes) if (note !== EDITED_NOTE) out.add(`${t.label}桌：${note}`)
    const empty = t.slots.filter((s) => s.unit === null).map((s) => s.slot)
    if (empty.length) out.add(`${t.label}桌空位：${empty.join('、')}`)
  }
  return [...out]
}

export interface DisplayFiles {
  pptx: Buffer
  xlsx: Buffer
  names: { pptx: string; xlsx: string }
}

/** Builds the PPT and the checklist; the caller decides where they go. */
export async function buildDisplayFiles(
  input: DisplayDeckInput & { name: string },
): Promise<DisplayFiles> {
  const [pptx, xlsx] = await Promise.all([
    buildDisplayDeck(input),
    buildDisplayChecklist({ title: input.title, rules: input.rules, tables: input.tables }),
  ])
  const title = safeFileName(storeTitle(input.name))
  return { pptx, xlsx, names: { pptx: `${title}展陈方案.pptx`, xlsx: `${title}展陈清单.xlsx` } }
}

/** Writes both files under STORAGE_ROOT and returns the export record with download links. */
export async function storeDisplayFiles(
  db: Database,
  roots: StorageRoots,
  folder: string,
  files: DisplayFiles,
  ruleVersion: string,
): Promise<DisplayExport> {
  const now = new Date()
  const stamp = now.toISOString().replace(/[:.]/g, '-')
  const save = async (data: Buffer, name: string, contentType: string) => {
    const storageKey = `${folder}/${stamp}/${name}`
    await writeStorageFile(roots, storageKey, data)
    const id = await registerStoredFile(db, {
      storageKey,
      kind: 'display',
      contentType,
      bytes: data.length,
      sha256: createHash('sha256').update(data).digest('hex'),
      originalName: name,
    })
    return { url: fileUrl(id), name, bytes: data.length }
  }
  return {
    pptx: await save(files.pptx, files.names.pptx, PPTX),
    xlsx: await save(files.xlsx, files.names.xlsx, XLSX),
    ruleVersion,
    createdAt: now.toISOString(),
  }
}

export const keepExports = (list: DisplayExport[], added: DisplayExport) =>
  [added, ...list].slice(0, KEEP_EXPORTS)

export { deckImage, storeTitle }
