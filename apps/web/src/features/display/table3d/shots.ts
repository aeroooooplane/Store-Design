import * as THREE from 'three'
import type {
  DisplayRules,
  DisplayRulesView,
  DisplayTable,
  DisplayTableShot,
  PictureRect,
  SiStyle,
} from '@store/shared'
import { photoOf } from '../photos.ts'
import { buildTableScene, pictureRect, stripRect } from './scene.ts'
import type { SlotContent } from './scene.ts'

/** What the 3D views need besides the table: names and pictures of the units, the SI, the end. */
export interface TableViewContext {
  rules: DisplayRules
  photos: DisplayRulesView['photos']
  si: SiStyle
  end: 'left' | 'right'
}

export function slotContents(table: DisplayTable, ctx: TableViewContext): SlotContent[] {
  const labelOf = new Map(ctx.rules.units.map((u) => [u.id, u.label]))
  return table.slots.map((s) => ({
    slot: s.slot,
    hero: s.hero,
    name: s.unit ? (labelOf.get(s.unit) ?? s.unit) : '待定',
    empty: !s.unit,
    photo: photoOf(ctx.photos, s.unit, ctx.si)?.url ?? null,
  }))
}

/** Picture shape: tall for a portrait island table (its long side runs away), wide otherwise. */
export const shotAspect = (table: DisplayTable) =>
  table.kind === 'island' && table.orientation === 'portrait' ? 4 / 5 : 16 / 10

/** Same table, same contents, same picture: the key of a cached view. */
export const viewKey = (table: DisplayTable, ctx: TableViewContext, names: boolean) =>
  JSON.stringify([
    table.sourceId,
    table.orientation,
    table.slots,
    table.modules,
    ctx.si,
    ctx.end,
    names,
  ])

export interface TableSnapshot {
  url: string
  /** Slot → its card and its name strip on the picture. */
  slots: Record<string, { card: PictureRect; name: PictureRect }>
}

// One renderer for every still picture: a browser keeps only about 16 WebGL contexts.
let renderer: THREE.WebGLRenderer | null = null
let queue: Promise<unknown> = Promise.resolve()

/** Draws one table from the entrance side; pictures are made one at a time. */
export function snapshotTable(
  table: DisplayTable,
  ctx: TableViewContext,
  options: { width: number; height: number; names: boolean; type?: 'image/jpeg' | 'image/png' },
): Promise<TableSnapshot> {
  const run = async () => {
    const built = await buildTableScene({
      table,
      end: ctx.end,
      contents: slotContents(table, ctx),
      names: options.names,
    })
    try {
      renderer ??= new THREE.WebGLRenderer({
        canvas: document.createElement('canvas'),
        antialias: true,
        preserveDrawingBuffer: true,
      })
      renderer.setPixelRatio(1)
      renderer.setSize(options.width, options.height, false)
      renderer.toneMapping = THREE.ACESFilmicToneMapping
      renderer.toneMappingExposure = 0.95
      const camera = new THREE.PerspectiveCamera(30, options.width / options.height, 0.05, 50)
      built.frame(camera)
      renderer.render(built.scene, camera)
      const url = renderer.domElement.toDataURL(options.type ?? 'image/jpeg', 0.92)
      const slots: TableSnapshot['slots'] = {}
      for (const s of built.slots)
        slots[s.slot] = { card: pictureRect(s.card, camera), name: stripRect(s.name, camera) }
      return { url, slots }
    } finally {
      built.dispose()
    }
  }
  const next = queue.then(run, run)
  queue = next.catch(() => undefined)
  return next
}

/**
 * The 3D view of every table for the PPT: no names on the cards (the PPT writes them as editable
 * text over each card's name strip). A table whose picture fails keeps its slot diagram.
 */
export async function tableShots(
  tables: DisplayTable[],
  ctx: TableViewContext,
): Promise<DisplayTableShot[]> {
  const shots: DisplayTableShot[] = []
  for (const table of tables) {
    try {
      const aspect = shotAspect(table)
      const shot = await snapshotTable(table, ctx, {
        width: Math.round(aspect >= 1 ? 2000 : 1600 * aspect),
        height: Math.round(aspect >= 1 ? 2000 / aspect : 1600),
        names: false,
      })
      shots.push({
        table: table.sourceId,
        image: shot.url.slice(shot.url.indexOf(',') + 1),
        names: Object.fromEntries(Object.entries(shot.slots).map(([slot, r]) => [slot, r.name])),
      })
    } catch {
      // No WebGL here: the PPT falls back to the slot diagrams.
    }
  }
  return shots
}
