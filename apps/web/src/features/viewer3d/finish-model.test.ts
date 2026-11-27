import * as THREE from 'three'
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js'
import { expect, it, vi } from 'vitest'
import { finishModel } from './finish-model.ts'
import { separateBackLayers } from './back-layers.ts'

vi.mock('./back-layers.ts', () => ({ separateBackLayers: vi.fn() }))

it('preserves reviewed PBR values and shares textures and geometry across placements', () => {
  const texture = new THREE.Texture()
  const source = new THREE.MeshStandardMaterial({
    map: texture,
    normalMap: texture,
    roughness: 1,
    metalness: 1,
    flatShading: false,
    side: THREE.FrontSide,
  })
  source.normalScale.set(1, -1)
  source.userData['storeDesignPreserveAppearance'] = true
  const scene = new THREE.Group()
  const geometry = new THREE.BoxGeometry()
  scene.add(new THREE.Mesh(geometry, source))
  const materials = new Map<THREE.Material, THREE.Material>()
  const frontSided = vi.fn((m: THREE.Material) => m)
  const gltf = { scene } as unknown as GLTF
  const first = finishModel(gltf, true, null, materials, frontSided).children[0] as THREE.Mesh
  const second = finishModel(gltf, true, null, materials, frontSided).children[0] as THREE.Mesh
  const finished = first.material as THREE.MeshStandardMaterial
  expect(finished).not.toBe(source)
  expect(second.material).toBe(finished)
  expect(first.geometry).toBe(geometry)
  expect(second.geometry).toBe(geometry)
  expect(finished.map).toBe(texture)
  expect(finished.normalMap).toBe(texture)
  expect(finished.normalScale.toArray()).toEqual([1, -1])
  expect([finished.roughness, finished.metalness, finished.side, finished.flatShading]).toEqual([
    1,
    1,
    THREE.FrontSide,
    false,
  ])
  expect(frontSided).not.toHaveBeenCalled()
})

it('keeps the normal catalogue finish path for untagged materials', () => {
  const scene = new THREE.Group()
  scene.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial()))
  const root = finishModel({ scene } as unknown as GLTF, true, null, new Map(), (m) => m)
  expect(
    ((root.children[0] as THREE.Mesh).material as THREE.MeshStandardMaterial).flatShading,
  ).toBe(true)
})

it('skips the SketchUp back-layer scan for a preserved source fallback', () => {
  vi.mocked(separateBackLayers).mockClear()
  const material = new THREE.MeshStandardMaterial()
  material.userData['storeDesignPreserveAppearance'] = true
  const scene = new THREE.Group()
  scene.add(new THREE.Mesh(new THREE.BoxGeometry(), material))
  finishModel({ scene } as unknown as GLTF, false, null, new Map(), (m) => m)
  expect(separateBackLayers).not.toHaveBeenCalled()
  material.userData['storeDesignPreserveAppearance'] = false
  finishModel({ scene } as unknown as GLTF, false, null, new Map(), (m) => m)
  expect(separateBackLayers).toHaveBeenCalledTimes(1)
})
