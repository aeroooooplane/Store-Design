import { describe, expect, it, vi } from 'vitest'
import { RenderBackgroundSchema } from '@store/shared'
import { BackgroundDrafts, newBackground } from './state.ts'
import type { SavedBackground, BackgroundValue } from './state.ts'

const image = { fileId: 'photo-a', url: '/photo-a', width: 1200, height: 1800, name: '照片' }
const bg = () => newBackground(image)
const deferred = <T>() => {
  let resolve!: (value: T) => void
  let reject!: (value: unknown) => void
  const promise = new Promise<T>((a, b) => {
    resolve = a
    reject = b
  })
  return { promise, resolve, reject }
}

describe('background drafts', () => {
  it('contains portrait and landscape photos and starts with hidden translucent walls', () => {
    expect(bg().transform.width).toBeCloseTo(4 / 9)
    expect(newBackground({ ...image, width: 2400, height: 1200 }).transform.width).toBe(1)
    expect(bg()).toMatchObject({
      masks: [],
      guides: [],
      guidesVisible: true,
      showTransparentWalls: false,
    })
  })
  it('creates a schema-valid initial background for an accepted 1 by 8192 image', () => {
    const value = newBackground({
      ...image,
      fileId: '99999999-9999-4999-8999-999999999999',
      url: '/api/v1/files/99999999-9999-4999-8999-999999999999',
      width: 1,
      height: 8192,
    })
    expect(value.transform.width).toBe(0.01)
    expect(RenderBackgroundSchema.parse(value)).toEqual(value)
  })
  it('serializes saves, binds expected revisions and does not replace newer local edits with an old response', async () => {
    const a = deferred<SavedBackground>(),
      b = deferred<SavedBackground>()
    const save = vi
      .fn()
      .mockImplementationOnce(() => a.promise)
      .mockImplementationOnce(() => b.promise)
    const store = new BackgroundDrafts(save)
    store.receive('a', null, 4)
    const first = bg(),
      second = { ...first, transform: { ...first.transform, x: 0.7 } }
    store.commit('a', first)
    store.commit('a', second)
    expect(save).toHaveBeenCalledTimes(1)
    a.resolve({ background: first, revision: 5 })
    await Promise.resolve()
    await Promise.resolve()
    expect(store.get('a')?.background).toEqual(second)
    expect(save).toHaveBeenLastCalledWith('a', second, 5)
    b.resolve({ background: second, revision: 6 })
    await store.flush('a')
    expect(store.dirty('a')).toBe(false)
    expect(store.get('a')?.past).toHaveLength(2)
  })
  it('makes a drag one undo step, cancellation no step, and keeps views independent', async () => {
    const save = vi.fn(async (_id: string, value: BackgroundValue, revision: number) => ({
      background: value,
      revision: revision + 1,
    }))
    const store = new BackgroundDrafts(save)
    store.receive('a', bg(), 0)
    store.receive('b', bg(), 8)
    store.begin('a')
    for (let i = 1; i <= 12; i++)
      store.preview('a', { ...bg(), transform: { ...bg().transform, x: i / 10 } })
    expect(save).not.toHaveBeenCalled()
    store.end('a')
    await store.flush('a')
    expect(store.get('a')?.past).toHaveLength(1)
    expect(store.get('b')?.past).toHaveLength(0)
    store.undo('a')
    await store.flush('a')
    expect(store.get('a')?.background).toEqual(bg())
    store.redo('a')
    await store.flush('a')
    expect(store.get('a')?.background?.transform.x).toBe(1.2)
    store.begin('a')
    store.preview('a', null)
    store.end('a', true)
    expect(store.get('a')?.background?.transform.x).toBe(1.2)
    expect(store.get('a')?.past).toHaveLength(1)
  })
  it('keeps failed edits and history, blocks export flush and retries the same expected revision', async () => {
    const save = vi
      .fn()
      .mockRejectedValueOnce(new Error('离线'))
      .mockImplementationOnce(async (_id: string, value: BackgroundValue, revision: number) => ({
        background: value,
        revision: revision + 1,
      }))
    const store = new BackgroundDrafts(save)
    store.receive('a', null, 3)
    store.commit('a', bg())
    await expect(store.flush('a')).rejects.toThrow('离线')
    store.receive('a', null, 4)
    expect(store.get('a')?.background).toEqual(bg())
    expect(store.get('a')?.past).toHaveLength(1)
    store.retry('a')
    await store.flush('a')
    expect(save).toHaveBeenLastCalledWith('a', bg(), 3)
    expect(store.get('a')?.error).toBeNull()
  })
  it('undoes replacement/removal back to the original image, masks and guides', async () => {
    const store = new BackgroundDrafts(async (_id, background, revision) => ({
      background,
      revision: revision + 1,
    }))
    const original = {
      ...bg(),
      masks: [
        {
          id: 'mask',
          points: [
            [0, 0],
            [1, 0],
            [0, 1],
          ] as [number, number][],
        },
      ],
      guides: [
        {
          id: 'line',
          points: [
            [0, 0],
            [1, 1],
          ] as [[number, number], [number, number]],
        },
      ],
    }
    store.receive('a', original, 0)
    store.commit('a', newBackground({ ...image, fileId: 'photo-b' }))
    await store.flush('a')
    store.undo('a')
    await store.flush('a')
    expect(store.get('a')?.background).toEqual(original)
    store.commit('a', null)
    await store.flush('a')
    store.undo('a')
    await store.flush('a')
    expect(store.get('a')?.background).toEqual(original)
  })
})
