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
        kind: 'column' as const,
        label: '矮柱',
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
  expect(walls).toHaveLength(1)
  for (const mesh of walls) {
    mesh.geometry.computeBoundingBox()
    expect(mesh.geometry.boundingBox!.max.y + mesh.position.y).toBeCloseTo(3.2)
    expect(mesh.geometry.boundingBox!.min.y + mesh.position.y).toBeCloseTo(0)
    expect(mesh.geometry.boundingBox!.min.x).toBeCloseTo(-0.2)
    expect(mesh.geometry.boundingBox!.max.x).toBeCloseTo(8.2)
    const ray = (origin: THREE.Vector3, direction: THREE.Vector3) =>
      new THREE.Raycaster(origin, direction).intersectObject(mesh)
    mesh.updateMatrixWorld(true)
    expect(
      ray(new THREE.Vector3(4, 1, 7), new THREE.Vector3(0, 0, -1))[0]?.distance,
    ).toBeGreaterThan(6)
    expect(
      ray(new THREE.Vector3(9, 1, 1.5), new THREE.Vector3(-1, 0, 0))[0]?.distance,
    ).toBeGreaterThan(8)
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

it('修改成中岛时按当前节点的实际开口生成墙体', () => {
  const base = rectangleSpace(8, 6, 3.2)
  const space = { ...base, shopType: 'island' as const }
  expect(wallSegments(space, 'island')).toEqual(wallSegments(base, 'side_hall'))
  const room = new THREE.Group()
  buildRoom(room, space, 'island', new THREE.MeshStandardMaterial())
  expect(room.children.some((mesh) => mesh.userData['boundaryWall'])).toBe(true)
})

it('中岛店原本没有实际边界墙，不凭空添加围墙', () => {
  const room = new THREE.Group()
  buildRoom(room, rectangleSpace(8, 6, 3.2), 'island', new THREE.MeshStandardMaterial())
  expect(room.children.some((mesh) => mesh.userData['boundaryWall'])).toBe(false)
})
