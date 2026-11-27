import * as THREE from 'three'
import type { ShopType, SiStyle, Space } from '@store/shared'
import { ceilingModel } from './ceiling-geometry.ts'
import type { CeilingFinish } from './ceiling-geometry.ts'
import { prism } from './scene-geometry.ts'

export function buildCeiling(space: Space, shop: ShopType, si: SiStyle) {
  const { kind, parts, dots } = ceilingModel(space, shop, si)
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
      case 'slot':
        return (materials[finish] = paint('#232325'))
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
  for (const part of parts) {
    const mesh = new THREE.Mesh(
      prism(part.polygon, part.bottom, part.thickness, part.holes),
      material(part.finish),
    )
    mesh.userData['ceilingFinish'] = part.finish
    // The preview fixtures show the SI layout. Existing scene lighting and shadows are shared.
    group.add(mesh)
  }
  if (dots.length) {
    const shell = paint('#f1efe8')
    const warm = new THREE.MeshBasicMaterial({ color: '#fff1dc' })
    for (const {
      point: [x, z],
      y,
    } of dots) {
      const light = new THREE.Group()
      light.position.set(x, y, z)
      light.add(new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.06, 12), shell))
      const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.003, 12), warm)
      lens.position.y = -0.031
      light.userData['ceilingFinish'] = 'spot'
      light.add(lens)
      group.add(light)
    }
  }
  return group
}
