import { readFile } from 'node:fs/promises'
import type { DisplayEdits, DisplayRules, DisplayTable, SiStyle } from '@store/shared'
import type { StorageRoots } from '../../lib/storage.ts'
import { resolveStoredFile } from '../../lib/storage.ts'
import { deckImage } from './deck.ts'
import type { InnerTrayImages } from './deck.ts'
import { DISPLAY_RESOURCE_DIR } from './workbook.ts'

// Exact module pictures cropped from the archived guide; identifiers are never used as paths.
const MODULES = {
  legacy: new Set([
    'A1',
    'A2',
    'A3',
    'A4',
    'C1',
    'C2',
    'C3',
    'D1',
    'D2',
    'D3',
    'D4',
    'D6',
    'D7',
    'D8',
  ]),
  '2026': new Set([
    'A2',
    'A3',
    'A4',
    'A7',
    'A8',
    'C1',
    'C4',
    'D4',
    'D7',
    'D9',
    'D11',
    'D12',
    'D13',
    'D16',
  ]),
}

/** Select the saved scheme, never the project default or a similarly named module in another SI. */
export async function loadInnerTrayImages(
  roots: StorageRoots,
  rules: DisplayRules,
  si: SiStyle,
  scheme: DisplayEdits['moduleScheme'],
  tables: DisplayTable[],
): Promise<InnerTrayImages> {
  const version =
    si === 'SI2.0' &&
    scheme === 'draft-2026' &&
    rules.seatModules.some((row) => row.si === si && row.scheme === scheme)
      ? '2026'
      : 'legacy'
  const result: InnerTrayImages = {
    title: version === '2026' ? '2026版内嵌托盘' : '既有内嵌托盘方案',
    source: version === '2026' ? '展陈指引第三节 · rev4130' : '既有指引 · 2026-10-13资源',
    images: {},
  }
  const ids = new Set(
    tables.filter((table) => table.kind === 'island').flatMap((table) => table.modules),
  )
  for (const id of ids) {
    if (!MODULES[version].has(id)) continue
    try {
      const { file } = await resolveStoredFile(
        roots,
        'resource',
        `${DISPLAY_RESOURCE_DIR}/配件模块/PPT配图20261105/${version}-${id}.png`,
      )
      result.images[id] = await deckImage(await readFile(file))
    } catch {
      // Keep the exact id visible with a missing-picture notice; never substitute another version.
    }
  }
  return result
}
