import { describe, expect, it } from 'vitest'
import { rectangleSpace } from '@store/shared'
import type { Asset, Layout, LayoutItem } from '@store/shared'
import { editorReducer, initialEditorState, nextItemId, snap } from './editor-state.ts'
import type { EditorState } from './editor-state.ts'

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

const asset = {
  id: 'asset-7',
  name: '配件柜',
  function: 'accessory_cabinet',
  footprint: { w: 1.2, d: 0.45, h: 2.1 },
  placeable: true,
} as Asset

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
