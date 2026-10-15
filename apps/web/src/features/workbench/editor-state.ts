import {
  MIN_FIXTURE_M,
  defaultElevation,
  defaultEmbeddedElevation,
  embeddedSnap,
  defaultFixtureHeight,
  fixtureRect,
  interiorPoint,
  itemMount,
  mountedWall,
  roundM,
  scaleItem,
  nextFixtureId,
  rotatedFootprint,
  snapFixtureRect,
  wallMountSnap,
} from '@store/shared'
import type {
  Asset,
  Fixture,
  FrontAxis,
  Installation,
  Layout,
  LayoutItem,
  Point,
  Rect,
  Space,
} from '@store/shared'
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
  /** Removes a prop or a partition. */
  | { type: 'remove'; id: string }
  /** 画空心隔板: a dragged rectangle, its edges stuck to walls and cabinets of `snapTo`. */
  | { type: 'addFixture'; rect: Rect; space: Space; snap: boolean }
  | {
      type: 'moveFixture'
      id: string
      cx: number
      cz: number
      group?: string | undefined
      snapTo?: Space | null | undefined
    }
  /** Size, position or height typed into the properties panel. */
  | {
      type: 'updateFixture'
      id: string
      patch: Partial<Pick<Fixture, 'cx' | 'cz' | 'w' | 'd' | 'h'>>
    }
  /** A wall or ceiling piece added with `space` goes onto the nearest wall at a default height. */
  | { type: 'add'; asset: Asset; cx: number; cz: number; space?: Space | undefined }
  /** 贴墙 ⇄ 内嵌 from the properties panel: the piece moves onto or into the nearest wall. */
  | {
      type: 'setMount'
      id: string
      mount: Installation
      space: Space
      front: FrontAxis | null
    }
  /** Height of a wall or ceiling piece above the floor. */
  | { type: 'elevate'; id: string; elevation: number }
  /** A LOGO resized uniformly (属性面板“宽度”); a piece on a wall stays on it. */
  | {
      type: 'scale'
      id: string
      asset: Asset
      scale: number
      space: Space
      front: FrontAxis | null
    }
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
  // A built-in piece's default height does not depend on where it is (mountedElevation).
  if (
    itemMount(item) !== 'embedded' &&
    (item.elevation === undefined || item.elevation === defaultElevation(item, items, space))
  )
    next.elevation = defaultElevation(next, items, space)
  const same = (['cx', 'cz', 'rotation', 'w', 'd', 'elevation'] as const).every(
    (k) => next[k] === item[k],
  )
  return same ? item : next
}

/** Where a wall or built-in piece snaps to near (cx, cz), or null. */
function snapToWall(
  item: LayoutItem,
  mount: Installation,
  cx: number,
  cz: number,
  space: Space,
  front: FrontAxis | null,
  reach?: number,
) {
  if (mount === 'wall') return wallMountSnap(item, cx, cz, space, front, reach)
  if (mount === 'embedded') return embeddedSnap(item, cx, cz, space, front, reach)
  return null
}

/** Default height of a raised piece where it is. */
function mountedElevation(item: LayoutItem, items: readonly LayoutItem[], space: Space) {
  return itemMount(item) === 'embedded'
    ? defaultEmbeddedElevation(item, space)
    : defaultElevation(item, items, space)
}

/**
 * A piece given another installation (a new one from the catalogue, or 贴墙 ⇄ 内嵌 switched in
 * the properties panel): a wall or built-in piece goes onto the nearest wall, a ceiling piece
 * hangs, each at its default height.
 */
function mountAs(
  item: LayoutItem,
  mount: Installation | null,
  front: FrontAxis | null,
  items: readonly LayoutItem[],
  space: Space,
): LayoutItem {
  if (!mount || mount === 'floor') return item
  let mounted: LayoutItem = { ...item, mount }
  const placed = snapToWall(mounted, mount, item.cx, item.cz, space, front, Infinity)
  if (placed) mounted = { ...mounted, ...placed }
  return { ...mounted, elevation: mountedElevation(mounted, items, space) }
}

const withFixtures = (layout: Layout, fixtures: Fixture[]): Layout =>
  fixtures.length ? { ...layout, fixtures } : { ...layout, fixtures: undefined }

/** The smaller non-zero of two edge shifts (0 when neither edge snapped). */
const nearestShift = (a: number, b: number) =>
  a === 0 ? b : b === 0 ? a : Math.abs(a) <= Math.abs(b) ? a : b

function changeFixture(
  state: EditorState,
  id: string,
  change: (fixture: Fixture) => Fixture,
  key: string | null,
): EditorState {
  let changed = false
  const fixtures = (state.layout.fixtures ?? []).map((f) => {
    if (f.id !== id) return f
    const next = change(f)
    if (next !== f) changed = true
    return next
  })
  return changed ? commit(state, withFixtures(state.layout, fixtures), key) : state
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
            const mount = itemMount(item)
            const placed = snapToWall(item, mount, cx, cz, action.snapTo, action.front ?? null)
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
          const rotation = (((item.rotation + (action.by ?? 90)) % 360) + 360) % 360
          const size = action.asset
            ? rotatedFootprint(action.asset, rotation)
            : { w: item.d, d: item.w, h: item.h }
          const turned = {
            ...item,
            rotation,
            w: roundM(size.w),
            d: roundM(size.d),
            h: roundM(size.h),
          }
          // A resized LOGO keeps its scale through the turn.
          return action.asset && item.scale ? scaleItem(turned, action.asset, item.scale) : turned
        },
        null,
      )
    case 'setMount':
      return changeItem(
        state,
        action.id,
        (item) =>
          item.locked || itemMount(item) === action.mount
            ? item
            : mountAs(item, action.mount, action.front, state.layout.items, action.space),
        null,
      )
    case 'scale':
      return changeItem(
        state,
        action.id,
        (item) => {
          if (item.locked || !Number.isFinite(action.scale)) return item
          const scaled = scaleItem(item, action.asset, action.scale)
          if (scaled === item || itemMount(item) !== 'wall' || !mountedWall(item, action.space))
            return scaled
          // The back stays on the wall as the depth changes.
          const placed = wallMountSnap(scaled, scaled.cx, scaled.cz, action.space, action.front)
          return placed ? { ...scaled, cx: placed.cx, cz: placed.cz } : scaled
        },
        `scale:${action.id}`,
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
      const fixtures = state.layout.fixtures?.filter((f) => f.id !== action.id)
      if (fixtures && fixtures.length !== state.layout.fixtures?.length)
        return commit(state, withFixtures(state.layout, fixtures), null, { selectedId: null })
      const items = state.layout.items.filter((item) => item.id !== action.id || item.locked)
      if (items.length === state.layout.items.length) return state
      return commit(state, { ...state.layout, items }, null, { selectedId: null })
    }
    case 'addFixture': {
      const rect = action.snap
        ? snapFixtureRect(action.rect, action.space, state.layout.items)
        : action.rect
      const w = roundM(rect.maxX - rect.minX)
      const d = roundM(rect.maxZ - rect.minZ)
      if (w < MIN_FIXTURE_M || d < MIN_FIXTURE_M) return state
      const fixture: Fixture = {
        id: nextFixtureId(state.layout),
        kind: 'hollow_partition',
        cx: roundM((rect.minX + rect.maxX) / 2),
        cz: roundM((rect.minZ + rect.maxZ) / 2),
        w,
        d,
        h: defaultFixtureHeight(rect, state.layout.items, action.space),
      }
      const fixtures = [...(state.layout.fixtures ?? []), fixture]
      return commit(state, withFixtures(state.layout, fixtures), null, { selectedId: fixture.id })
    }
    case 'moveFixture':
      return changeFixture(
        state,
        action.id,
        (f) => {
          let cx = snap(action.cx)
          let cz = snap(action.cz)
          if (action.snapTo) {
            // Whichever edge comes near a wall or cabinet pulls the whole box onto it.
            const moved = fixtureRect({ ...f, cx, cz })
            const stuck = snapFixtureRect(moved, action.snapTo, state.layout.items)
            cx = roundM(cx + nearestShift(stuck.minX - moved.minX, stuck.maxX - moved.maxX))
            cz = roundM(cz + nearestShift(stuck.minZ - moved.minZ, stuck.maxZ - moved.maxZ))
          }
          return cx === f.cx && cz === f.cz ? f : { ...f, cx, cz }
        },
        action.group ?? null,
      )
    case 'updateFixture':
      return changeFixture(
        state,
        action.id,
        (f) => {
          const next = { ...f }
          for (const [key, value] of Object.entries(action.patch) as [
            keyof typeof action.patch,
            number,
          ][]) {
            if (!Number.isFinite(value)) continue
            next[key] =
              key === 'cx' || key === 'cz' ? roundM(value) : roundM(Math.max(MIN_FIXTURE_M, value))
          }
          return next
        },
        `fixture:${action.id}`,
      )
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
        ? mountAs(
            item,
            action.asset.installation,
            action.asset.front,
            state.layout.items,
            action.space,
          )
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
