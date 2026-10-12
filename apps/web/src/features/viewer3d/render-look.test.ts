import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { finishMaterial } from './render-look.ts'

describe('finishMaterial', () => {
  it('draws props double-sided, except faces the light model marks front-side only', () => {
    const plain = new THREE.MeshStandardMaterial()
    expect(finishMaterial(plain, null).side).toBe(THREE.DoubleSide)

    const marked = new THREE.MeshStandardMaterial()
    marked.userData['frontOnly'] = true
    const finished = finishMaterial(marked, null)
    expect(finished.side).toBe(THREE.FrontSide)
    expect(finished).not.toBe(marked)
  })
})
