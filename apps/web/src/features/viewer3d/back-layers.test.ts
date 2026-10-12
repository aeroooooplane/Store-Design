import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { separateBackLayers } from './back-layers.ts'

const material = (name: string) => {
  const m = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide })
  m.name = name
  return m
}

/** A mesh of the given triangles (each three [x, y, z] corners). */
function mesh(name: string, triangles: number[][][]) {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(triangles.flat(2), 3))
  return new THREE.Mesh(geometry, material(name))
}

const front: number[][] = [
  [0, 0, 0],
  [1, 0, 0],
  [0, 1, 0],
]
const back = [front[0], front[2], front[1]] as number[][]
const elsewhere: number[][] = [
  [5, 0, 0],
  [6, 0, 0],
  [5, 1, 0],
]

function frontSided(source: THREE.Material) {
  const copy = source.clone()
  copy.side = THREE.FrontSide
  return copy
}

describe('separateBackLayers', () => {
  it('draws the two sides of a SketchUp face front-side only and leaves the rest double-sided', () => {
    const root = new THREE.Group()
    const outside = mesh('Metal_06_1K', [front])
    const inside = mesh('中岛桌面人造石', [back, elsewhere])
    const alone = mesh('支架颜色', [elsewhere.map(([x, y, z]) => [x ?? 0, y ?? 0, (z ?? 0) + 1])])
    root.add(outside, inside, alone)

    expect(separateBackLayers(root, frontSided)).toBe(2)

    expect((outside.material as THREE.Material).side).toBe(THREE.FrontSide)
    expect((alone.material as THREE.Material).side).toBe(THREE.DoubleSide)
    // Mixed: the unpaired triangle first (double-sided), then the paired one (front only).
    const materials = inside.material as unknown as THREE.Material[]
    expect(materials.map((m) => m.side)).toEqual([THREE.DoubleSide, THREE.FrontSide])
    expect(inside.geometry.groups).toEqual([
      { start: 0, count: 3, materialIndex: 0 },
      { start: 3, count: 3, materialIndex: 1 },
    ])
    const index = inside.geometry.index
    expect(index && Array.from(index.array)).toEqual([3, 4, 5, 0, 1, 2])
  })

  it('matches faces in world space and reuses the split for another copy of the model', () => {
    const root = new THREE.Group()
    const outside = mesh('外', [front])
    const inside = mesh('内', [back.map(([x, y, z]) => [(x ?? 0) - 2, y ?? 0, z ?? 0])])
    inside.position.x = 2
    root.add(outside, inside)
    expect(separateBackLayers(root, frontSided)).toBe(2)

    const copy = root.clone(true)
    copy.traverse((node) => {
      if (node instanceof THREE.Mesh) node.material = material('again')
    })
    expect(separateBackLayers(copy, frontSided)).toBe(0)
    copy.traverse((node) => {
      if (node instanceof THREE.Mesh)
        expect((node.material as THREE.Material).side).toBe(THREE.FrontSide)
    })
  })
})
