// @vitest-environment jsdom

import { Box3, Mesh, MeshStandardMaterial } from 'three'
import { describe, expect, it } from 'vitest'
import { rectangleSpace } from '@store/shared'
import type { Facade, Space } from '@store/shared'
import { buildFacade3d } from './facade-3d.ts'

const room = rectangleSpace(8, 6, 3.2)
const facade: Facade = {
  a: [8, 0],
  b: [8, 6],
  openingWidth: 2.5,
  clearHeight: 2.6,
  fasciaHeight: 0.6,
  screenInset: 0.05,
}

function meshes(space: Space, si: 'SI1.0' | 'SI2.0') {
  const root = buildFacade3d(space, si, 'domestic')!
  const parts: Array<{ bounds: Box3; color: string }> = []
  root.traverse((node) => {
    if (node instanceof Mesh && node.material instanceof MeshStandardMaterial) {
      parts.push({
        bounds: new Box3().setFromObject(node),
        color: node.material.color.getHexString(),
      })
    }
  })
  return { bounds: new Box3().setFromObject(root), parts }
}

describe('exterior straight facade', () => {
  it.each([
    ['SI1.0', '999c9e'],
    ['SI2.0', '42444a'],
  ] as const)('covers both original wall lengths in %s colour', (si, color) => {
    const { bounds, parts } = meshes(
      {
        ...room,
        openEdges: [{ a: [8, 1], b: [8, 3.5] }],
        facade,
      },
      si,
    )
    const jambs = parts
      .filter(({ bounds }) => bounds.min.y < 0.001)
      .sort((a, b) => a.bounds.min.z - b.bounds.min.z)
    expect(bounds.min.x).toBeCloseTo(8)
    expect(bounds.max.x).toBeGreaterThan(8.2)
    expect(jambs).toHaveLength(2)
    for (const jamb of jambs) {
      expect(jamb.bounds.min.x).toBeCloseTo(8)
      expect(jamb.bounds.max.y).toBeCloseTo(2.6)
      expect(jamb.color).toBe(color)
    }
    expect(jambs[0]?.bounds.max.z).toBeCloseTo(1)
    expect(jambs[1]?.bounds.min.z).toBeCloseTo(3.5)
  })

  it('leaves the fully open facade clear below the exterior fascia', () => {
    const { bounds } = meshes(
      {
        ...room,
        openEdges: [{ a: [8, 0], b: [8, 6] }],
        facade: { ...facade, openingWidth: 6 },
      },
      'SI2.0',
    )
    expect(bounds.min.x).toBeCloseTo(8)
    expect(bounds.min.y).toBeGreaterThanOrEqual(2.5999)
    expect(bounds.max.x).toBeGreaterThan(8.2)
  })
})
