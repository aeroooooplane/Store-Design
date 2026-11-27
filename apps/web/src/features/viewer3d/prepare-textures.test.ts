import * as THREE from 'three'
import { afterEach, expect, it, vi } from 'vitest'
import { prepareModelTextures } from './prepare-textures.ts'

afterEach(() => vi.unstubAllGlobals())

it('uploads preserved textures across frames once, including concurrent shared placements', async () => {
  const frames: Array<FrameRequestCallback> = []
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => frames.push(cb))
  const initTexture = vi.fn()
  const renderer = { initTexture } as unknown as THREE.WebGLRenderer
  const map = new THREE.Texture(),
    normalMap = new THREE.Texture()
  const material = new THREE.MeshStandardMaterial({ map, normalMap, roughnessMap: normalMap })
  material.userData['storeDesignPreserveAppearance'] = true
  const root = new THREE.Mesh(new THREE.BoxGeometry(), material)
  const a = prepareModelTextures(renderer, root)
  const b = prepareModelTextures(renderer, root.clone())
  await vi.waitFor(() => expect(frames).toHaveLength(1))
  expect(initTexture).not.toHaveBeenCalled()
  frames.shift()!(0)
  await vi.waitFor(() => expect(initTexture).toHaveBeenCalledTimes(1))
  await vi.waitFor(() => expect(frames).toHaveLength(1))
  frames.shift()!(16)
  await Promise.all([a, b])
  expect(initTexture.mock.calls).toEqual([[map], [normalMap]])
  expect(material.map).toBe(map)
  expect(material.normalMap).toBe(normalMap)
})

it('does not pre-upload ordinary catalogue textures', async () => {
  const initTexture = vi.fn()
  const root = new THREE.Mesh(
    new THREE.BoxGeometry(),
    new THREE.MeshStandardMaterial({ map: new THREE.Texture() }),
  )
  await prepareModelTextures({ initTexture } as unknown as THREE.WebGLRenderer, root)
  expect(initTexture).not.toHaveBeenCalled()
})

it('does not upload into a disposed renderer and lets a later attempt retry', async () => {
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0))
  const initTexture = vi.fn()
  const renderer = { initTexture } as unknown as THREE.WebGLRenderer
  const material = new THREE.MeshStandardMaterial({ map: new THREE.Texture() })
  material.userData['storeDesignPreserveAppearance'] = true
  const root = new THREE.Mesh(new THREE.BoxGeometry(), material)
  await expect(prepareModelTextures(renderer, root, () => true)).rejects.toThrow('三维视图已关闭')
  expect(initTexture).not.toHaveBeenCalled()
  await prepareModelTextures(renderer, root)
  expect(initTexture).toHaveBeenCalledTimes(1)
})
