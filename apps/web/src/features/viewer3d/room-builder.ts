import * as THREE from 'three'
import type { Point, ShopType, Space } from '@store/shared'
import { prism } from './scene-geometry.ts'
import { boundaryWallGeometry } from './boundary-wall.ts'
import { contextFloor } from './context-floor.ts'
import { islandEdgingGeometry, ISLAND_PLATFORM_HEIGHT_M } from './island-platform.ts'

/** Legacy white-mode look (demo/src/scene.js in tag archive/pre-cleanup-20261013). */
const FLOOR_THICKNESS_M = 0.16

/** Floor, walls and obstacles of a room, all in the given material, added to `room`. */
export function buildRoom(
  room: THREE.Group,
  space: Space,
  shopType: ShopType,
  material: THREE.Material,
) {
  const thickness = shopType === 'island' ? ISLAND_PLATFORM_HEIGHT_M : FLOOR_THICKNESS_M
  const floor = new THREE.Mesh(prism(space.boundary, -thickness, thickness), material)
  floor.receiveShadow = true
  floor.userData['surface'] = 'floor'
  room.add(floor)
  const outside = contextFloor(space, shopType)
  if (outside) room.add(outside)
  if (shopType === 'island') addEdging(room, space.boundary, material)

  const geometry = boundaryWallGeometry(space, shopType)
  if (geometry) {
    const mesh = new THREE.Mesh(geometry, material)
    mesh.userData['surface'] = 'wall'
    mesh.userData['boundaryWall'] = true
    mesh.renderOrder = 1
    // 透明墙只提供空间轮廓，不投射原先实心墙的全黑遮挡。
    mesh.castShadow = false
    mesh.receiveShadow = false
    room.add(mesh)
  }

  for (const obstacle of space.obstacles) {
    const height = obstacle.height ?? space.height
    const mesh = new THREE.Mesh(prism(obstacle.polygon, 0, height), material)
    mesh.userData['surface'] = 'wall'
    mesh.castShadow = true
    mesh.receiveShadow = true
    room.add(mesh)
  }
}

/**
 * 中岛店: continuous stainless edging around the raised floor, following the real outline
 * 30 mm rise; silver slope follows the SI manual (45° only where no slope is dimensioned).
 */
export function addEdging(room: THREE.Group, boundary: readonly Point[], material: THREE.Material) {
  const mesh = new THREE.Mesh(islandEdgingGeometry(boundary), material)
  mesh.castShadow = true
  mesh.receiveShadow = true
  mesh.userData['surface'] = 'edging'
  mesh.userData['edgingStyle'] = 'SI1.0'
  room.add(mesh)
}

/** Re-aims the sun and its shadow camera at the room. */
export function aimSun(sun: THREE.DirectionalLight, space: Space) {
  const xs = space.boundary.map((p) => p[0])
  const zs = space.boundary.map((p) => p[1])
  const [minX, maxX, minZ, maxZ] = [
    Math.min(...xs),
    Math.max(...xs),
    Math.min(...zs),
    Math.max(...zs),
  ]
  const span = Math.max(maxX - minX, maxZ - minZ, 1)
  sun.position.set(minX + (maxX - minX) * 0.4, space.height * 3, minZ + (maxZ - minZ) * 0.8)
  sun.target.position.set((minX + maxX) / 2, 0, (minZ + maxZ) / 2)
  const shadow = sun.shadow.camera
  shadow.left = shadow.bottom = -span
  shadow.right = shadow.top = span
  shadow.far = span * 8
  shadow.updateProjectionMatrix()
}
