import { expect, it } from 'vitest'
import { rectangleSpace, wallArtAsset, wallArtSize } from '@store/shared'
import { editorReducer, initialEditorState } from './editor-state.ts'

it('灯箱独立调整尺寸、旋转和撤销，安装状态由摆放决定', () => {
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
  expect(wallArtSize(state.layout.items[0]!)).toEqual({ w: 1.777, d: 0.08, h: 1.234 })
  const resized = state.layout
  state = editorReducer(state, { type: 'rotate', id, asset })
  expect(wallArtSize(state.layout.items[0]!)).toEqual({ w: 1.777, d: 0.08, h: 1.234 })
  state = editorReducer(state, { type: 'undo' })
  expect(state.layout).toEqual(resized)
  state = editorReducer(state, { type: 'redo' })
  expect(state.layout.items[0]!.rotation).toBe(90)
  const mounted = editorReducer(state, {
    type: 'setMount',
    id,
    mount: 'wall',
    space,
    front: '+Z',
  })
  expect(mounted.layout.items[0]!.mount).toBe('embedded')
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

it('添加优先内嵌包板，拖向店内贴面，拉远变悬空，拖回恢复内嵌', () => {
  const space = rectangleSpace(8, 6, 3.2)
  const fixture = {
    id: 'partition-1',
    kind: 'hollow_partition' as const,
    cx: 4,
    cz: 3,
    w: 4,
    d: 0.3,
    h: 3,
  }
  const asset = wallArtAsset()
  let state = editorReducer(
    initialEditorState({ schemaVersion: 3, planning: null, items: [], fixtures: [fixture] }),
    { type: 'add', asset, cx: 4, cz: 1.5, space },
  )
  const id = state.layout.items[0]!.id
  expect(state.layout.items[0]).toMatchObject({
    mount: 'embedded',
    cz: 2.89,
    w: 1.7,
    d: 0.08,
    h: 0.98,
  })
  const move = (cz: number) => {
    state = editorReducer(state, { type: 'move', id, cx: 4, cz, snapTo: space, front: '+Z' })
  }
  move(2.79)
  expect(state.layout.items[0]).toMatchObject({ mount: 'wall', cz: 2.81 })
  move(2.4)
  expect(state.layout.items[0]).toMatchObject({ mount: 'ceiling', cz: 2.4 })
  move(2.9)
  expect(state.layout.items[0]).toMatchObject({ mount: 'embedded', cz: 2.89 })
})
