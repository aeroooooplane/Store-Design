import * as THREE from 'three'
import { FontLoader } from 'three/addons/loaders/FontLoader.js'
import type { Font, FontData } from 'three/addons/loaders/FontLoader.js'
import { DEFAULT_LOGO_TEXT, wallArtSize } from '@store/shared'
import type { LayoutItem } from '@store/shared'
import fontUrl from './fonts/noto-logo.json.gz?url'
import { surface } from './scene-geometry.ts'

let pendingFont: Promise<Font> | null = null
function logoFont() {
  if (!pendingFont) {
    pendingFont = (async () => {
      const response = await fetch(fontUrl)
      if (!response.ok || !response.body) throw new Error('LOGO 字体加载失败')
      const json: unknown = await new Response(
        response.body.pipeThrough(new DecompressionStream('gzip')),
      ).json()
      return new FontLoader().parse(json as FontData)
    })().catch((error: unknown) => {
      pendingFont = null
      throw error
    })
  }
  return pendingFont
}

/** Local, licensed outlines; a real extruded mesh, without a plate or online font service. */
export async function customLogoMesh(item: LayoutItem): Promise<THREE.Mesh> {
  const font = await logoFont()
  const size = wallArtSize(item)
  const geometry = new THREE.ExtrudeGeometry(
    font.generateShapes(item.logoText ?? DEFAULT_LOGO_TEXT, 1),
    {
      depth: size.d,
      bevelEnabled: false,
      curveSegments: 6,
      steps: 1,
    },
  )
  geometry.computeBoundingBox()
  const bounds = geometry.boundingBox!
  const actual = bounds.getSize(new THREE.Vector3())
  if (actual.x <= 0 || actual.y <= 0) {
    geometry.dispose()
    throw new Error('LOGO 字形为空')
  }
  geometry.translate(-(bounds.min.x + bounds.max.x) / 2, -bounds.min.y, -size.d / 2)
  geometry.scale(size.w / actual.x, size.h / actual.y, 1)
  const mesh = new THREE.Mesh(geometry, surface())
  mesh.userData['customLogo'] = true
  mesh.castShadow = true
  mesh.receiveShadow = true
  return mesh
}
