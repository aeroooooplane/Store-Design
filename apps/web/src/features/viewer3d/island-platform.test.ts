import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { rectangleSpace } from '@store/shared'
import type { Point } from '@store/shared'
import { islandEdgingGeometry } from './island-platform.ts'
import { buildRoom } from './room-builder.ts'

describe('中岛30mm台地', () => {
  it('台地顶面保持模型地面0，底面只有30mm，边厅不带收口', () => {
    for (const type of ['island', 'side_hall'] as const) {
      const room = new THREE.Group()
      buildRoom(room, rectangleSpace(8, 6, 3), type, new THREE.MeshStandardMaterial())
      const floor = room.children.find((m) => m.userData['surface'] === 'floor') as THREE.Mesh
      floor.geometry.computeBoundingBox()
      expect(floor.geometry.boundingBox!.max.y).toBeCloseTo(0)
      expect(floor.geometry.boundingBox!.min.y).toBeCloseTo(type === 'island' ? -0.03 : -0.16)
      expect(room.children.filter((m) => m.userData['surface'] === 'edging')).toHaveLength(
        type === 'island' ? 1 : 0,
      )
    }
  })
  it('矩形和L形收口所有外坡均为45度，顺逆时针都封闭，角上无断缝', () => {
    const shapes: Point[][] = [
      rectangleSpace(8, 6, 3).boundary,
      [
        [0, 0],
        [5, 0],
        [5, 2],
        [2, 2],
        [2, 5],
        [0, 5],
      ],
    ]
    for (const shape of shapes)
      for (const ring of [shape, [...shape].reverse()]) {
        const g = islandEdgingGeometry(ring),
          p = g.attributes['position']!,
          n = g.attributes['normal']!
        g.computeBoundingBox()
        expect(g.boundingBox!.max.y).toBeCloseTo(0)
        expect(g.boundingBox!.min.y).toBeCloseTo(-0.03)
        let slopes = 0
        const edges = new Map<string, number>()
        for (let i = 0; i < p.count; i += 3) {
          const key = (j: number) =>
            [p.getX(j), p.getY(j), p.getZ(j)].map((v) => v.toFixed(6)).join(',')
          for (let k = 0; k < 3; k++) {
            const pair = [key(i + k), key(i + ((k + 1) % 3))].sort().join('|')
            edges.set(pair, (edges.get(pair) ?? 0) + 1)
          }
          const up = n.getY(i)
          if (up > 0.01 && up < 0.99) {
            slopes++
            expect(up).toBeCloseTo(Math.SQRT1_2, 5)
          }
        }
        expect(slopes).toBe(ring.length * 2)
        expect([...edges.values()].every((count) => count === 2)).toBe(true)
        g.dispose()
      }
  })
})
