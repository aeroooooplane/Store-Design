import * as THREE from 'three'
import { MODEL_BOUNDARY_MARGIN_M } from '@store/shared'
import type { ShopType, Space } from '@store/shared'
import { boundaryWallMaterial } from './boundary-wall.ts'
import { RENDER_LOOK } from './render-look.ts'
import { offsetOutline } from './outline-offset.ts'

/** Public ground only: a straight, mitred 1 m display offset, excluding the shop floor.
 * Corner mitres do not expand the model's separate 1 m legal-distance limit.
 */
export function contextFloor(
  space: Space,
  shopType: ShopType,
): THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial> | null {
  const padding = MODEL_BOUNDARY_MARGIN_M
  const xs = space.boundary.map((p) => p[0]),
    zs = space.boundary.map((p) => p[1])
  const expanded = offsetOutline(space.boundary, padding)
  const minX = Math.min(Math.min(...xs) - padding, ...expanded.map((p) => p[0])),
    maxX = Math.max(Math.max(...xs) + padding, ...expanded.map((p) => p[0])),
    minZ = Math.min(Math.min(...zs) - padding, ...expanded.map((p) => p[1])),
    maxZ = Math.max(Math.max(...zs) + padding, ...expanded.map((p) => p[1]))
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
  g.lineJoin = 'miter'
  g.miterLimit = 4
  g.lineCap = 'square'
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
