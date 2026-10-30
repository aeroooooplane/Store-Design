import * as THREE from 'three'
import { WALL_THICKNESS_M, wallSegments } from '@store/shared'
import type { Point, ShopType, Space } from '@store/shared'
import { RENDER_LOOK } from './render-look.ts'
import { prism, signedArea } from './scene-geometry.ts'

/** Legacy white-mode look (demo/src/scene.js in tag archive/pre-cleanup-20261013). */
const FLOOR_THICKNESS_M = 0.16

/** Floor, walls and obstacles of a room, all in the given material, added to `room`. */
export function buildRoom(
  room: THREE.Group,
  space: Space,
  shopType: ShopType,
  material: THREE.Material,
) {
  const floor = new THREE.Mesh(
    prism(space.boundary, -FLOOR_THICKNESS_M, FLOOR_THICKNESS_M),
    material,
  )
  floor.receiveShadow = true
  floor.userData['surface'] = 'floor'
  room.add(floor)
  if (shopType === 'island') addEdging(room, space.boundary, material)

  for (const wall of wallSegments(space, shopType)) {
    const length = Math.hypot(wall.b[0] - wall.a[0], wall.b[1] - wall.a[1])
    const geometry = new THREE.BoxGeometry(length, space.height, WALL_THICKNESS_M)
    const mesh = new THREE.Mesh(geometry, material)
    mesh.userData['surface'] = 'wall'
    mesh.userData['boundaryWall'] = true
    mesh.renderOrder = 1
    const half = WALL_THICKNESS_M / 2
    mesh.position.set(
      (wall.a[0] + wall.b[0]) / 2 + wall.outward[0] * half,
      space.height / 2,
      (wall.a[1] + wall.b[1]) / 2 + wall.outward[1] * half,
    )
    mesh.rotation.y = -Math.atan2(wall.b[1] - wall.a[1], wall.b[0] - wall.a[0])
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
 * (in the white model it is white like everything else).
 */
export function addEdging(room: THREE.Group, boundary: readonly Point[], material: THREE.Material) {
  const { width, height } = RENDER_LOOK.edging
  const sign = signedArea(boundary) > 0 ? 1 : -1
  boundary.forEach((a, i) => {
    const b = boundary[(i + 1) % boundary.length] ?? a
    const length = Math.hypot(b[0] - a[0], b[1] - a[1])
    if (length < 1e-6) return
    const out: Point = [(sign * (b[1] - a[1])) / length, (-sign * (b[0] - a[0])) / length]
    const total = FLOOR_THICKNESS_M + height
    // Lengthened by the strip width at both ends so the corners close.
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(length + 2 * width, total, width), material)
    mesh.position.set(
      (a[0] + b[0]) / 2 + (out[0] * width) / 2,
      height - total / 2,
      (a[1] + b[1]) / 2 + (out[1] * width) / 2,
    )
    mesh.rotation.y = -Math.atan2(b[1] - a[1], b[0] - a[0])
    mesh.castShadow = true
    mesh.receiveShadow = true
    mesh.userData['surface'] = 'edging'
    room.add(mesh)
  })
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
