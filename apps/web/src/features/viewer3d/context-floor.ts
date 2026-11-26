import * as THREE from 'three'
import { MODEL_BOUNDARY_MARGIN_M } from '@store/shared'
import type { ShopType, Space } from '@store/shared'
import { boundaryWallMaterial } from './boundary-wall.ts'
import { RENDER_LOOK } from './render-look.ts'

/** Public ground only: a round 1 m buffer, excluding the original shop floor.
 * A canvas mask uses the same distance-to-outline shape for concave and curved outlines,
 * including narrow notches; it does not replace the original tile UVs or legal boundary.
 */
export function contextFloor(
  space: Space,
  shopType: ShopType,
): THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial> | null {
  const padding = MODEL_BOUNDARY_MARGIN_M
  const xs = space.boundary.map((p) => p[0]),
    zs = space.boundary.map((p) => p[1])
  const minX = Math.min(...xs) - padding,
    maxX = Math.max(...xs) + padding,
    minZ = Math.min(...zs) - padding,
    maxZ = Math.max(...zs) + padding
  const w = maxX - minX,
    d = maxZ - minZ,
    px = Math.min(160, 4096 / Math.max(w, d))
  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(w * px)
  canvas.height = Math.ceil(d * px)
  const g = canvas.getContext('2d')
  if (!g) return null
  g.fillStyle = '#000000'
  g.fillRect(0, 0, canvas.width, canvas.height)
  g.setTransform(
    canvas.width / w,
    0,
    0,
    canvas.height / d,
    (-minX * canvas.width) / w,
    (-minZ * canvas.height) / d,
  )
  g.beginPath()
  space.boundary.forEach(([x, z], i) => (i === 0 ? g.moveTo(x, z) : g.lineTo(x, z)))
  g.closePath()
  g.fillStyle = '#ffffff'
  g.strokeStyle = '#ffffff'
  g.lineWidth = padding * 2
  g.lineJoin = 'round'
  g.lineCap = 'round'
  g.fill()
  g.stroke()
  g.fillStyle = '#000000'
  g.fill()
  const mask = new THREE.CanvasTexture(canvas)
  mask.colorSpace = THREE.NoColorSpace
  const material = boundaryWallMaterial()
  material.alphaMap = mask
  const geometry = new THREE.PlaneGeometry(w, d)
  geometry.rotateX(-Math.PI / 2)
  geometry.translate(
    (minX + maxX) / 2,
    shopType === 'island' ? -RENDER_LOOK.edging.height : 0,
    (minZ + maxZ) / 2,
  )
  const mesh = new THREE.Mesh(geometry, material)
  mesh.userData['surface'] = 'floor'
  mesh.userData['contextFloor'] = true
  mesh.userData['ownsMaterial'] = true
  mesh.receiveShadow = true
  return mesh
}
