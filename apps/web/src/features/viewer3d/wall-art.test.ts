import { expect, it } from 'vitest'
import { itemTilt, wallArtAsset, resizeWallArt } from '@store/shared'
import type { LayoutItem } from '@store/shared'
import { wallPicture } from './wall-picture.ts'
import { displayPanelBody } from './display-panel-body.ts'

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
      w: rotation === 90 || rotation === 270 ? 0.001 : 1.5,
      d: rotation === 90 || rotation === 270 ? 1.5 : 0.001,
      h: 0.85,
      rotation,
      placeholder: false,
      locked: false,
    } satisfies LayoutItem,
    1.777,
    1.234,
  )
  const { plane: mesh } = wallPicture(item, '+Z', null)
  expect(mesh.geometry).toMatchObject({ parameters: { width: 1.777, height: 1.234 } })
  expect(mesh.position.y).toBeCloseTo(1.234 / 2)
  const worldYaw = mesh.rotation.y - (itemTilt(item) * Math.PI) / 180
  expect(Math.sin(worldYaw)).toBeCloseTo(-Math.sin((rotation * Math.PI) / 180))
  expect(Math.cos(worldYaw)).toBeCloseTo(Math.cos((rotation * Math.PI) / 180))
})

it('悬空体块的两根挂柱位于四分点，延伸至层高，贴墙时消失', () => {
  const asset = wallArtAsset()
  const item: LayoutItem = {
    id: 'signage-1',
    assetId: asset.id,
    function: 'signage',
    name: asset.name,
    cx: 2,
    cz: 2,
    ...asset.footprint,
    rotation: 0,
    mount: 'ceiling',
    elevation: 1,
    placeholder: false,
    locked: false,
  }
  const body = displayPanelBody(item, '+Z', 3.2)
  const rods = body.children.filter((child) => child.userData['ceilingRod'])
  expect(rods.map((rod) => rod.position.x)).toEqual([-0.425, 0.425])
  expect(rods[0]?.position.y).toBeCloseTo((1.98 + 3.2) / 2 - 1)
  expect(displayPanelBody({ ...item, mount: 'wall' }, '+Z', 3.2).children).toHaveLength(1)
})
