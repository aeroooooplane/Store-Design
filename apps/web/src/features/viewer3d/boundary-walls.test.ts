import * as THREE from 'three'
import { expect, it } from 'vitest'
import { rectangleSpace, wallSegments } from '@store/shared'
import { buildRoom } from './room-builder.ts'
import { boundaryWallMaterial } from './boundary-wall.ts'

it('所有实际边界段按层高展示，保留入口、开边及平面范围；矮柱不被拉高', () => {
  const space = {
    ...rectangleSpace(8, 6, 3.2),
    entrances: [
      { a: [3, 6] as [number, number], b: [5, 6] as [number, number], kind: 'main' as const },
    ],
    openEdges: [{ a: [8, 1] as [number, number], b: [8, 2] as [number, number] }],
    obstacles: [
      {
        id: 'column-1',
        name: '矮柱',
        polygon: [
          [1, 1],
          [1.5, 1],
          [1.5, 1.5],
          [1, 1.5],
        ] as [number, number][],
        height: 1.2,
      },
    ],
  }
  const before = structuredClone(space)
  const room = new THREE.Group()
  buildRoom(room, space, 'side_hall', new THREE.MeshStandardMaterial())
  const walls = room.children.filter((mesh) => mesh.userData['boundaryWall']) as THREE.Mesh[]
  const segments = wallSegments(space, 'side_hall')
  expect(walls).toHaveLength(segments.length)
  for (const [index, mesh] of walls.entries()) {
    const wall = segments[index]!
    expect(mesh.geometry).toMatchObject({
      parameters: {
        height: 3.2,
        width: Math.hypot(wall.b[0] - wall.a[0], wall.b[1] - wall.a[1]),
      },
    })
    mesh.geometry.computeBoundingBox()
    expect(mesh.geometry.boundingBox!.max.y + mesh.position.y).toBeCloseTo(3.2)
    expect(mesh.geometry.boundingBox!.min.y + mesh.position.y).toBeCloseTo(0)
    expect(mesh.position.x).toBeCloseTo((wall.a[0] + wall.b[0]) / 2 + wall.outward[0] * 0.08)
    expect(mesh.position.z).toBeCloseTo((wall.a[1] + wall.b[1]) / 2 + wall.outward[1] * 0.08)
    expect(mesh.castShadow).toBe(false)
  }
  const obstacle = room.children.find(
    (mesh) => mesh.userData['surface'] === 'wall' && !mesh.userData['boundaryWall'],
  ) as THREE.Mesh
  obstacle.geometry.computeBoundingBox()
  expect(obstacle.geometry.boundingBox!.max.y).toBeCloseTo(1.2)
  expect(space).toEqual(before)
})

it('灰色透明墙不写深度；白模/材质共用它，避免遮住店内物件', () => {
  const material = boundaryWallMaterial()
  expect(material.transparent).toBe(true)
  expect(material.opacity).toBe(0.24)
  expect(material.depthWrite).toBe(false)
  expect(material.side).toBe(THREE.FrontSide)
  expect(material.color.r).toBe(material.color.g)
  expect(material.color.g).toBe(material.color.b)
  material.dispose()
})

it('中岛店原本没有实际边界墙，不凭空添加围墙', () => {
  const room = new THREE.Group()
  buildRoom(room, rectangleSpace(8, 6, 3.2), 'island', new THREE.MeshStandardMaterial())
  expect(room.children.some((mesh) => mesh.userData['boundaryWall'])).toBe(false)
})
