import * as THREE from 'three'
import { turnPoint, wallArtSize } from '@store/shared'
import type { LayoutItem } from '@store/shared'

/** 标准灯箱按画片绘制；图库未接入时使用素色，不调用旧灯箱GLB或预览裁切。 */
export function wallArt(item: LayoutItem, imageUrl: string | null, onLoad: () => void): THREE.Mesh {
  const size = wallArtSize(item)
  const [fx, fz] = turnPoint(0, 1, item.rotation)
  const material = new THREE.MeshBasicMaterial({ color: '#747b84', side: THREE.FrontSide })
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(size.w, size.h), material)
  plane.position.set(fx * (size.d / 2 + 0.003), size.h / 2, fz * (size.d / 2 + 0.003))
  plane.rotation.y = Math.atan2(fx, fz)
  plane.userData['wallArt'] = true
  let active = true
  material.addEventListener('dispose', () => {
    active = false
    material.map?.dispose()
  })
  if (imageUrl)
    new THREE.TextureLoader().load(
      imageUrl,
      (texture) => {
        if (!active) {
          texture.dispose()
          return
        }
        texture.colorSpace = THREE.SRGBColorSpace
        material.map = texture
        material.color.set('#ffffff')
        material.needsUpdate = true
        onLoad()
      },
      undefined,
      () => undefined,
    )
  return plane
}
