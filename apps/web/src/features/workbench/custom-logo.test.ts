import { describe, expect, it } from 'vitest'
import { customLogoAsset, customLogoSize, rectangleSpace, assetFitProblem } from '@store/shared'
import { catalogItem, editorReducer, initialEditorState } from './editor-state.ts'

describe('自定义 LOGO 编辑历史', () => {
  it('改字、缩放和旋转均保留实际尺寸，可撤回重做并重开', () => {
    const asset = customLogoAsset(),
      empty = { schemaVersion: 3 as const, items: [], planning: null }
    const logo = catalogItem(empty, asset, 2, 2)
    let state = initialEditorState({ ...empty, items: [logo] })
    state = editorReducer(state, { type: 'setLogoText', id: logo.id, text: '影石 Insta360' })
    expect(state.layout.items[0]?.logoText).toBe('影石 Insta360')
    state = editorReducer(state, {
      type: 'scale',
      id: logo.id,
      asset,
      scale: 2,
      space: rectangleSpace(8, 6, 3),
      front: '+Z',
    })
    state = editorReducer(state, { type: 'rotate', id: logo.id, asset, by: 90 })
    const next = state.layout.items[0]!
    expect(next).toMatchObject(customLogoSize('影石 Insta360', 2, 90))
    expect(assetFitProblem(next, asset)).toBeNull()
    state = editorReducer(state, { type: 'undo' })
    expect(state.layout.items[0]?.rotation).toBe(0)
    state = editorReducer(state, { type: 'redo' })
    expect(state.layout.items[0]).toEqual(next)
    expect(initialEditorState(JSON.parse(JSON.stringify(state.layout))).layout.items[0]).toEqual(
      next,
    )
  })
})
