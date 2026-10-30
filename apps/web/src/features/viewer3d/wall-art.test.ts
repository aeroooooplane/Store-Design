import { expect, it } from 'vitest'
import { wallArtAsset, resizeWallArt } from '@store/shared'
import type { LayoutItem } from '@store/shared'
import { wallArt } from './wall-art.ts'

it.each([0, 90, 180, 270, 33])('画片在%s度只旋转一次，保持实际宽高和朝向', (rotation) => {
  const asset = wallArtAsset()
  const item = resizeWallArt(
    {
      id: 'signage-1',
      assetId: asset.id,
      function: 'signage',
      name: asset.name,
      cx: 2,
      cz: 2,
      w: 1.5,
      d: 0.001,
      h: 0.85,
      rotation,
      placeholder: false,
      locked: false,
    } satisfies LayoutItem,
    1.777,
    1.234,
  )
  const mesh = wallArt(item, null, () => {})
  expect(mesh.geometry).toMatchObject({ parameters: { width: 1.777, height: 1.234 } })
  expect(mesh.position.y).toBeCloseTo(1.234 / 2)
  expect(Math.sin(mesh.rotation.y)).toBeCloseTo(-Math.sin((rotation * Math.PI) / 180))
  expect(Math.cos(mesh.rotation.y)).toBeCloseTo(Math.cos((rotation * Math.PI) / 180))
})
