import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { cropScreenArtwork, screenArtwork } from './screen-artwork.ts'

function panel(width: number, texture: THREE.Texture) {
  return new THREE.Mesh(
    new THREE.PlaneGeometry(width, 1),
    new THREE.MeshBasicMaterial({ map: texture }),
  )
}

describe('screenArtwork', () => {
  it('centre-crops the horizontal axis and keeps the top and bottom of upright artwork', () => {
    expect(cropScreenArtwork([0, 1, 1, 1, 0, 0, 1, 0], 0.5)).toEqual([
      0.25, 1, 0.75, 1, 0.25, 0, 0.75, 0,
    ])
  })
  it('keeps authored UVs and wrapping for a rotated screen and ignores a larger back face', () => {
    const screen = new THREE.Group()
    const texture = new THREE.Texture()
    texture.wrapS = THREE.RepeatWrapping
    const front = panel(1, texture)
    const uv = [1.25, -0.75, 1.75, -0.75, 1.25, -0.25, 1.75, -0.25]
    front.geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
    const back = panel(2, new THREE.Texture())
    back.rotateY(Math.PI)
    screen.add(front, back)
    screen.rotateY(Math.PI / 2)

    expect(screenArtwork(screen, '+X')).toMatchObject({ texture, uv })
  })

  it('returns no artwork when the model only has a textured side panel', () => {
    const side = panel(2, new THREE.Texture())
    side.rotateY(Math.PI / 2)

    expect(screenArtwork(side, '+Z')).toBeNull()
  })
})
