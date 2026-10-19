import * as THREE from 'three'
import { rotationTowards } from '@store/shared'
import type { LayoutItem, Point } from '@store/shared'
import { disposeTree } from './scene-geometry.ts'

/**
 * The 3D counterpart of the plan's rotation handle: a flat ring on the floor round the selected
 * prop with a grip behind it (its local −Z side, like the plan handle). Dragging anywhere on the
 * ring turns the prop towards the pointer; both views then show the same angle.
 */

/** Gap between the prop's corners and the ring (metres). */
export const RING_GAP_M = 0.15
const RING_WIDTH_M = 0.04
const GRIP_RADIUS_M = 0.09
/** Just above the floor marks, so the ring is not hidden by them. */
const RING_LIFT_M = 0.015

/** Ring radius round a prop: clear of its corners at any angle. */
export function ringRadius(item: Pick<LayoutItem, 'w' | 'd'>): number {
  return Math.hypot(item.w, item.d) / 2 + RING_GAP_M
}

const material = () =>
  new THREE.MeshBasicMaterial({
    color: '#111111',
    depthTest: false,
    transparent: true,
    opacity: 0.85,
  })

/** A ring for this prop; `userData.rotateRing` holds the item id (for picking). */
export function createRotateRing(item: Pick<LayoutItem, 'id' | 'w' | 'd'>): THREE.Group {
  const group = new THREE.Group()
  group.name = 'rotate-ring'
  group.userData['rotateRing'] = item.id
  const radius = ringRadius(item)
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(radius - RING_WIDTH_M / 2, radius + RING_WIDTH_M / 2, 96),
    material(),
  )
  ring.rotation.x = -Math.PI / 2
  ring.renderOrder = 10
  ring.userData['rotateRing'] = item.id
  const grip = new THREE.Mesh(new THREE.CircleGeometry(GRIP_RADIUS_M, 32), material())
  grip.rotation.x = -Math.PI / 2
  grip.position.set(0, 0, -radius)
  grip.renderOrder = 11
  grip.userData['rotateRing'] = item.id
  group.add(ring, grip)
  return group
}

/** Puts the ring on the prop: centred on it, turned with it (three.js rotation.y = −rotation). */
export function placeRotateRing(
  group: THREE.Group,
  item: Pick<LayoutItem, 'cx' | 'cz' | 'rotation'>,
): void {
  group.position.set(item.cx, RING_LIFT_M, item.cz)
  group.rotation.y = (-item.rotation * Math.PI) / 180
}

/** Frees the ring's geometry and materials. */
export function disposeRotateRing(group: THREE.Group): void {
  disposeTree(group)
}

const FLOOR = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)

/**
 * The rotation that points the grip from the prop's centre at where `ray` meets the floor, or
 * null when the ray runs above the horizon.
 */
export function rotationOnFloor(ray: THREE.Ray, centre: Point): number | null {
  const hit = ray.intersectPlane(FLOOR, new THREE.Vector3())
  return hit ? rotationTowards(centre, [hit.x, hit.z]) : null
}
