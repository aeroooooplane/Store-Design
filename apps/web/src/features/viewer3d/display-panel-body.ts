import * as THREE from 'three'
import { facingAfter, itemElevation, itemMount, nearestQuarter } from '@store/shared'
import type { FrontAxis, LayoutItem } from '@store/shared'

/** Solid cabinet and, for a freestanding panel, its two ceiling rods. */
export function displayPanelBody(item: LayoutItem, front: FrontAxis | null, ceiling: number) {
  const group = new THREE.Group()
  group.userData['displayPanelBody'] = true
  const housing = new THREE.Mesh(
    new THREE.BoxGeometry(item.w, item.h, item.d),
    new THREE.MeshStandardMaterial({ color: '#44484c', roughness: 0.72 }),
  )
  housing.position.y = item.h / 2
  group.add(housing)
  const rodLength = ceiling - itemElevation(item) - item.h
  if (itemMount(item) !== 'ceiling' || rodLength <= 0) return group
  const [fx, fz] = facingAfter(
    front && front !== 'any' ? front : '+Z',
    nearestQuarter(item.rotation),
  )
  const quarter = (fx !== 0 ? item.d : item.w) / 4
  for (const side of [-1, 1]) {
    const rod = new THREE.Mesh(
      new THREE.CylinderGeometry(0.009, 0.009, rodLength, 8),
      new THREE.MeshStandardMaterial({ color: '#585d64', roughness: 0.55 }),
    )
    rod.position.set(side * fz * quarter, item.h + rodLength / 2, -side * fx * quarter)
    rod.userData['ceilingRod'] = true
    group.add(rod)
  }
  return group
}
