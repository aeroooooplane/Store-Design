import * as THREE from 'three'
import { facingAfter } from '@store/shared'
import type { FrontAxis } from '@store/shared'

const RECT_TOLERANCE = 0.001

interface ScreenArtwork {
  texture: THREE.Texture
  /** Top left, top right, bottom left, bottom right, as in PlaneGeometry. */
  uv: number[]
  area: number
}

/** Take the largest front-facing textured rectangle, excluding the housing and rear faces. */
export function screenArtwork(root: THREE.Object3D, front: FrontAxis | null): ScreenArtwork | null {
  const [fx, fz] = facingAfter(front && front !== 'any' ? front : '+Z', 0)
  const position = new THREE.Vector3()
  let artwork: ScreenArtwork | null = null
  root.updateMatrixWorld(true)
  root.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return
    const material: unknown = node.material
    if (!(
      material instanceof THREE.MeshStandardMaterial || material instanceof THREE.MeshBasicMaterial
    ))
      return
    const texture = material.map
    if (!texture || texture.channel !== 0) return
    const geometry = node.geometry as THREE.BufferGeometry
    const positions = geometry.getAttribute('position')
    const uv = geometry.getAttribute('uv')
    const index = geometry.getIndex()
    if (positions?.count !== 4 || uv?.count !== 4 || index?.count !== 6) return

    const corners = Array.from({ length: 4 }, (_, i) => {
      position.fromBufferAttribute(positions, i).applyMatrix4(node.matrixWorld)
      return {
        x: position.x * fz - position.z * fx,
        y: position.y,
        depth: position.x * fx + position.z * fz,
        u: uv.getX(i),
        v: uv.getY(i),
      }
    })
    const a = corners[index.getX(0)]
    const b = corners[index.getX(1)]
    const c = corners[index.getX(2)]
    if (!a || !b || !c || (b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y) <= 0) return
    const minX = Math.min(...corners.map((p) => p.x))
    const maxX = Math.max(...corners.map((p) => p.x))
    const minY = Math.min(...corners.map((p) => p.y))
    const maxY = Math.max(...corners.map((p) => p.y))
    const width = maxX - minX
    const height = maxY - minY
    if (
      width <= RECT_TOLERANCE ||
      height <= RECT_TOLERANCE ||
      (artwork && width * height <= artwork.area)
    )
      return
    if (corners.some((p) => Math.abs(p.depth - a.depth) > RECT_TOLERANCE)) return

    const destinations = [
      [minX, maxY],
      [maxX, maxY],
      [minX, minY],
      [maxX, minY],
    ] as const
    const authoredUv: number[] = []
    for (const [x, y] of destinations) {
      const corner = corners.find(
        (p) => Math.abs(p.x - x) <= RECT_TOLERANCE && Math.abs(p.y - y) <= RECT_TOLERANCE,
      )
      if (!corner) return
      authoredUv.push(corner.u, corner.v)
    }
    artwork = {
      texture,
      // Preserve the authored UVs and GLB sampler, including wrapping and negative coordinates.
      uv: authoredUv,
      area: width * height,
    }
  })
  return artwork
}
