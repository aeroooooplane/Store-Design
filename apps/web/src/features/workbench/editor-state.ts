import {
  defaultElevation,
  interiorPoint,
  itemMount,
  roundM,
  rotatedFootprint,
  wallMountSnap,
} from '@store/shared'
import type { Asset, FrontAxis, Layout, LayoutItem, Point, Rotation, Space } from '@store/shared'
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
   * snapping to the walls of this space and to other props. A wall piece snaps onto the wall
   * instead, turning its `front` (the model's) into the shop.
   */
  | {
      type: 'move'
      id: string
      cx: number
      cz: number
      group?: string | undefined
      snapTo?: Space | null | undefined
      front?: FrontAxis | null | undefined
    }
  | { type: 'nudge'; id: string; dx: number; dz: number }
  | { type: 'rotate'; id: string; asset?: Asset | undefined; by?: 90 | -90 | undefined }
  | { type: 'remove'; id: string }
  /** A wall or ceiling piece added with `space` goes onto the nearest wall at a default height. */
  | { type: 'add'; asset: Asset; cx: number; cz: number; space?: Space | undefined }
  /** Height of a wall or ceiling piece above the floor. */
  | { type: 'elevate'; id: string; elevation: number }
  | { type: 'undo' }
  | { type: 'redo' }
  /** The layout that reached the server; later edits keep the state dirty. */
  | { type: 'saved'; layout: Layout }

export const snap = (value: number): number => roundM(Math.round(value / SNAP_M) * SNAP_M)

/**
 * Where a model picked from the catalogue lands: the point of the floor farthest from the walls
 * (the centre of a rectangle), so it starts inside L and U shaped shops too.
 */
export function newItemPoint(space: Space): Point {
  return interiorPoint(space.boundary)
}

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

/**
 * A wall or ceiling piece moved (each step of a drag). Its height follows the props below it
 * as long as it is still at the default height of where it was; a height typed in stays.
 */
function relocate(
  item: LayoutItem,
  placed: Partial<Pick<LayoutItem, 'cx' | 'cz' | 'rotation' | 'w' | 'd'>>,
  items: readonly LayoutItem[],
  space: Space,
): LayoutItem {
  const next = { ...item, ...placed }
  if (item.elevation === undefined || item.elevation === defaultElevation(item, items, space))
    next.elevation = defaultElevation(next, items, space)
  const same = (['cx', 'cz', 'rotation', 'w', 'd', 'elevation'] as const).every(
    (k) => next[k] === item[k],
  )
  return same ? item : next
}

/** A new wall piece goes onto the wall nearest to where it lands; ceiling pieces hang. */
function mountNew(
  item: LayoutItem,
  asset: Asset,
  items: readonly LayoutItem[],
  space: Space,
): LayoutItem {
  const mount = asset.installation
  if (mount !== 'wall' && mount !== 'ceiling') return item
  let mounted: LayoutItem = { ...item, mount }
  if (mount === 'wall') {
    const placed = wallMountSnap(item, item.cx, item.cz, space, asset.front, Infinity)
    if (placed) mounted = { ...mounted, ...placed }
  }
  return { ...mounted, elevation: defaultElevation(mounted, items, space) }
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
          if (action.snapTo && itemMount(item) === 'wall') {
            const placed = wallMountSnap(item, cx, cz, action.snapTo, action.front ?? null)
            if (placed) return relocate(item, placed, state.layout.items, action.snapTo)
          }
          if (action.snapTo) {
            const snapped = magnetSnap(item, cx, cz, state.layout.items, action.snapTo)
            ;({ cx, cz } = snapped)
            exactX = snapped.snappedX
            exactZ = snapped.snappedZ
          }
          // A snapped axis keeps millimetres so the prop sits exactly against the wall.
          const next = { cx: exactX ? roundM(cx) : snap(cx), cz: exactZ ? roundM(cz) : snap(cz) }
          if (action.snapTo && itemMount(item) !== 'floor')
            return relocate(item, next, state.layout.items, action.snapTo)
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
    case 'elevate':
      return changeItem(
        state,
        action.id,
        (item) =>
          item.locked || itemMount(item) === 'floor' || !Number.isFinite(action.elevation)
            ? item
            : { ...item, elevation: roundM(Math.min(20, Math.max(0, action.elevation))) },
        `elevate:${action.id}`,
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
      const added = action.space
        ? mountNew(item, action.asset, state.layout.items, action.space)
        : item
      return commit(state, { ...state.layout, items: [...state.layout.items, added] }, null, {
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
