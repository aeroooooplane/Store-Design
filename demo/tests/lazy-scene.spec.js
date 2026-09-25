import {test,expect} from '@playwright/test'

test('floorplan workflow does not download the 3D runtime before white-model confirmation',async({page})=>{
  const requests=[]
  page.on('request',request=>requests.push(request.url()))
  await page.goto('/')
  await page.getByRole('button',{name:'生成四个平面方案'}).click()
  await page.locator('.plan-card').first().click()
  expect(requests.filter(url=>/\/(scene|asset-viewer)\.js|\/three(?:\.js|_)/.test(url))).toEqual([])
  await page.getByRole('button',{name:'确认平面并生成白膜'}).click()
  await expect(page.getByRole('button',{name:'确认白膜，渲染八视角'})).toBeEnabled()
  expect(requests.some(url=>url.includes('/src/scene.js'))).toBe(true)
})

test('3D module download failure leaves the editor usable and forbids incomplete render',async({page})=>{
  await page.route('**/src/scene.js*',route=>route.abort())
  await page.goto('/')
  await page.getByRole('button',{name:'生成四个平面方案'}).click({timeout:5000})
  await page.locator('.plan-card').first().click()
  await page.getByRole('button',{name:'确认平面并生成白膜'}).click()
  await expect(page.getByRole('alert')).toContainText('三维')
  await expect(page.getByRole('button',{name:'确认白膜，渲染八视角'})).toBeDisabled()
  await page.getByRole('button',{name:'＋ 新建尺寸方案'}).click()
  await expect(page.getByRole('button',{name:'生成四个平面方案'})).toBeVisible()
})

test('closing preview while its code downloads never starts a late model fetch',async({page})=>{
  let release,started
  const gate=new Promise(resolve=>release=resolve),requested=new Promise(resolve=>started=resolve)
  await page.route('**/src/asset-viewer.js*',async route=>{started();await gate;await route.continue()})
  const assets=[]
  page.on('request',request=>{if(request.url().includes('.glb'))assets.push(request.url())})
  await page.goto('/')
  await page.getByRole('button',{name:'预览真实 SU 体验桌'}).click()
  await requested
  await page.getByRole('button',{name:'关闭道具预览'}).click()
  release()
  // The import settles, but the unmounted preview must not create a viewer.
  await page.evaluate(()=>import('/src/asset-viewer.js'))
  await expect(page.locator('canvas[aria-label="真实 SU 道具三维预览"]')).toHaveCount(0)
  expect(assets).toEqual([])
})
