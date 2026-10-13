/**
 * Characterization tests for the parts of white-scene.ts that run without WebGL. WhiteScene
 * itself creates a WebGLRenderer in its constructor, which jsdom cannot provide, so only the
 * model cache (loadSource) is covered here. The GLB fetch is stubbed with a tiny glTF.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadSource } from './white-scene.ts'

const GLTF = JSON.stringify({
  asset: { version: '2.0' },
  scenes: [{ nodes: [0] }],
  scene: 0,
  nodes: [{ name: 'box' }],
})

const urlOf = (input: unknown) => (typeof input === 'string' ? input : (input as Request).url)

describe('loadSource', () => {
  let fetchMock: ReturnType<typeof vi.fn>
  beforeEach(() => {
    fetchMock = vi.fn(async (input: unknown) =>
      urlOf(input).includes('missing')
        ? new Response('nope', { status: 404, statusText: 'Not Found' })
        : new Response(GLTF, { status: 200 }),
    )
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('fetches and decodes each model once per page', async () => {
    const url = 'http://test.local/models/cached.gltf'
    const first = loadSource(url)
    expect(loadSource(url)).toBe(first)
    const gltf = await first
    expect(gltf.scene.children.map((c) => c.name)).toEqual(['box'])
    expect(loadSource(url)).toBe(first)
    expect(fetchMock.mock.calls.map(([input]) => urlOf(input))).toEqual([url])
  })

  it('keeps separate entries per URL', async () => {
    const a = loadSource('http://test.local/models/a.gltf')
    const b = loadSource('http://test.local/models/b.gltf')
    expect(a).not.toBe(b)
    await Promise.all([a, b])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('forgets a failed load so the next call tries again', async () => {
    const url = 'http://test.local/models/missing.gltf'
    const failed = loadSource(url)
    expect(loadSource(url)).toBe(failed)
    await expect(failed).rejects.toThrow(/404/)
    const retry = loadSource(url)
    expect(retry).not.toBe(failed)
    await expect(retry).rejects.toThrow(/404/)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
