import { roundM, rotatedFootprint } from '@store/shared'
import type { Asset, Layout, LayoutItem, Rotation } from '@store/shared'

/** Drag and keyboard moves snap to 10 mm. */
export const SNAP_M = 0.01

export interface EditorState {
  layout: Layout
  selectedId: string | null
  /** Changed since the last save to the server. */
  dirty: boolean
}

export type EditorAction =
  | { type: 'load'; layout: Layout }
  | { type: 'select'; id: string | null }
  | { type: 'move'; id: string; cx: number; cz: number }
  | { type: 'nudge'; id: string; dx: number; dz: number }
  | { type: 'rotate'; id: string; asset?: Asset | undefined }
  | { type: 'remove'; id: string }
  | { type: 'add'; asset: Asset; cx: number; cz: number }
  /** The layout that reached the server; later edits keep the state dirty. */
  | { type: 'saved'; layout: Layout }

export const snap = (value: number): number => roundM(Math.round(value / SNAP_M) * SNAP_M)

function update(
  state: EditorState,
  id: string,
  change: (item: LayoutItem) => LayoutItem,
): EditorState {
  let changed = false
  const items = state.layout.items.map((item) => {
    if (item.id !== id) return item
    changed = true
    return change(item)
  })
  return changed ? { ...state, layout: { ...state.layout, items }, dirty: true } : state
}

/** A fresh id for a new item of this function, e.g. island_table-3. */
export function nextItemId(layout: Layout, fn: string): string {
  const used = new Set(layout.items.map((i) => i.id))
  let n = layout.items.filter((i) => i.function === fn).length + 1
  while (used.has(`${fn}-${n}`)) n++
  return `${fn}-${n}`
}

export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case 'load':
      return { layout: action.layout, selectedId: null, dirty: false }
    case 'select':
      return { ...state, selectedId: action.id }
    case 'move':
      return update(state, action.id, (item) =>
        item.locked ? item : { ...item, cx: snap(action.cx), cz: snap(action.cz) },
      )
    case 'nudge':
      return update(state, action.id, (item) =>
        item.locked
          ? item
          : { ...item, cx: snap(item.cx + action.dx), cz: snap(item.cz + action.dz) },
      )
    case 'rotate':
      // Quarter turn about the centre; a real model keeps its true size, a placeholder swaps sides.
      return update(state, action.id, (item) => {
        if (item.locked) return item
        const rotation = ((item.rotation + 90) % 360) as Rotation
        const size = action.asset
          ? rotatedFootprint(action.asset, rotation)
          : { w: item.d, d: item.w, h: item.h }
        return { ...item, rotation, w: roundM(size.w), d: roundM(size.d), h: roundM(size.h) }
      })
    case 'remove': {
      const items = state.layout.items.filter((item) => item.id !== action.id || item.locked)
      if (items.length === state.layout.items.length) return state
      return { layout: { ...state.layout, items }, selectedId: null, dirty: true }
    }
    case 'add': {
      const id = nextItemId(state.layout, action.asset.function)
      const size = rotatedFootprint(action.asset, 0)
      const item: LayoutItem = {
        id,
        assetId: action.asset.id,
        function: action.asset.function,
        name: action.asset.name.slice(0, 100),
        cx: snap(action.cx),
        cz: snap(action.cz),
        rotation: 0,
        w: roundM(size.w),
        d: roundM(size.d),
        h: roundM(size.h),
        // Without a web model the item is a true-size placeholder (see assetFitProblem).
        placeholder: !action.asset.placeable,
        locked: false,
      }
      return {
        layout: { ...state.layout, items: [...state.layout.items, item] },
        selectedId: id,
        dirty: true,
      }
    }
    case 'saved':
      return state.layout === action.layout ? { ...state, dirty: false } : state
  }
}
