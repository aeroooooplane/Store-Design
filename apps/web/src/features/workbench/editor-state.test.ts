import { describe, expect, it } from 'vitest'
import {
  distanceToBoundary,
  LayoutSchema,
  locatePoint,
  rectangleSpace,
  validateLayout,
} from '@store/shared'
import type { Asset, Layout, LayoutItem } from '@store/shared'
import { makeAsset } from '../../test-utils/factories.ts'
import {
  catalogItem,
  editorReducer,
  initialEditorState,
  newItemPoint,
  nextItemId,
  snap,
} from './editor-state.ts'
import type { EditorState } from './editor-state.ts'
import { nearbyFurniture, pointPlacedAsset } from './plan-editor/floor-placement.ts'

function item(overrides: Partial<LayoutItem> = {}): LayoutItem {
  return {
    id: 'island_table-1',
    assetId: 'asset-1',
    function: 'island_table',
    name: '中岛桌',
    cx: 2,
    cz: 2,
    rotation: 0,
    w: 1.8,
    d: 0.9,
    h: 0.9,
    placeholder: false,
    locked: false,
    ...overrides,
  }
}

function state(items: LayoutItem[]): EditorState {
  const layout: Layout = { schemaVersion: 3, items, planning: null }
  return initialEditorState(layout)
}

const asset = makeAsset({
  id: 'asset-7',
  name: '配件柜',
  function: 'accessory_cabinet',
  footprint: { w: 1.2, d: 0.45, h: 2.1 },
  placeable: true,
})

it('rolls an advertising screen about its centre and keeps portrait size during plan rotation', () => {
  const screenAsset = makeAsset({
    id: 'asset-3021147',
    function: 'screen',
    installation: 'embedded',
    front: '+Z',
    footprint: { w: 1.465, d: 0.116, h: 0.846 },
    placeable: true,
  })
  const space = rectangleSpace(8, 6, 3)
  const added = editorReducer(state([]), {
    type: 'add',
    asset: screenAsset,
    cx: 4,
    cz: 0.25,
    space,
  })
  const landscape = added.layout.items[0]!
  expect(landscape).toMatchObject({ name: '65寸广告机', w: 1.465, d: 0.116, h: 0.846 })
  const action = {
    type: 'setScreenOrientation' as const,
    id: landscape.id,
    asset: screenAsset,
    orientation: 'portrait' as const,
    spaceHeight: space.height,
  }
  const portrait = editorReducer(added, action)
  expect(portrait.layout.items[0]).toMatchObject({
    w: 0.846,
    d: 0.116,
    h: 1.465,
    cx: landscape.cx,
    cz: landscape.cz,
    rotation: landscape.rotation,
  })
  expect(portrait.layout.items[0]!.elevation! + 1.465 / 2).toBeCloseTo(
    landscape.elevation! + 0.846 / 2,
  )
  expect(editorReducer(portrait, { type: 'undo' }).layout).toEqual(added.layout)
  expect(
    editorReducer(portrait, { type: 'rotate', id: landscape.id, asset: screenAsset }).layout
      .items[0],
  ).toMatchObject({ w: 0.116, d: 0.846, h: 1.465 })
  const low = state([{ ...landscape, elevation: 0 }])
  expect(editorReducer(low, action).layout).toEqual(low.layout)
})

describe('家具点位放置', () => {
  const space = rectangleSpace(8, 6, 3)
  const furniture = makeAsset({
    name: '中岛桌',
    function: 'island_table',
    installation: 'floor',
    footprint: { w: 1.8, d: 0.9, h: 0.9 },
    placeable: true,
  })

  it('使用目录尺寸和点击位置，放置后选中新家具且可撤销', () => {
    expect(pointPlacedAsset(furniture)).toBe(true)
    expect(pointPlacedAsset({ ...furniture, installation: 'wall' })).toBe(false)
    expect(pointPlacedAsset({ ...furniture, name: '广告机', function: 'screen' })).toBe(false)
    const start = state([])
    const candidate = catalogItem(start.layout, furniture, 2.236, 3.197)
    const next = editorReducer(start, { type: 'placeFurniture', item: candidate, space })
    expect(next.layout.items).toEqual([candidate])
    expect(next.layout.items[0]).toMatchObject({ cx: 2.24, cz: 3.2, w: 1.8, d: 0.9 })
    expect(next.selectedId).toBe(candidate.id)
    expect(next.dirty).toBe(true)
    expect(editorReducer(next, { type: 'undo' }).layout).toEqual(start.layout)
  })

  it('先落下重叠或越界的家具，保留检查、选中和撤回', () => {
    const original = item()
    const start = state([original])
    for (const [cx, cz, code] of [
      [2, 2, 'item_overlap'],
      [0.5, 3, 'item_outside_boundary'],
      [-0.25, 3, 'item_outside_boundary'],
    ] as const) {
      const candidate = catalogItem(start.layout, furniture, cx, cz)
      const next = editorReducer(start, { type: 'placeFurniture', item: candidate, space })
      expect(next.layout.items).toEqual([original, candidate])
      expect(next.selectedId).toBe(candidate.id)
      expect(next.dirty).toBe(true)
      expect(validateLayout(space, next.layout)).toContainEqual(expect.objectContaining({ code }))
      expect(editorReducer(next, { type: 'undo' }).layout).toEqual(start.layout)
    }
  })

  it('保留可保存坐标与层高限制', () => {
    const start = state([])
    const candidate = catalogItem(start.layout, furniture, 2, 2)
    for (const invalid of [
      { ...candidate, cx: 1000.01 },
      { ...candidate, h: 3.1 },
    ]) {
      expect(editorReducer(start, { type: 'placeFurniture', item: invalid, space })).toBe(start)
    }
  })

  it('在相邻空位复制尺寸、款式和转角，找不到位置时保留原布局', () => {
    const original = item({ rotation: 35 })
    const elsewhere = item({ id: 'island_table-2', cx: 4, cz: 2 })
    const start = state([original, elsewhere])
    const nearby = nearbyFurniture(start.layout, space, original)
    expect(nearby).not.toBeNull()
    const next = editorReducer(start, { type: 'placeFurniture', item: nearby!, space })
    const copy = next.layout.items[2]
    expect(copy).toMatchObject({
      id: 'island_table-3',
      assetId: original.assetId,
      w: original.w,
      d: original.d,
      rotation: 35,
    })
    expect(copy).not.toMatchObject({ cx: original.cx, cz: original.cz })
    expect(next.layout.items.slice(0, 2)).toEqual(start.layout.items)
    expect(validateLayout(space, next.layout)).toEqual([])
    expect(editorReducer(next, { type: 'undo' }).layout).toEqual(start.layout)

    const compact = rectangleSpace(2, 1.2, 3)
    const centred = item({ cx: 1, cz: 0.6 })
    expect(nearbyFurniture(state([centred]).layout, compact, centred)).toBeNull()
  })
})

describe('隔板吸附接线', () => {
  const space = rectangleSpace(8, 6, 3)
  const fixture = {
    id: 'partition-1',
    kind: 'hollow_partition' as const,
    cx: 4,
    cz: 3,
    w: 4,
    d: 0.2,
    h: 2.4,
  }
  const start = (piece: LayoutItem) =>
    initialEditorState({ schemaVersion: 3, items: [piece], fixtures: [fixture], planning: null })
  it('隔板候选保留手设高度，超高时不吸附，也不偷改高度', () => {
    const piece = item({
      mount: 'wall',
      w: 1.2,
      d: 0.05,
      h: 0.5,
      cx: 4,
      cz: 0.025,
      elevation: 2.1,
    })
    const moved = editorReducer(start(piece), {
      type: 'move',
      id: piece.id,
      cx: 4,
      cz: 3.2,
      snapTo: space,
      front: '+Z',
    })
    expect(moved.layout.items[0]).toMatchObject({ cz: 3.2, elevation: 2.1 })
  })
  it('自动高度用候选位置的柜顶计算，吸附与实际落地使用同一高度', () => {
    const piece = item({ mount: 'wall', w: 1, d: 0.05, h: 0.5, cx: 4, cz: 0.025, elevation: 1.8 })
    const cabinet = item({
      id: 'cabinet',
      function: 'accessory_cabinet',
      cx: 4,
      cz: 3.5,
      w: 1.2,
      d: 1,
      h: 1.9,
    })
    const before = initialEditorState({
      schemaVersion: 3,
      planning: null,
      items: [piece, cabinet],
      fixtures: [{ ...fixture, h: 2.6 }],
    })
    const moved = editorReducer(before, {
      type: 'move',
      id: piece.id,
      cx: 4,
      cz: 3.2,
      snapTo: space,
      front: '+Z',
    })
    expect(moved.layout.items[0]).toMatchObject({ cz: 3.125, elevation: 2, rotation: 0 })
    expect(validateLayout(space, moved.layout).some((i) => i.code === 'item_not_on_wall')).toBe(
      false,
    )
  })
  it('普通道具拖动吸附与Alt自由移动分开，整次拖动一步撤销', () => {
    const piece = item({ cx: 4, cz: 2, w: 1, d: 0.4 })
    const before = start(piece)
    const action = {
      type: 'move' as const,
      id: piece.id,
      cx: 4,
      cz: 2.64,
      group: 'drag',
      snapTo: space,
    }
    const moved = editorReducer(before, action)
    expect(moved.layout.items[0]?.cz).toBe(2.7)
    expect(editorReducer(before, { ...action, snapTo: null }).layout.items[0]?.cz).toBe(2.64)
    const continued = editorReducer(moved, { ...action, cx: 4.3 })
    expect(editorReducer(continued, { type: 'undo' }).layout).toEqual(before.layout)
    expect(
      editorReducer(editorReducer(continued, { type: 'undo' }), { type: 'redo' }).layout,
    ).toEqual(continued.layout)
  })
  it('贴墙道具换到隔板另一侧会朝外，保存重开保留位置和朝向', () => {
    const piece = item({ mount: 'wall', w: 1, d: 0.05, h: 0.5, cx: 4, cz: 2.5, elevation: 1.2 })
    const north = editorReducer(start(piece), {
      type: 'move',
      id: piece.id,
      cx: 4,
      cz: 2.8,
      snapTo: space,
      front: '+Z',
    })
    expect(north.layout.items[0]).toMatchObject({ cz: 2.875, rotation: 180, elevation: 1.2 })
    const south = editorReducer(north, {
      type: 'move',
      id: piece.id,
      cx: 4,
      cz: 3.2,
      snapTo: space,
      front: '+Z',
    })
    expect(south.layout.items[0]).toMatchObject({ cz: 3.125, rotation: 0, elevation: 1.2 })
    const reopened = editorReducer(start(piece), {
      type: 'load',
      layout: LayoutSchema.parse(JSON.parse(JSON.stringify(south.layout))),
    })
    expect(reopened.layout).toEqual(south.layout)
    const free = editorReducer(north, {
      type: 'move',
      id: piece.id,
      cx: 4,
      cz: 3.2,
      snapTo: null,
      front: '+Z',
    })
    expect(free.layout.items[0]).toMatchObject({ cz: 3.2, rotation: 180 })
  })
  it('新加贴墙模型可落到最近隔板上，默认高度受隔板约束', () => {
    const empty = initialEditorState({
      schemaVersion: 3,
      items: [],
      fixtures: [fixture],
      planning: null,
    })
    const added = editorReducer(empty, {
      type: 'add',
      asset: makeAsset({ installation: 'wall', front: '+Z', footprint: { w: 1, d: 0.05, h: 0.8 } }),
      cx: 4,
      cz: 3.2,
      space,
    })
    expect(added.layout.items[0]).toMatchObject({ cz: 3.125, rotation: 0, elevation: 1.6 })
  })
})

describe('editorReducer', () => {
  it('snaps moves and nudges to 10 mm and marks the layout dirty', () => {
    const moved = editorReducer(state([item()]), {
      type: 'move',
      id: 'island_table-1',
      cx: 3.004,
      cz: 1.996,
    })
    expect(moved.layout.items[0]).toMatchObject({ cx: 3, cz: 2 })
    expect(moved.dirty).toBe(true)
    const nudged = editorReducer(moved, { type: 'nudge', id: 'island_table-1', dx: 0.1, dz: 0 })
    expect(nudged.layout.items[0]?.cx).toBe(3.1)
    expect(snap(0.125)).toBe(0.13)
  })

  it('never moves, rotates or removes a locked item', () => {
    const start = state([item({ locked: true })])
    const id = 'island_table-1'
    for (const action of [
      { type: 'move', id, cx: 5, cz: 5 },
      { type: 'nudge', id, dx: 1, dz: 1 },
      { type: 'rotate', id },
      { type: 'remove', id },
    ] as const) {
      expect(editorReducer(start, action).layout.items[0]).toEqual(start.layout.items[0])
    }
  })

  it('returns the same state for an unknown id', () => {
    const start = state([item()])
    expect(editorReducer(start, { type: 'move', id: 'nope', cx: 1, cz: 1 })).toBe(start)
    expect(editorReducer(start, { type: 'remove', id: 'nope' })).toBe(start)
  })

  it('rotates real models to their true footprint and swaps placeholder sides', () => {
    const real = editorReducer(state([item({ assetId: 'asset-7', w: 1.2, d: 0.45 })]), {
      type: 'rotate',
      id: 'island_table-1',
      asset,
    })
    expect(real.layout.items[0]).toMatchObject({ rotation: 90, w: 0.45, d: 1.2, h: 2.1 })
    const placeholder = editorReducer(state([item({ assetId: null, placeholder: true })]), {
      type: 'rotate',
      id: 'island_table-1',
    })
    expect(placeholder.layout.items[0]).toMatchObject({ rotation: 90, w: 0.9, d: 1.8 })
    const full = [90, 180, 270].reduce(
      (s) => editorReducer(s, { type: 'rotate', id: 'island_table-1' }),
      placeholder,
    )
    expect(full.layout.items[0]?.rotation).toBe(0)
  })

  it('adds a catalogue model at its true size and selects it', () => {
    const added = editorReducer(state([]), { type: 'add', asset, cx: 1.234, cz: 2 })
    expect(added.selectedId).toBe('accessory_cabinet-1')
    expect(added.layout.items[0]).toMatchObject({
      assetId: 'asset-7',
      cx: 1.23,
      w: 1.2,
      d: 0.45,
      h: 2.1,
      placeholder: false,
    })
  })

  it('drops a new model in the middle of a rectangle and inside a U shape', () => {
    expect(newItemPoint(rectangleSpace(8, 6, 3))).toEqual([4, 3])
    // The bounding-box centre (4.5, 3) lies in the slot of the U, outside the shop.
    const u = {
      ...rectangleSpace(9, 6, 3),
      boundary: [
        [0, 0],
        [9, 0],
        [9, 6],
        [6, 6],
        [6, 2],
        [3, 2],
        [3, 6],
        [0, 6],
      ] as [number, number][],
    }
    const [cx, cz] = newItemPoint(u)
    const added = editorReducer(state([]), { type: 'add', asset, cx, cz })
    const placed = added.layout.items[0]
    expect(locatePoint([placed?.cx ?? 0, placed?.cz ?? 0], u.boundary)).toBe('inside')
  })

  it('adds a model without a web model as a true-size placeholder', () => {
    const screenAsset = {
      ...asset,
      id: 'asset-8',
      function: 'screen',
      placeable: false,
      footprint: { w: 1.69, d: 0.05, h: 0.958 },
    } as Asset
    const added = editorReducer(state([]), { type: 'add', asset: screenAsset, cx: 1, cz: 1 })
    expect(added.layout.items[0]).toMatchObject({
      assetId: 'asset-8',
      placeholder: true,
      w: 1.69,
      d: 0.05,
      h: 0.958,
    })
  })

  it('clears dirty only when nothing changed since the save started', () => {
    const edited = editorReducer(state([item()]), {
      type: 'nudge',
      id: 'island_table-1',
      dx: 1,
      dz: 0,
    })
    const sent = edited.layout
    expect(editorReducer(edited, { type: 'saved', layout: sent }).dirty).toBe(false)
    const editedAgain = editorReducer(edited, { type: 'nudge', id: 'island_table-1', dx: 1, dz: 0 })
    expect(editorReducer(editedAgain, { type: 'saved', layout: sent }).dirty).toBe(true)
  })

  it('loads a layout as clean with nothing selected', () => {
    const edited = { ...state([item()]), selectedId: 'island_table-1', dirty: true }
    const loaded = editorReducer(edited, { type: 'load', layout: state([]).layout })
    expect(loaded).toMatchObject({ selectedId: null, dirty: false })
  })
})

describe('nextItemId', () => {
  it('skips ids that are already taken', () => {
    const layout = state([item({ id: 'cashier-2', function: 'cashier' })]).layout
    expect(nextItemId(layout, 'cashier')).toBe('cashier-3')
    expect(nextItemId(layout, 'storage')).toBe('storage-1')
  })
})

describe('undo / redo', () => {
  it('undoes and redoes edits, and a new edit clears the redo list', () => {
    let s = editorReducer(state([item()]), { type: 'nudge', id: 'island_table-1', dx: 1, dz: 0 })
    s = editorReducer(s, { type: 'rotate', id: 'island_table-1' })
    expect(s.past).toHaveLength(2)
    s = editorReducer(s, { type: 'undo' })
    expect(s.layout.items[0]).toMatchObject({ cx: 3, rotation: 0 })
    s = editorReducer(s, { type: 'undo' })
    expect(s.layout.items[0]?.cx).toBe(2)
    expect(editorReducer(s, { type: 'undo' })).toBe(s)
    s = editorReducer(s, { type: 'redo' })
    expect(s.layout.items[0]?.cx).toBe(3)
    s = editorReducer(s, { type: 'remove', id: 'island_table-1' })
    expect(s.future).toEqual([])
    expect(s.layout.items).toEqual([])
  })

  it('treats one drag and a run of nudges as one step each', () => {
    let s = state([item()])
    for (const cx of [2.2, 2.4, 2.6]) {
      s = editorReducer(s, { type: 'move', id: 'island_table-1', cx, cz: 2, group: 'drag-1' })
    }
    for (let i = 0; i < 3; i++)
      s = editorReducer(s, { type: 'nudge', id: 'island_table-1', dx: 0.01, dz: 0 })
    expect(s.past).toHaveLength(2)
    expect(editorReducer(s, { type: 'undo' }).layout.items[0]?.cx).toBe(2.6)
    expect(
      editorReducer(editorReducer(s, { type: 'undo' }), { type: 'undo' }).layout.items[0]?.cx,
    ).toBe(2)
  })

  it('keeps at most 100 steps', () => {
    let s = state([item()])
    for (let i = 0; i < 120; i++) {
      s = editorReducer(s, { type: 'move', id: 'island_table-1', cx: 1 + i * 0.01, cz: 2 })
    }
    expect(s.past).toHaveLength(100)
  })
})

describe('模型拖动在门店边界外一米处截止', () => {
  const space = rectangleSpace(8, 6, 3)
  const start = state([item()])
  const drag = {
    type: 'move' as const,
    id: 'island_table-1',
    group: 'drag-limit',
    dragBoundary: space.boundary,
  }

  it.each([space, null])('磁吸开启或按住 Alt 都限制拖动，整次拖动只撤销一步', (snapTo) => {
    const insideMargin = editorReducer(start, { ...drag, snapTo, cx: 8.5, cz: 3 })
    expect(insideMargin.layout.items[0]).toMatchObject({ cx: 8.5, cz: 3 })
    const atLimit = editorReducer(insideMargin, { ...drag, snapTo, cx: 40, cz: 3 })
    expect(atLimit.layout.items[0]).toMatchObject({ cx: 9, cz: 3 })
    expect(editorReducer(atLimit, { ...drag, snapTo, cx: 100, cz: 3 })).toBe(atLimit)
    expect(editorReducer(atLimit, { type: 'undo' }).layout).toEqual(start.layout)
  })

  it('斜向拖过角点时限制直线距离，毫米取整后仍在范围内', () => {
    const next = editorReducer(start, { ...drag, cx: 100, cz: 44 })
    const { cx, cz } = next.layout.items[0]!
    expect(cx).toBeGreaterThan(8)
    expect(cz).toBeGreaterThan(6)
    const gap = distanceToBoundary([cx, cz], space.boundary)
    expect(gap).toBeLessThanOrEqual(1)
    expect(gap).toBeGreaterThan(0.998)
  })

  it('按凹形店铺的实际轮廓限制拖动', () => {
    const next = editorReducer(start, {
      ...drag,
      dragBoundary: [
        [0, 0],
        [10, 0],
        [10, 8],
        [7, 8],
        [7, 2],
        [3, 2],
        [3, 8],
        [0, 8],
      ],
      cx: 4.25,
      cz: 6,
    })
    expect(next.layout.items[0]).toMatchObject({ cx: 4, cz: 6 })
  })

  it('保留旧项目的场外摆放及属性面板的坐标编辑', () => {
    const loaded = state([item({ cx: 20, cz: 2 })])
    expect(loaded.layout.items[0]).toMatchObject({ cx: 20, cz: 2 })
    const next = editorReducer(loaded, { type: 'move', id: drag.id, cx: 21, cz: 2 })
    expect(next.layout.items[0]).toMatchObject({ cx: 21, cz: 2 })
  })
})

describe('magnetic snapping while moving', () => {
  const room = rectangleSpace(8, 6, 3)

  it('sticks a prop to a nearby wall and keeps millimetres there', () => {
    // 1.8 × 0.9 table, left edge 60 mm from the left wall → touches the wall.
    const s = editorReducer(state([item()]), {
      type: 'move',
      id: 'island_table-1',
      cx: 0.96,
      cz: 3,
      snapTo: room,
    })
    expect(s.layout.items[0]).toMatchObject({ cx: 0.9, cz: 3 })
  })

  it('sticks to a neighbour side by side, and not when Alt turns snapping off', () => {
    const neighbour = item({ id: 'island_table-2', cx: 5, cz: 3 })
    const start = state([item({ cz: 3 }), neighbour])
    const near = { type: 'move' as const, id: 'island_table-1', cx: 3.15, cz: 3.05 }
    expect(editorReducer(start, { ...near, snapTo: room }).layout.items[0]).toMatchObject({
      cx: 3.2,
      cz: 3,
    })
    expect(editorReducer(start, near).layout.items[0]).toMatchObject({ cx: 3.15, cz: 3.05 })
  })
})

describe('wall pieces', () => {
  // 6 m × 4 m, 3 m high: back wall at z = 0, left wall at x = 0.
  const space = rectangleSpace(6, 4, 3)
  const logo = makeAsset({
    id: 'asset-20533337',
    name: '影石墙面LOGO',
    function: 'signage',
    installation: 'wall',
    footprint: { w: 3.453, d: 0.05, h: 0.453 },
    front: '+Z',
    placeable: false,
  })
  const cabinet = item({
    id: 'accessory_cabinet-1',
    function: 'accessory_cabinet',
    cx: 3,
    cz: 0.275,
    w: 2.4,
    d: 0.55,
    h: 2.4,
  })

  it('goes onto the nearest wall above the cabinet there when added', () => {
    const added = editorReducer(state([cabinet]), {
      type: 'add',
      asset: logo,
      cx: 3,
      cz: 1,
      space,
    })
    expect(added.layout.items[1]).toMatchObject({
      mount: 'wall',
      cx: 3,
      cz: 0.025,
      rotation: 0,
      elevation: 2.5,
      placeholder: true,
    })
  })

  it('turns onto a side wall when dragged there and follows the props below', () => {
    const start = editorReducer(state([cabinet]), {
      type: 'add',
      asset: logo,
      cx: 3,
      cz: 1,
      space,
    })
    const moved = editorReducer(start, {
      type: 'move',
      id: 'signage-1',
      cx: 0.2,
      cz: 2,
      snapTo: space,
      front: '+Z',
    })
    expect(moved.layout.items[1]).toMatchObject({
      cx: 0.025,
      cz: 2,
      rotation: 270,
      w: 0.05,
      d: 3.453,
      elevation: 1.8,
    })
  })

  it('follows the props below through every step of a drag across the room', () => {
    let s = editorReducer(state([cabinet]), { type: 'add', asset: logo, cx: 3, cz: 1, space })
    for (const [cx, cz] of [
      [2.8, 0.3],
      [1.5, 1.5],
      [0.5, 2],
      [0.2, 2],
    ] as const) {
      s = editorReducer(s, {
        type: 'move',
        id: 'signage-1',
        cx,
        cz,
        group: 'drag',
        snapTo: space,
        front: '+Z',
      })
    }
    expect(s.layout.items[1]).toMatchObject({ cx: 0.025, rotation: 270, elevation: 1.8 })
  })

  it('keeps a height typed in by hand when moved along the wall', () => {
    let s = editorReducer(state([cabinet]), { type: 'add', asset: logo, cx: 3, cz: 1, space })
    s = editorReducer(s, { type: 'elevate', id: 'signage-1', elevation: 2.6 })
    s = editorReducer(s, {
      type: 'move',
      id: 'signage-1',
      cx: 2.5,
      cz: 0.1,
      snapTo: space,
      front: '+Z',
    })
    expect(s.layout.items[1]).toMatchObject({ cx: 2.5, cz: 0.025, elevation: 2.6 })
  })

  it('never gives a floor prop a height', () => {
    const s = editorReducer(state([cabinet]), {
      type: 'elevate',
      id: 'accessory_cabinet-1',
      elevation: 1,
    })
    expect(s.layout.items[0]?.elevation).toBeUndefined()
  })
})

describe('空心隔板', () => {
  const space = rectangleSpace(6, 4, 3)
  const cabinet = item({
    id: 'accessory_cabinet-1',
    function: 'accessory_cabinet',
    cx: 3,
    cz: 0.275,
    w: 2.4,
    d: 0.55,
    h: 2.4,
  })
  const drawn = { minX: 1.25, maxX: 4.75, minZ: 0.06, maxZ: 0.62 }

  it('adds a drawn partition stuck to the wall and cabinet, as tall as the cabinet', () => {
    const s = editorReducer(state([cabinet]), {
      type: 'addFixture',
      rect: drawn,
      space,
      snap: true,
    })
    expect(s.layout.fixtures).toEqual([
      { id: 'partition-1', kind: 'hollow_partition', cx: 3, cz: 0.275, w: 3.5, d: 0.55, h: 2.4 },
    ])
    expect(s.selectedId).toBe('partition-1')
    expect(s.dirty).toBe(true)
  })

  it('ignores a click without a drag, and draws freely with Alt', () => {
    const click = { minX: 2, maxX: 2.01, minZ: 1, maxZ: 1.01 }
    expect(
      editorReducer(state([]), { type: 'addFixture', rect: click, space, snap: true }).layout,
    ).toEqual(state([]).layout)
    const free = editorReducer(state([cabinet]), {
      type: 'addFixture',
      rect: drawn,
      space,
      snap: false,
    })
    expect(free.layout.fixtures?.[0]).toMatchObject({ cz: 0.34, d: 0.56 })
  })

  it('moves onto a cabinet edge, takes typed sizes, and is removed and undone', () => {
    let s = editorReducer(state([cabinet]), { type: 'addFixture', rect: drawn, space, snap: true })
    s = editorReducer(s, {
      type: 'moveFixture',
      id: 'partition-1',
      cx: 2.93,
      cz: 0.3,
      snapTo: space,
    })
    // The left edge (1.18) is within 100 mm of nothing; the top edge sticks to the wall.
    expect(s.layout.fixtures?.[0]).toMatchObject({ cx: 2.93, cz: 0.275 })
    s = editorReducer(s, { type: 'updateFixture', id: 'partition-1', patch: { h: 3, w: 0.01 } })
    expect(s.layout.fixtures?.[0]).toMatchObject({ h: 3, w: 0.05 })
    s = editorReducer(s, { type: 'remove', id: 'partition-1' })
    expect(s.layout.fixtures).toBeUndefined()
    expect(s.layout.items).toHaveLength(1)
    s = editorReducer(s, { type: 'undo' })
    expect(s.layout.fixtures).toHaveLength(1)
  })
})

describe('内嵌', () => {
  const space = rectangleSpace(6, 4, 3)
  const screen = makeAsset({
    id: 'asset-11479197',
    name: '75寸横屏广告机',
    materialCategory: '信息化物料',
    function: 'screen',
    installation: 'embedded',
    footprint: { w: 1.69, d: 0.05, h: 0.958 },
    front: '+Z',
    placeable: false,
  })

  it('goes into the nearest wall with its front flush, the picture centred at 1.5 m', () => {
    const s = editorReducer(state([]), { type: 'add', asset: screen, cx: 3, cz: 1, space })
    expect(s.layout.items[0]).toMatchObject({
      mount: 'embedded',
      cx: 3,
      cz: -0.025,
      rotation: 0,
      elevation: 1.021,
    })
  })

  it('switches between 贴墙 and 内嵌 by crossing the wall face without changing height', () => {
    let s = editorReducer(state([]), { type: 'add', asset: screen, cx: 3, cz: 1, space })
    const id = s.layout.items[0]?.id ?? ''
    s = editorReducer(s, { type: 'move', id, cx: 4, cz: 0.04, snapTo: space, front: '+Z' })
    expect(s.layout.items[0]).toMatchObject({ mount: 'wall', cz: 0.025, elevation: 1.021 })
    s = editorReducer(s, { type: 'move', id, cx: 4, cz: -0.04, snapTo: space, front: '+Z' })
    expect(s.layout.items[0]).toMatchObject({ mount: 'embedded', cz: -0.025, elevation: 1.021 })
  })
})

describe('LOGO 等比缩放', () => {
  const space = rectangleSpace(6, 4, 3)
  const logo = makeAsset({
    id: 'asset-20533337',
    name: '影石墙面LOGO',
    function: 'signage',
    installation: 'wall',
    footprint: { w: 3.453, d: 0.05, h: 0.471 },
    front: '+Z',
  })
  const added = () => editorReducer(state([]), { type: 'add', asset: logo, cx: 3, cz: 1, space })

  it('takes a typed width, keeps the back on the wall, and turns with its scale', () => {
    let s = added()
    const id = s.layout.items[0]?.id ?? ''
    s = editorReducer(s, { type: 'scale', id, asset: logo, scale: 2 / 3.453, space, front: '+Z' })
    expect(s.layout.items[0]).toMatchObject({ scale: 0.579, w: 1.999, d: 0.029, h: 0.273 })
    // Thinner, so the centre moves to keep the back on the back wall (z = 0).
    expect(s.layout.items[0]?.cz).toBe(0.015)
    s = editorReducer(s, { type: 'rotate', id, asset: logo })
    expect(s.layout.items[0]).toMatchObject({ rotation: 90, scale: 0.579, w: 0.029, d: 1.999 })
  })

  it('goes back to the original size without a scale', () => {
    let s = added()
    const id = s.layout.items[0]?.id ?? ''
    s = editorReducer(s, { type: 'scale', id, asset: logo, scale: 1.5, space, front: '+Z' })
    s = editorReducer(s, { type: 'scale', id, asset: logo, scale: 1, space, front: '+Z' })
    expect(s.layout.items[0]?.scale).toBeUndefined()
    expect(s.layout.items[0]).toMatchObject({ w: 3.453, d: 0.05, cz: 0.025 })
  })
})

describe('LOGO 拖动改大小', () => {
  const space = rectangleSpace(6, 4, 3)
  const logo = makeAsset({
    id: 'asset-20533337',
    name: '影石墙面LOGO',
    function: 'signage',
    installation: 'wall',
    footprint: { w: 3.453, d: 0.05, h: 0.471 },
    front: '+Z',
  })

  it('moves to where the drag put it and keeps the back on the wall, one undo step', () => {
    let s = editorReducer(state([]), { type: 'add', asset: logo, cx: 3, cz: 1, space })
    const id = s.layout.items[0]?.id ?? ''
    const drag = (scale: number, cx: number) =>
      editorReducer(s, {
        type: 'scale',
        id,
        asset: logo,
        scale,
        at: { cx, cz: 0.025, elevation: 2 },
        space,
        front: '+Z',
        group: 'resize:1',
      })
    s = drag(0.8, 2.655)
    s = drag(0.579, 2.273)
    expect(s.layout.items[0]).toMatchObject({ scale: 0.579, cx: 2.273, cz: 0.015, elevation: 2 })
    s = editorReducer(s, { type: 'undo' })
    expect(s.layout.items[0]?.scale).toBeUndefined()
  })
})

describe('转到任意角度', () => {
  const id = 'island_table-1'

  it('turns to any angle, swapping width and depth only when the nearest quarter turn changes', () => {
    const tilted = editorReducer(state([item()]), { type: 'turn', id, rotation: 30 })
    expect(tilted.layout.items[0]).toMatchObject({ rotation: 30, w: 1.8, d: 0.9 })
    const past = editorReducer(tilted, { type: 'turn', id, rotation: 100 })
    expect(past.layout.items[0]).toMatchObject({ rotation: 100, w: 0.9, d: 1.8 })
    // A quarter turn from there keeps the tilt.
    const quarter = editorReducer(past, { type: 'rotate', id })
    expect(quarter.layout.items[0]).toMatchObject({ rotation: 190, w: 1.8, d: 0.9 })
  })

  it('keeps a LOGO at its scale and leaves locked props alone', () => {
    const logo = item({ function: 'signage', w: 2, d: 0.1, h: 1, scale: 2 })
    const turned = editorReducer(state([logo]), { type: 'turn', id, rotation: 45 })
    expect(turned.layout.items[0]).toMatchObject({ rotation: 45, w: 0.1, d: 2, scale: 2 })
    const locked = state([item({ locked: true })])
    expect(editorReducer(locked, { type: 'turn', id, rotation: 30 })).toBe(locked)
    expect(
      editorReducer(state([item()]), { type: 'turn', id, rotation: Number.NaN }).layout,
    ).toEqual(state([item()]).layout)
  })

  it('makes one undo step of one drag of the handle', () => {
    let s = state([item()])
    for (const rotation of [5, 12, 20, 33]) {
      s = editorReducer(s, { type: 'turn', id, rotation, group: 'turn:a' })
    }
    expect(s.layout.items[0]?.rotation).toBe(33)
    expect(editorReducer(s, { type: 'undo' }).layout.items[0]?.rotation).toBe(0)
  })
})
