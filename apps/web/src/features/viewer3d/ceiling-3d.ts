import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { edges } from '@store/shared'
import type { Point, ShopType, SiStyle, Space } from '@store/shared'
import { ceilingModel } from './ceiling-geometry.ts'
import type { CeilingFinish } from './ceiling-geometry.ts'
import { prism } from './scene-geometry.ts'

/** Dark vertical lining closes the distance from the membrane to the recessed cap. */
function filmLining(polygon: readonly Point[], bottom: number, height: number) {
  const positions: number[] = []
  const uv: number[] = []
  for (const [[ax, az], [bx, bz]] of edges(polygon)) {
    const top = bottom + height
    positions.push(
      ax,
      bottom,
      az,
      bx,
      bottom,
      bz,
      bx,
      top,
      bz,
      ax,
      bottom,
      az,
      bx,
      top,
      bz,
      ax,
      top,
      az,
    )
    uv.push(0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1)
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  geometry.computeVertexNormals()
  return geometry
}

const modelCache = new WeakMap<Space, Map<string, ReturnType<typeof ceilingModel>>>()

export function buildCeiling(space: Space, shop: ShopType, si: SiStyle) {
  let options = modelCache.get(space)
  if (!options) {
    options = new Map()
    modelCache.set(space, options)
  }
  const key = shop + ':' + si
  const cached = options.get(key)
  const model = cached ?? ceilingModel(space, shop, si)
  if (!cached) options.set(key, model)
  const { kind, parts, dots } = model
  const group = new THREE.Group()
  group.name = '天花'
  group.userData['ceilingKind'] = kind
  const paint = (color: string, metalness = 0, indirect = 0) =>
    new THREE.MeshStandardMaterial({
      color,
      metalness,
      emissive: color,
      emissiveIntensity: indirect,
      roughness: metalness ? 0.45 : 0.78,
    })
  const materials: Partial<Record<CeilingFinish, THREE.Material>> = {}
  const material = (finish: CeilingFinish) => {
    const current = materials[finish]
    if (current) return current
    switch (finish) {
      case 'gypsum':
        return (materials[finish] = paint('#eeede7', 0, 0.45))
      case 'slot': {
        const dark = paint('#232325')
        dark.side = THREE.DoubleSide
        return (materials[finish] = dark)
      }
      case 'frame':
        return (materials[finish] = paint(si === 'SI1.0' ? '#a2a5a9' : '#45464b', 0.34))
      case 'track':
        return (materials[finish] = paint('#27282a'))
      case 'film':
        return (materials[finish] = new THREE.MeshBasicMaterial({ color: '#fff5e7' }))
      case 'strip':
        return (materials[finish] = new THREE.MeshBasicMaterial({
          color: si === 'SI1.0' ? '#fff1dc' : '#fff7ec',
        }))
    }
  }
  // Merge the fixed panels, frame and rails by finish so complex ceilings use a few draw calls.
  const batches = new Map<CeilingFinish, THREE.BufferGeometry[]>()
  for (const part of parts) {
    const geometry = part.lining
      ? filmLining(part.polygon, part.bottom, part.thickness)
      : prism(part.polygon, part.bottom, part.thickness, part.holes)
    const batch = batches.get(part.finish)
    if (batch) batch.push(geometry)
    else batches.set(part.finish, [geometry])
  }
  for (const [finish, batch] of batches) {
    const geometry = batch.length === 1 ? batch[0]! : mergeGeometries(batch)
    if (batch.length > 1) batch.forEach((part) => part.dispose())
    const mesh = new THREE.Mesh(geometry, material(finish))
    mesh.userData['ceilingFinish'] = finish
    group.add(mesh)
  }
  if (dots.length) {
    const shell = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.026, 0.026, 0.06, 12),
      paint('#f1efe8'),
      dots.length,
    )
    const lens = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.018, 0.018, 0.003, 12),
      new THREE.MeshBasicMaterial({ color: '#fff1dc' }),
      dots.length,
    )
    const transform = new THREE.Matrix4()
    for (const [
      index,
      {
        point: [x, z],
        y,
      },
    ] of dots.entries()) {
      shell.setMatrixAt(index, transform.makeTranslation(x, y, z))
      lens.setMatrixAt(index, transform.makeTranslation(x, y - 0.031, z))
    }
    shell.instanceMatrix.needsUpdate = true
    lens.instanceMatrix.needsUpdate = true
    shell.userData['ceilingFinish'] = 'spot'
    lens.userData['ceilingFinish'] = 'spot'
    group.add(shell, lens)
  }
  return group
}
