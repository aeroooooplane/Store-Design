import * as THREE from 'three'
import type { LayoutItem, Point } from '@store/shared'

/** Legacy white-mode look (demo/src/scene.js in tag archive/pre-cleanup-20261013). */
export const WHITE = '#f7f7f5'

export type AnyMaterial = THREE.Material | THREE.Material[]
export type Drawable =
  | THREE.Mesh<THREE.BufferGeometry, AnyMaterial>
  | THREE.LineSegments<THREE.BufferGeometry, AnyMaterial>
export const isDrawable = (node: THREE.Object3D): node is Drawable =>
  node instanceof THREE.Mesh || node instanceof THREE.LineSegments

// ---- geometry helpers ----

/** Plan polygon extruded upwards from y = bottom; plan z maps to scene z. */
export function prism(
  polygon: readonly Point[],
  bottom: number,
  height: number,
): THREE.BufferGeometry {
  const shape = new THREE.Shape(polygon.map(([x, z]) => new THREE.Vector2(x, -z)))
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false })
  geometry.rotateX(-Math.PI / 2)
  geometry.translate(0, bottom, 0)
  return geometry
}

export function surface(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: WHITE, roughness: 0.8, metalness: 0 })
}

/** Room meshes share their materials, so only the geometry is freed with them. */
export function disposeGeometry(root: THREE.Object3D) {
  root.traverse((node) => {
    if (isDrawable(node)) node.geometry.dispose()
  })
}

/** Signed area of a plan polygon; positive when the outward normal of a→b is (dz, −dx). */
export function signedArea(polygon: readonly Point[]): number {
  let area = 0
  polygon.forEach(([x1, z1], i) => {
    const [x2, z2] = polygon[(i + 1) % polygon.length] ?? [x1, z1]
    area += x1 * z2 - x2 * z1
  })
  return area / 2
}

export function disposeTree(root: THREE.Object3D) {
  root.traverse((node) => {
    if (isDrawable(node)) {
      node.geometry.dispose()
      const materials = Array.isArray(node.material) ? node.material : [node.material]
      materials.forEach((m) => m.dispose())
    }
  })
}

/** Outlined box for an item without a loadable model (footprint is already rotated). */
export function placeholderBox(item: LayoutItem): THREE.Object3D {
  const geometry = new THREE.BoxGeometry(item.w, item.h, item.d)
  geometry.translate(0, item.h / 2, 0)
  const box = new THREE.Mesh(geometry, surface())
  box.castShadow = true
  box.receiveShadow = true
  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(geometry),
    new THREE.LineBasicMaterial({ color: '#888888' }),
  )
  box.add(edges)
  box.userData['placeholder'] = true
  return box
}

export const toVec3 = (v: THREE.Vector3): [number, number, number] => [
  Math.round(v.x * 1000) / 1000,
  Math.round(v.y * 1000) / 1000,
  Math.round(v.z * 1000) / 1000,
]
