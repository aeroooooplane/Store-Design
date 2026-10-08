import {test, expect} from '@playwright/test'
import {realAssets} from '../src/real-assets.js'
import {validateAsset, createAssetItem, assetPose} from '../src/asset-contract.js'
import inventory from '../src/data/asset-library.json' with {type:'json'}

test('placeable core assets share source IDs with the 90 item catalogue and standard names', () => {
  expect(realAssets.length).toBeGreaterThanOrEqual(20)
  expect(new Set(realAssets.map(a => a.id)).size).toBe(realAssets.length)
  for(const asset of realAssets){
    expect(validateAsset(asset)).toBe(asset)
    expect(inventory.assets.find(a => a.id === asset.id)?.webReady).toBe(true)
    expect(asset.standardName).toBeTruthy()
    expect(asset.installation).toBe('floor')
    expect(asset.glbSha256).toMatch(/^[a-f0-9]{64}$/)
    expect(assetPose(createAssetItem(asset, 'placed', 0, 0), asset).position[1]).toBe(0)
  }
})

test('catalogue placement inserts the selected identified model without loading geometry', async({page}) => {
  const models=[]
  page.on('request',r => {if(r.url().endsWith('.glb'))models.push(r.url())})
  await page.goto('/')
  await page.getByRole('button',{name:'生成四个平面方案'}).click()
  await page.locator('.plan-card').first().click()
  await page.getByRole('button',{name:'查看90项资产目录',exact:true}).click()
  const panel=page.getByRole('region',{name:'SU资产目录'})
  await panel.getByLabel('资产编号或名称').fill('asset-41277543')
  await panel.getByRole('button',{name:'加入当前平面'}).click()
  await expect(page.locator('.properties')).toContainText('asset-41277543')
  expect(models).toEqual([])
})

test('standalone catalogue link selects a model and waits for explicit placement', async({page}) => {
  await page.goto('/?asset=asset-41053706')
  const selection=page.getByRole('region',{name:'模型库选定模型'})
  await expect(selection).toContainText('亮脚中岛桌')
  await expect(selection.getByRole('button')).toBeDisabled()
  await page.getByRole('button',{name:'生成四个平面方案'}).click()
  await page.locator('.plan-card').first().click()
  await selection.getByRole('button').click()
  await expect(selection).toHaveCount(0)
  await expect(page.locator('.properties')).toContainText('asset-41053706')
})
