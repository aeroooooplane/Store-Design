import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { customLogoAsset } from '@store/shared'
import type { LayoutItem } from '@store/shared'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetModules()
})
describe('离线字形三维加载', () => {
  for (const encoding of ['gzip', 'decoded'])
    it(`真实字形支持 ${encoding} 静态响应`, async () => {
      const gzip = readFileSync('src/features/viewer3d/fonts/noto-logo.json.gz')
      const bytes = encoding === 'gzip' ? gzip : gunzipSync(gzip)
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(new Uint8Array(bytes).buffer)))
      const { customLogoMesh } = await import('./custom-logo.ts')
      const asset = customLogoAsset('影石 Insta360')
      const mesh = await customLogoMesh({
        id: 'logo',
        ...asset.footprint,
        rotation: 0,
        logoText: '影石 Insta360',
      } as LayoutItem)
      mesh.geometry.computeBoundingBox()
      const box = mesh.geometry.boundingBox!
      expect(box.max.x - box.min.x).toBeCloseTo(asset.footprint.w, 5)
      expect(box.max.y - box.min.y).toBeCloseTo(0.3, 5)
      expect(box.max.z - box.min.z).toBeCloseTo(0.03, 5)
      expect(mesh.geometry.attributes.position!.count).toBeGreaterThan(1000)
      mesh.geometry.dispose()
      mesh.material.dispose()
    })
})
