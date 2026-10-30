import { expect, it } from 'vitest'
import { rectangleSpace, wallArtAsset, wallArtSize } from '@store/shared'
import { editorReducer, initialEditorState } from './editor-state.ts'

it('贴墙灯箱独立修改尺寸、旋转、撤销重做，锁定及强制贴墙有效', () => {
  const asset = wallArtAsset()
  const space = rectangleSpace(8, 6, 3.2)
  let state = editorReducer(initialEditorState({ schemaVersion: 3, planning: null, items: [] }), {
    type: 'add',
    asset,
    cx: 4,
    cz: 0,
    space,
  })
  const id = state.layout.items[0]!.id
  state = editorReducer(state, { type: 'resizeWallArt', id, width: 1.777, height: 1.234, space })
  expect(wallArtSize(state.layout.items[0]!)).toEqual({ w: 1.777, d: 0.001, h: 1.234 })
  const resized = state.layout
  state = editorReducer(state, { type: 'rotate', id, asset })
  expect(wallArtSize(state.layout.items[0]!)).toEqual({ w: 1.777, d: 0.001, h: 1.234 })
  state = editorReducer(state, { type: 'undo' })
  expect(state.layout).toEqual(resized)
  state = editorReducer(state, { type: 'redo' })
  expect(state.layout.items[0]!.rotation).toBe(90)
  const mounted = editorReducer(state, {
    type: 'setMount',
    id,
    mount: 'embedded',
    space,
    front: '+Z',
  })
  expect(mounted.layout.items[0]!.mount).toBe('wall')
  const locked = {
    ...state,
    layout: {
      ...state.layout,
      items: state.layout.items.map((item) => ({ ...item, locked: true })),
    },
  }
  expect(
    editorReducer(locked, { type: 'resizeWallArt', id, width: 2, height: 2, space }).layout,
  ).toEqual(locked.layout)
})
