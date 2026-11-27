import {
  EPSILON_M,
  MIN_FIXTURE_M,
  advertisingScreenName,
  closestPointOnSegment,
  distance,
  edges,
  modelWithinBoundary,
  modelBox,
  itemElevation,
  portraitScreenFootprint,
  isWallArt,
  resizeWallArt,
  wallArtSize,
  defaultElevation,
  defaultEmbeddedElevation,
  displayPanelSnap,
  isDisplayPanel,
  embeddedSnap,
  defaultFixtureHeight,
  fixtureSnapTargets,
  interiorPoint,
  itemMount,
  mountedWall,
  roundM,
  scaleItem,
  isCustomLogo,
  customLogoAsset,
  customLogoSize,
  changeLogoText,
  DEFAULT_LOGO_TEXT,
  nextFixtureId,
  normalizeRotation,
  rotatedFootprint,
  snapFixturePosition,
  snapFixtureRect,
  turnItem,
  wallMountSnap,
  wallPlacementTarget,
} from '@store/shared'
import type {
  Asset,
  Fixture,
  FrontAxis,
  Installation,
  Layout,
  LayoutItem,
  Point,
  Polygon,
  Rect,
  ScreenOrientation,
  Space,
} from '@store/shared'
import { floorPlacementProblem } from './plan-editor/floor-placement.ts'
import { magnetSnap } from './snap.ts'

/** Drag and keyboard moves snap to 10 mm. */
export const SNAP_M = 0.01
/** Undo steps kept per editing session. */
export const HISTORY_LIMIT = 100

/** The screen rolls about its own centre. Its floor-plan heading and wall depth stay fixed. */
export function screenOrientationChange(
  item: LayoutItem,
  asset: Asset,
  orientation: ScreenOrientation,
  spaceHeight: number,
): LayoutItem | null {
  const mount = itemMount(item)
  if (
    !advertisingScreenName(asset.id) ||
    item.assetId !== asset.id ||
    item.function !== 'screen' ||
    (mount !== 'embedded' && mount !== 'wall' && mount !== 'ceiling') ||
    item.locked
  )
    return null
  const native = rotatedFootprint(asset, item.rotation)
  const size = orientation === 'portrait' ? portraitScreenFootprint(native, item.rotation) : native
  const h = roundM(size.h)
  if (item.h === h) return item
  const elevation = itemElevation(item) + (item.h - h) / 2
  if (elevation < -0.000001 || elevation + h > spaceHeight + 0.000001 || elevation > 20) return null
  return { ...item, w: roundM(size.w), d: roundM(size.d), h, elevation: Math.max(0, elevation) }
}

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
   * instead, turning its `front` (the model's) away from the chosen wall face. Pointer drags supply the
   * store outline separately so Alt only disables magnetic snapping.
   */
  | {
      type: 'move'
      id: string
      cx: number
      cz: number
      group?: string | undefined
      snapTo?: Space | null | undefined
      dragBoundary?: Polygon | undefined
      front?: FrontAxis | null | undefined
      asset?: Asset | undefined
    }
  | { type: 'nudge'; id: string; dx: number; dz: number }
  | { type: 'rotate'; id: string; asset?: Asset | undefined; by?: 90 | -90 | undefined }
  | {
      type: 'setScreenOrientation'
      id: string
      asset: Asset
      orientation: ScreenOrientation
      spaceHeight: number
    }
  /**
   * Turns a prop to any angle (the rotation handle, the 3D ring, the angle field); `group`
   * joins the steps of one drag into one undo step.
   */
  | { type: 'turn'; id: string; rotation: number; group?: string | undefined }
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
  | { type: 'resizeFixture'; id: string; rect: Rect }
  | { type: 'turnFixture'; id: string; rotation: number }
  /** Size, position or height typed into the properties panel. */
  | {
      type: 'updateFixture'
      id: string
      patch: Partial<Pick<Fixture, 'cx' | 'cz' | 'w' | 'd' | 'h'>>
    }
  /** A wall or ceiling piece added with `space` goes onto the nearest wall at a default height. */
  | { type: 'add'; asset: Asset; cx: number; cz: number; space?: Space | undefined }
  | { type: 'placeFurniture'; item: LayoutItem; space: Space; asset?: Asset | undefined }
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
  | { type: 'setLogoText'; id: string; text: string }
  /**
   * A LOGO resized uniformly (属性面板“宽度”, or dragged by an end or a corner: then `at` is
   * where it goes, see shared/scaling); a piece on a wall stays on it. `group` joins one drag.
   */
  | {
      type: 'scale'
      id: string
      asset: Asset
      scale: number
      space: Space
      front: FrontAxis | null
      at?: { cx: number; cz: number; elevation?: number | undefined } | undefined
      group?: string | undefined
    }
  | { type: 'undo' }
  | {
      type: 'resizeWallArt'
      id: string
      width: number
      height: number
      space: Space
      at?: { cx: number; cz: number; elevation?: number } | undefined
      group?: string | undefined
    }
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
  placed: Partial<Pick<LayoutItem, 'cx' | 'cz' | 'rotation' | 'w' | 'd' | 'elevation'>>,
  items: readonly LayoutItem[],
  space: Space,
  fixtures: readonly Fixture[] = [],
): LayoutItem {
  const next = { ...item, ...placed }
  // A built-in piece's default height does not depend on where it is (mountedElevation).
  if (
    placed.elevation === undefined &&
    itemMount(item) !== 'embedded' &&
    (item.elevation === undefined ||
      item.elevation === defaultElevation(item, items, space, fixtures))
  )
    next.elevation = defaultElevation(next, items, space, fixtures)
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
  fixtures: readonly Fixture[] = [],
  items: readonly LayoutItem[] = [],
  forceDefaultHeight = false,
) {
  if (mount === 'wall') {
    if (wallLogo(item, mount)) {
      return wallMountSnap(item, cx, cz, space, front, reach, fixtures, items, undefined, {
        defaultTop: true,
        preferPartitions: true,
        adding: forceDefaultHeight,
      })
    }
    const autoHeight =
      forceDefaultHeight ||
      item.elevation === undefined ||
      item.elevation === defaultElevation(item, items, space, fixtures)
    return wallMountSnap(item, cx, cz, space, front, reach, fixtures, items, (placed) =>
      autoHeight
        ? defaultElevation({ ...item, ...placed }, items, space, fixtures)
        : item.elevation!,
    )
  }
  if (mount === 'embedded') return embeddedSnap(item, cx, cz, space, front, reach)
  return null
}

/** Default height of a raised piece where it is. */
function mountedElevation(
  item: LayoutItem,
  items: readonly LayoutItem[],
  space: Space,
  fixtures: readonly Fixture[],
) {
  return itemMount(item) === 'embedded'
    ? defaultEmbeddedElevation(item, space)
    : defaultElevation(item, items, space, fixtures)
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
  fixtures: readonly Fixture[] = [],
): LayoutItem {
  if (!mount || mount === 'floor') return item
  let mounted: LayoutItem = { ...item, mount }
  const placed = snapToWall(
    mounted,
    mount,
    item.cx,
    item.cz,
    space,
    front,
    Infinity,
    fixtures,
    items,
    true,
  )
  if (placed) mounted = { ...mounted, ...placed }
  return {
    ...mounted,
    elevation: placed?.elevation ?? mountedElevation(mounted, items, space, fixtures),
  }
}

const withFixtures = (layout: Layout, fixtures: Fixture[]): Layout =>
  fixtures.length ? { ...layout, fixtures } : { ...layout, fixtures: undefined }

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

export interface ModelPlacementClick {
  point: Point
  normal?: Point
}

function wallLogo(item: Pick<LayoutItem, 'function' | 'name' | 'assetId'>, mount: Installation) {
  return mount === 'wall' && item.function === 'signage' && !isDisplayPanel(item)
}

export function needsWallPlacement(item: LayoutItem, asset?: Asset): boolean {
  return isDisplayPanel(item) || wallLogo(item, asset?.installation ?? itemMount(item))
}

/** Existing auto-placement remains available to callers; canvas placement uses the clicked face. */
export function placeCatalogItem(
  item: LayoutItem,
  layout: Layout,
  space: Space,
  click: ModelPlacementClick,
  asset?: Asset,
): LayoutItem | null {
  const [x, z] = click.point
  const mount = asset?.installation ?? itemMount(item)
  const positioned = { ...item, cx: snap(x), cz: snap(z) }
  if (!needsWallPlacement(item, asset))
    return mountAs(positioned, mount, asset?.front ?? null, layout.items, space, layout.fixtures)

  const target = wallPlacementTarget(
    click.point,
    space,
    layout.fixtures ?? [],
    layout.items,
    click.normal,
  )
  if (!target) return null
  const front = asset?.front ?? null
  if (isDisplayPanel(item)) {
    const panel = displayPanelSnap(item, x, z, space, front, layout.fixtures, layout.items, true, {
      target,
      defaultTop: true,
      preferPartitions: item.function === 'screen',
    })
    return panel ? { ...item, ...panel } : null
  }

  const logo = wallMountSnap(
    { ...item, mount: 'wall' },
    x,
    z,
    space,
    front,
    Infinity,
    layout.fixtures,
    layout.items,
    undefined,
    { target, defaultTop: true, preferPartitions: true, adding: true },
  )
  return logo ? { ...item, ...logo, mount: 'wall' } : null
}

type ModelPosition = Pick<LayoutItem, 'cx' | 'cz'>

/** Dragging and validation share the whole-footprint, one-metre allowance. */
function limitDrag<T extends ModelPosition>(
  position: T,
  item: LayoutItem,
  boundary: Polygon | undefined,
  asset: Asset | undefined,
): T {
  const first = boundary?.[0]
  if (!boundary || !first) return position
  const within = (point: ModelPosition) => {
    const candidate = { ...item, ...position, ...point }
    return modelWithinBoundary(
      {
        ...candidate,
        ...modelBox(candidate, item.placeholder ? undefined : asset),
      },
      boundary,
    )
  }
  if (within(position)) return position
  const point: Point = [position.cx, position.cz]
  let closest = first
  let shortest = distance(point, first)
  for (const [a, b] of edges(boundary)) {
    const candidate = closestPointOnSegment(point, a, b)
    const gap = distance(point, candidate)
    if (gap < shortest) {
      closest = candidate
      shortest = gap
    }
  }
  let start = { cx: closest[0], cz: closest[1] }
  if (!within(start)) start = { cx: item.cx, cz: item.cz }
  if (!within(start)) {
    // Old layouts may already be outside; use an interior anchor when one fits the model.
    const [cx, cz] = interiorPoint(boundary, { prefer: point })
    start = { cx, cz }
    if (!within(start)) return { ...position, cx: item.cx, cz: item.cz }
  }
  const dx = position.cx - start.cx
  const dz = position.cz - start.cz
  const at = (t: number): ModelPosition => ({
    cx: start.cx + dx * t,
    cz: start.cz + dz * t,
  })
  let low = 0
  let high = 1
  for (let step = 0; step < 24; step++) {
    const middle = (low + high) / 2
    if (within(at(middle))) low = middle
    else high = middle
  }
  const rounded = (t: number) => {
    const p = at(t)
    return { cx: roundM(p.cx), cz: roundM(p.cz) }
  }
  let end = rounded(low)
  if (!within(end)) end = rounded(Math.max(0, low - EPSILON_M / Math.hypot(dx, dz)))
  return { ...position, ...(within(end) ? end : start) }
}

export function catalogItem(layout: Layout, asset: Asset, cx: number, cz: number): LayoutItem {
  const size = rotatedFootprint(asset, 0)
  return {
    id: nextItemId(layout, asset.function),
    assetId: asset.id,
    function: asset.function,
    name: (advertisingScreenName(asset.id) ?? asset.name).slice(0, 100),
    cx: snap(cx),
    cz: snap(cz),
    rotation: 0,
    w: roundM(size.w),
    d: roundM(size.d),
    h: roundM(size.h),
    // Without a web model the item is a true-size placeholder (see assetFitProblem).
    placeholder: !asset.placeable,
    locked: false,
    ...(isCustomLogo({ assetId: asset.id }) ? { logoText: DEFAULT_LOGO_TEXT } : {}),
  }
}

function appendItem(state: EditorState, item: LayoutItem): EditorState {
  return commit(state, { ...state.layout, items: [...state.layout.items, item] }, null, {
    selectedId: item.id,
  })
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
          if (action.dragBoundary && (!Number.isFinite(cx) || !Number.isFinite(cz))) return item
          const limitPosition = (position: ModelPosition) =>
            limitDrag(position, item, action.dragBoundary, action.asset)
          if (isDisplayPanel(item)) {
            if (cx === item.cx && cz === item.cz) return item
            const placed =
              action.snapTo &&
              displayPanelSnap(
                item,
                cx,
                cz,
                action.snapTo,
                action.front ?? null,
                state.layout.fixtures,
                state.layout.items,
                false,
                { defaultTop: true, preferPartitions: item.function === 'screen' },
              )
            if (placed && limitPosition(placed) === placed) return { ...item, ...placed }
            const position = limitPosition({ cx: snap(cx), cz: snap(cz) })
            const elevation = itemElevation(item)
            if (
              position.cx === item.cx &&
              position.cz === item.cz &&
              item.mount === 'ceiling' &&
              item.elevation === elevation
            )
              return item
            return { ...item, ...position, mount: 'ceiling', elevation }
          }
          let exactX = false
          let exactZ = false
          if (action.snapTo) {
            const mount = itemMount(item)
            const placed = snapToWall(
              item,
              mount,
              cx,
              cz,
              action.snapTo,
              action.front ?? null,
              undefined,
              state.layout.fixtures,
              state.layout.items,
            )
            if (placed && limitPosition(placed) === placed)
              return relocate(
                item,
                placed,
                state.layout.items,
                action.snapTo,
                state.layout.fixtures,
              )
          }
          if (action.snapTo) {
            const snapped = magnetSnap(
              item,
              cx,
              cz,
              state.layout.items,
              action.snapTo,
              itemMount(item) === 'floor' ? state.layout.fixtures : [],
            )
            ;({ cx, cz } = snapped)
            exactX = snapped.snappedX
            exactZ = snapped.snappedZ
          }
          // A snapped axis keeps millimetres so the prop sits exactly against the wall.
          const next = limitPosition({
            cx: exactX ? roundM(cx) : snap(cx),
            cz: exactZ ? roundM(cz) : snap(cz),
          })
          if (action.snapTo && itemMount(item) !== 'floor')
            return relocate(item, next, state.layout.items, action.snapTo, state.layout.fixtures)
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
          if (isCustomLogo(item))
            return {
              ...item,
              rotation,
              ...customLogoSize(item.logoText ?? DEFAULT_LOGO_TEXT, item.scale ?? 1, rotation),
            }
          const native = isWallArt(item)
            ? rotatedFootprint({ footprint: wallArtSize(item) }, rotation)
            : action.asset
              ? rotatedFootprint(action.asset, rotation)
              : { w: item.d, d: item.w, h: item.h }
          const size =
            action.asset &&
            advertisingScreenName(action.asset.id) &&
            item.h > action.asset.footprint.h
              ? portraitScreenFootprint(native, rotation)
              : native
          const turned = {
            ...item,
            rotation,
            w: roundM(size.w),
            d: roundM(size.d),
            h: roundM(size.h),
          }
          // A resized LOGO keeps its scale through the turn.
          const actualAsset = isCustomLogo(item)
            ? customLogoAsset(item.logoText ?? DEFAULT_LOGO_TEXT)
            : action.asset
          return actualAsset && item.scale ? scaleItem(turned, actualAsset, item.scale) : turned
        },
        null,
      )
    case 'turn':
      // Width and depth follow the nearest quarter turn; size and LOGO scale are kept.
      return changeItem(
        state,
        action.id,
        (item) =>
          item.locked || !Number.isFinite(action.rotation) ? item : turnItem(item, action.rotation),
        action.group ?? null,
      )
    case 'setMount':
      return changeItem(
        state,
        action.id,
        (item) =>
          item.locked || itemMount(item) === action.mount || isDisplayPanel(item)
            ? item
            : mountAs(
                item,
                action.mount,
                action.front,
                state.layout.items,
                action.space,
                state.layout.fixtures,
              ),
        null,
      )
    case 'setScreenOrientation':
      return changeItem(
        state,
        action.id,
        (item) =>
          screenOrientationChange(item, action.asset, action.orientation, action.spaceHeight) ??
          item,
        null,
      )
    case 'resizeWallArt':
      return changeItem(
        state,
        action.id,
        (item) => {
          if (item.locked || !isWallArt(item)) return item
          const resized = resizeWallArt(item, action.width, action.height)
          const at = action.at
          const next = at
            ? {
                ...resized,
                cx: roundM(at.cx),
                cz: roundM(at.cz),
                ...(at.elevation !== undefined
                  ? { elevation: roundM(Math.max(0, at.elevation)) }
                  : {}),
              }
            : resized
          if (itemMount(item) === 'ceiling') return next
          const placed = displayPanelSnap(
            next,
            next.cx,
            next.cz,
            action.space,
            '+Z',
            state.layout.fixtures,
            state.layout.items,
          )
          return placed ? { ...next, ...placed } : next
        },
        action.group ?? null,
      )
    case 'setLogoText':
      return changeItem(state, action.id, (item) => changeLogoText(item, action.text), null)
    case 'scale':
      return changeItem(
        state,
        action.id,
        (item) => {
          if (item.locked || !Number.isFinite(action.scale)) return item
          const logoAsset = isCustomLogo(item)
            ? customLogoAsset(item.logoText ?? DEFAULT_LOGO_TEXT)
            : action.asset
          const resized = scaleItem(item, logoAsset, action.scale)
          const at = action.at
          const scaled =
            at && resized !== item
              ? {
                  ...resized,
                  cx: roundM(at.cx),
                  cz: roundM(at.cz),
                  ...(at.elevation !== undefined && itemMount(item) !== 'floor'
                    ? { elevation: roundM(Math.max(0, at.elevation)) }
                    : {}),
                }
              : resized
          if (
            scaled === item ||
            itemMount(item) !== 'wall' ||
            !mountedWall(item, action.space, state.layout.fixtures, state.layout.items)
          )
            return scaled
          // The back stays on the wall as the depth changes.
          const placed = wallMountSnap(
            scaled,
            scaled.cx,
            scaled.cz,
            action.space,
            action.front,
            undefined,
            state.layout.fixtures,
            state.layout.items,
          )
          return placed ? { ...scaled, cx: placed.cx, cz: placed.cz } : scaled
        },
        action.group ?? `scale:${action.id}`,
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
            const targets = fixtureSnapTargets(
              action.snapTo,
              'island',
              state.layout.items,
              state.layout.fixtures?.filter((fixture) => fixture.id !== f.id) ?? [],
              true,
            )
            ;[cx, cz] = snapFixturePosition({ ...f, cx, cz }, targets)
          }
          return cx === f.cx && cz === f.cz ? f : { ...f, cx, cz }
        },
        action.group ?? null,
      )
    case 'resizeFixture': {
      const { minX, maxX, minZ, maxZ } = action.rect
      const w = roundM(maxX - minX)
      const d = roundM(maxZ - minZ)
      if (
        ![minX, maxX, minZ, maxZ].every(Number.isFinite) ||
        w < MIN_FIXTURE_M ||
        d < MIN_FIXTURE_M
      )
        return state
      return changeFixture(
        state,
        action.id,
        (f) => {
          const cx = roundM((minX + maxX) / 2)
          const cz = roundM((minZ + maxZ) / 2)
          return w === f.w && d === f.d && cx === f.cx && cz === f.cz ? f : { ...f, w, d, cx, cz }
        },
        null,
      )
    }
    case 'turnFixture': {
      if (!Number.isFinite(action.rotation)) return state
      const rotation = normalizeRotation(action.rotation)
      return changeFixture(
        state,
        action.id,
        (fixture) => (rotation === (fixture.rotation ?? 0) ? fixture : { ...fixture, rotation }),
        null,
      )
    }
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
      const item = catalogItem(state.layout, action.asset, action.cx, action.cz)
      const space = action.space
      let added = item
      if (space && isDisplayPanel(item)) {
        const elevation = defaultEmbeddedElevation(item, space)
        const placed = displayPanelSnap(
          { ...item, elevation },
          item.cx,
          item.cz,
          space,
          action.asset.front,
          state.layout.fixtures,
          state.layout.items,
          true,
          { defaultTop: true, preferPartitions: item.function === 'screen' },
        )
        added = { ...item, elevation, mount: 'ceiling', ...placed }
      } else if (space) {
        added = mountAs(
          item,
          action.asset.installation,
          action.asset.front,
          state.layout.items,
          space,
          state.layout.fixtures,
        )
      }
      return appendItem(state, added)
    }
    case 'placeFurniture': {
      const item = { ...action.item, id: nextItemId(state.layout, action.item.function) }
      if (floorPlacementProblem(state.layout, action.space, item, 'point', action.asset))
        return state
      return appendItem(state, item)
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
