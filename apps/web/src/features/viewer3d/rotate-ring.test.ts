import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { rotationHandle } from '@store/shared'
import {
  createRotateRing,
  disposeRotateRing,
  placeRotateRing,
  ringRadius,
  rotationOnFloor,
} from './rotate-ring.ts'

describe('3D rotation ring', () => {
  const item = { id: 'a', cx: 2, cz: 1, w: 1.8, d: 1, rotation: 0 }

  it('clears the corners of the prop at any angle', () => {
    expect(ringRadius(item)).toBeCloseTo(Math.hypot(1.8, 1) / 2 + 0.15, 9)
  })

  it('keeps its grip where the plan handle is, turning with the prop', () => {
    for (const rotation of [0, 30, 90, 225]) {
      const ring = createRotateRing(item)
      placeRotateRing(ring, { ...item, rotation })
      ring.updateMatrixWorld(true)
      const grip = ring.children[1] as THREE.Object3D
      const at = grip.getWorldPosition(new THREE.Vector3())
      const handle = rotationHandle({ ...item, rotation }, 0)
      // Same direction from the centre as the plan's handle.
      const angle = (x: number, z: number) => Math.atan2(x - item.cx, -(z - item.cz))
      expect(angle(at.x, at.z)).toBeCloseTo(angle(handle[0], handle[1]), 6)
      expect(ring.userData['rotateRing']).toBe('a')
      disposeRotateRing(ring)
    }
  })

  it('reads the angle from where the pointer ray meets the floor', () => {
    const towards = (x: number, z: number) =>
      new THREE.Ray(new THREE.Vector3(x, 5, z), new THREE.Vector3(0, -1, 0))
    // Straight behind the prop (−Z): 0°; to its +X side: 90°.
    expect(rotationOnFloor(towards(2, 0), [2, 1])).toBeCloseTo(0, 6)
    expect(rotationOnFloor(towards(3, 1), [2, 1])).toBeCloseTo(90, 6)
    // A ray pointing up never meets the floor.
    const up = new THREE.Ray(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 1, 0))
    expect(rotationOnFloor(up, [0, 0])).toBeNull()
  })
})
