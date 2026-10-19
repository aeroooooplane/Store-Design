import * as THREE from 'three'
import { facingAfter } from '@store/shared'
import type { FrontAxis, LayoutItem } from '@store/shared'

/**
 * Built-in screens and light boxes (内嵌) in 3D: only their picture, on the wall face, facing
 * into the shop (user 10-15 N1/N2: no solid body, the model's preview with its white margins
 * cropped). The plane hangs in front of the wall by a hair so it does not flicker.
 */

const IN_FRONT_M = 0.003
/** Pixels lighter than this in every channel count as the preview's white margin. */
const WHITE = 235

const textures = new Map<string, Promise<THREE.Texture>>()

/** The preview image with its white border cut off, once per URL. */
export function croppedTexture(url: string): Promise<THREE.Texture> {
  let texture = textures.get(url)
  if (!texture) {
    texture = (async () => {
      const image = new Image()
      image.crossOrigin = 'anonymous'
      image.src = url
      await image.decode()
      const canvas = document.createElement('canvas')
      canvas.width = image.naturalWidth
      canvas.height = image.naturalHeight
      const context = canvas.getContext('2d')
      if (!context) throw new Error('canvas 2d unavailable')
      context.drawImage(image, 0, 0)
      const { data, width, height } = context.getImageData(0, 0, canvas.width, canvas.height)
      let [minX, minY, maxX, maxY] = [width, height, -1, -1]
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const i = (y * width + x) * 4
          if (
            (data[i] ?? 255) >= WHITE &&
            (data[i + 1] ?? 255) >= WHITE &&
            (data[i + 2] ?? 255) >= WHITE
          )
            continue
          if (x < minX) minX = x
          if (x > maxX) maxX = x
          if (y < minY) minY = y
          if (y > maxY) maxY = y
        }
      }
      const crop = document.createElement('canvas')
      const [w, h] = maxX < 0 ? [width, height] : [maxX - minX + 1, maxY - minY + 1]
      crop.width = w
      crop.height = h
      crop
        .getContext('2d')
        ?.drawImage(canvas, maxX < 0 ? 0 : minX, maxX < 0 ? 0 : minY, w, h, 0, 0, w, h)
      const result = new THREE.CanvasTexture(crop)
      result.colorSpace = THREE.SRGBColorSpace
      return result
    })()
    textures.set(url, texture)
  }
  return texture
}

/**
 * The picture of a built-in piece, placed relative to its group at (cx, elevation, cz): on the
 * front face, as wide as the piece along the wall and as tall as it is. Grey until the picture
 * has loaded (or for good, without a preview); `onLoad` asks for a redraw.
 */
export function wallPicture(
  item: Pick<LayoutItem, 'w' | 'd' | 'h' | 'rotation'>,
  front: FrontAxis | null,
  url: string | null,
  onLoad: () => void,
): THREE.Mesh {
  const [fx, fz] = facingAfter(front && front !== 'any' ? front : '+Z', item.rotation)
  const across = fx !== 0 ? item.d : item.w
  const depth = fx !== 0 ? item.w : item.d
  const material = new THREE.MeshBasicMaterial({ color: '#5b6068', side: THREE.FrontSide })
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(across, item.h), material)
  plane.position.set(fx * (depth / 2 + IN_FRONT_M), item.h / 2, fz * (depth / 2 + IN_FRONT_M))
  plane.rotation.y = Math.atan2(fx, fz)
  plane.userData['wallPicture'] = true
  if (url) {
    void croppedTexture(url)
      .then((texture) => {
        material.map = texture
        material.color.set('#ffffff')
        material.needsUpdate = true
        onLoad()
      })
      .catch(() => undefined)
  }
  return plane
}

/**
 * A sign without a web model (双面侧招, user 10-15 Z3): its preview on both large faces of the
 * placeholder box, the faces across its thinnest side. Grouped relative to the box's group.
 */
export function signFaces(
  item: Pick<LayoutItem, 'w' | 'd' | 'h'>,
  url: string,
  onLoad: () => void,
): THREE.Group {
  const group = new THREE.Group()
  const acrossX = item.w < item.d
  const [width, thickness] = acrossX ? [item.d, item.w] : [item.w, item.d]
  const material = new THREE.MeshBasicMaterial({ color: '#d9dadc' })
  for (const side of [1, -1]) {
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(width, item.h), material)
    const offset = side * (thickness / 2 + IN_FRONT_M)
    plane.position.set(acrossX ? offset : 0, item.h / 2, acrossX ? 0 : offset)
    plane.rotation.y = acrossX ? (side * Math.PI) / 2 : side > 0 ? 0 : Math.PI
    group.add(plane)
  }
  void croppedTexture(url)
    .then((texture) => {
      material.map = texture
      material.color.set('#ffffff')
      material.needsUpdate = true
      onLoad()
    })
    .catch(() => undefined)
  return group
}
