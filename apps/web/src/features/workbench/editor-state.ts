import { roundM, rotatedFootprint } from '@store/shared'
import type { Asset, Layout, LayoutItem, Rotation, Space } from '@store/shared'
import { magnetSnap } from './snap.ts'

/** Drag and keyboard moves snap to 10 mm. */
export const SNAP_M = 0.01
/** Undo steps kept per editing session. */
export const HISTORY_LIMIT = 100

export interface EditorState {
  layout: Layout
  selectedId: string | null
  /** Changed since the last save to the server. */
  dirty: boolean
  /** Earlier layouts (oldest first) and undone ones (most recent last) for undo / redo. */
  past: Layout[]
  future: Layout[]
  /** Consecutive edits with the same key (one drag, a run of nudges) form one undo step. */
  lastKey: string | null
}

export type EditorAction =
  | { type: 'load'; layout: Layout }
  | { type: 'select'; id: string | null }
  /**
   * `group` joins the moves of one drag into one undo step; `snapTo` turns on magnetic
   * snapping to the walls of this space and to other props.
   */
  | {
      type: 'move'
      id: string
      cx: number
      cz: number
      group?: string | undefined
      snapTo?: Space | null | undefined
    }
  | { type: 'nudge'; id: string; dx: number; dz: number }
  | { type: 'rotate'; id: string; asset?: Asset | undefined; by?: 90 | -90 | undefined }
  | { type: 'remove'; id: string }
  | { type: 'add'; asset: Asset; cx: number; cz: number }
  | { type: 'undo' }
  | { type: 'redo' }
  /** The layout that reached the server; later edits keep the state dirty. */
  | { type: 'saved'; layout: Layout }

export const snap = (value: number): number => roundM(Math.round(value / SNAP_M) * SNAP_M)

export function initialEditorState(layout: Layout): EditorState {
  return { layout, selectedId: null, dirty: false, past: [], future: [], lastKey: null }
}

/** Records the change from `state.layout` to `layout` as an undo step (or extends the last one). */
function commit(
  state: EditorState,
  layout: Layout,
  key: string | null,
  patch: Partial<EditorState> = {},
): EditorState {
  if (layout === state.layout) return { ...state, ...patch }
  const extend = key !== null && key === state.lastKey
  const past = extend ? state.past : [...state.past, state.layout].slice(-HISTORY_LIMIT)
  return { ...state, ...patch, layout, past, future: [], lastKey: key, dirty: true }
}

function changeItem(
  state: EditorState,
  id: string,
  change: (item: LayoutItem) => LayoutItem,
  key: string | null,
): EditorState {
  let changed = false
  const items = state.layout.items.map((item) => {
    if (item.id !== id) return item
    const next = change(item)
    if (next !== item) changed = true
    return next
  })
  return changed ? commit(state, { ...state.layout, items }, key) : state
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
      return initialEditorState(action.layout)
    case 'select':
      return { ...state, selectedId: action.id, lastKey: null }
    case 'move':
      return changeItem(
        state,
        action.id,
        (item) => {
          if (item.locked) return item
          let { cx, cz } = action
          let exactX = false
          let exactZ = false
          if (action.snapTo) {
            const snapped = magnetSnap(item, cx, cz, state.layout.items, action.snapTo)
            ;({ cx, cz } = snapped)
            exactX = snapped.snappedX
            exactZ = snapped.snappedZ
          }
          // A snapped axis keeps millimetres so the prop sits exactly against the wall.
          const next = { cx: exactX ? roundM(cx) : snap(cx), cz: exactZ ? roundM(cz) : snap(cz) }
          return next.cx === item.cx && next.cz === item.cz ? item : { ...item, ...next }
        },
        action.group ?? null,
      )
    case 'nudge':
      return changeItem(
        state,
        action.id,
        (item) =>
          item.locked
            ? item
            : { ...item, cx: snap(item.cx + action.dx), cz: snap(item.cz + action.dz) },
        `nudge:${action.id}`,
      )
    case 'rotate':
      // Quarter turn about the centre; a real model keeps its true size, a placeholder swaps sides.
      return changeItem(
        state,
        action.id,
        (item) => {
          if (item.locked) return item
          const rotation = ((((item.rotation + (action.by ?? 90)) % 360) + 360) % 360) as Rotation
          const size = action.asset
            ? rotatedFootprint(action.asset, rotation)
            : { w: item.d, d: item.w, h: item.h }
          return { ...item, rotation, w: roundM(size.w), d: roundM(size.d), h: roundM(size.h) }
        },
        null,
      )
    case 'remove': {
      const items = state.layout.items.filter((item) => item.id !== action.id || item.locked)
      if (items.length === state.layout.items.length) return state
      return commit(state, { ...state.layout, items }, null, { selectedId: null })
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
      return commit(state, { ...state.layout, items: [...state.layout.items, item] }, null, {
        selectedId: id,
      })
    }
    case 'undo': {
      const previous = state.past[state.past.length - 1]
      if (!previous) return state
      return {
        ...state,
        layout: previous,
        past: state.past.slice(0, -1),
        future: [...state.future, state.layout],
        lastKey: null,
        dirty: true,
        selectedId: previous.items.some((i) => i.id === state.selectedId) ? state.selectedId : null,
      }
    }
    case 'redo': {
      const next = state.future[state.future.length - 1]
      if (!next) return state
      return {
        ...state,
        layout: next,
        past: [...state.past, state.layout],
        future: state.future.slice(0, -1),
        lastKey: null,
        dirty: true,
        selectedId: next.items.some((i) => i.id === state.selectedId) ? state.selectedId : null,
      }
    }
    case 'saved':
      return state.layout === action.layout ? { ...state, dirty: false } : state
  }
}
