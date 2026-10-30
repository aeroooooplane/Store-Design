import type { Market, SiStyle } from '../enums.ts'
import type { DisplayEdits, DisplayTaskState } from './api.ts'
import { planDisplay, sideEntrance } from './engine.ts'
import type { DisplayTable } from './engine.ts'
import type { DisplayRules } from './rules.ts'

export const EDITED_NOTE = '已按人工修改调整'

/** Applies the user's slot and module edits on top of the planned tables. */
export function applyDisplayEdits(tables: DisplayTable[], edits: DisplayEdits): DisplayTable[] {
  return tables.map((t) => {
    const slots = edits.slots[t.sourceId]
    const modules = edits.modules[t.sourceId]
    if (!slots && !modules) return t
    return {
      ...t,
      slots: t.slots.map((s) =>
        slots && s.slot in slots ? { ...s, unit: slots[s.slot] ?? null } : s,
      ),
      modules: modules ?? t.modules,
      notes: [...t.notes, EDITED_NOTE],
    }
  })
}

/**
 * The display of an uploaded plan (workflow 2): the tables in pixels of the plan picture, the
 * entrance on one side of it, the guide's layouts and the user's edits. The browser preview and
 * the exported PPT both come from here, so their numbering agrees.
 */
export function planTaskTables(
  rules: DisplayRules,
  task: {
    market: Market
    siStyle?: SiStyle
    plan: { width: number; height: number } | null
    state: Pick<DisplayTaskState, 'entrance' | 'tables' | 'edits'>
  },
): DisplayTable[] {
  const width = task.plan?.width ?? 1
  const height = task.plan?.height ?? 1
  const inputs = task.state.tables.map((t) => ({
    id: t.id,
    kind: t.kind,
    cx: t.x * width,
    cz: t.y * height,
    // 0 × 0 for a table placed by hand: its size is unknown (see planDisplay).
    w: t.w * width,
    d: t.h * height,
  }))
  const tables = planDisplay(rules, {
    tables: inputs,
    entrance: sideEntrance(task.state.entrance, inputs),
    market: task.market,
    siStyle: task.siStyle,
    moduleScheme: task.state.edits.moduleScheme,
    landscapeEnd: task.state.edits.landscapeEnd,
    orientation: task.state.edits.orientation,
  })
  return applyDisplayEdits(tables, task.state.edits)
}
