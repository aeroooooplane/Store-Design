import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
export const silver = 0xb9bfc6
export function trayParts(group: THREE.Group) {
  function part(geometry: THREE.BufferGeometry, color: number, x: number, y: number, z: number) {
    const material = new THREE.MeshStandardMaterial({
      color,
      metalness: color === silver ? 0.55 : 0.12,
      roughness: 0.43,
    })
    const mesh = new THREE.Mesh(geometry, material)
    mesh.position.set(x, y, z)
    group.add(mesh)
    return mesh
  }
  function box(
    w: number,
    h: number,
    d: number,
    x: number,
    y: number,
    z: number,
    color: number,
    radius = 0,
  ) {
    return part(
      radius ? new RoundedBoxGeometry(w, h, d, 3, radius) : new THREE.BoxGeometry(w, h, d),
      color,
      x,
      y,
      z,
    )
  }
  function post(
    radius: number,
    height: number,
    x: number,
    bottom: number,
    z: number,
    color: number,
  ) {
    return part(
      new THREE.CylinderGeometry(radius, radius, height, 24),
      color,
      x,
      bottom + height / 2,
      z,
    )
  }
  return { part, box, post }
}
