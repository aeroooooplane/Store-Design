import {test,expect} from '@playwright/test'
import {readFile} from 'node:fs/promises'
import {exportLayoutSvg} from '../src/plan-export.js'

test('SVG preserves metric footprints and safely encodes user labels and provenance',async({page})=>{
  await page.goto('/')
  const result=await page.evaluate(async()=>{
    const {exportLayoutSvg}=await import('/src/plan-export.js')
    const xml=exportLayoutSvg({name:'A <script>alert(1)</script>',room:{w:8,d:6,h:3,shopType:'边厅店'},items:[{id:'a',name:'柜 & 桌',assetId:'asset-408124',x:2,z:3,w:1.8,d:1,h:1.327,rotation:90}]})
    const doc=new DOMParser().parseFromString(xml,'image/svg+xml'),item=doc.querySelector('[data-item-id="a"]')
    return {errors:doc.querySelectorAll('parsererror').length,scripts:doc.querySelectorAll('script').length,
      width:item?.getAttribute('width'),height:item?.getAttribute('height'),x:item?.getAttribute('x'),text:doc.documentElement.textContent,
      asset:item?.getAttribute('data-asset-id'),unit:doc.documentElement.getAttribute('data-unit')}
  })
  expect(result.errors).toBe(0)
  expect(result.scripts).toBe(0)
  expect(result.width).toBe('1.8');expect(result.height).toBe('1');expect(result.x).toBe('2')
  expect(result.asset).toBe('asset-408124');expect(result.unit).toBe('m')
  expect(result.text).toContain('柜 & 桌');expect(result.text).toContain('90°')
  expect(result.text).toContain('非施工图')
})

test('invalid coordinates cannot silently become a corrupt downloadable plan',()=>{
  expect(()=>exportLayoutSvg({room:{w:NaN,d:6,h:3},items:[]})).toThrow()
  expect(()=>exportLayoutSvg({room:{w:8,d:6,h:3},items:[{id:'a',name:'a',x:Infinity,z:0,w:1,d:1,h:1}]})).toThrow()
})

test('editor downloads the active plan as an SVG without changing snapshots',async({page})=>{
  await page.goto('/')
  await page.getByRole('button',{name:'生成四个平面方案'}).click()
  await page.locator('.plan-card').first().click()
  const before=await page.evaluate(()=>localStorage.getItem('insta-studio-v2'))
  const event=page.waitForEvent('download')
  await page.getByRole('button',{name:'导出平面 SVG'}).click({timeout:5000})
  const file=await event,xml=await readFile(await file.path(),'utf8')
  expect(file.suggestedFilename()).toBe('store-plan.svg')
  expect(xml).toContain('data-unit="m"')
  expect(await page.evaluate(()=>localStorage.getItem('insta-studio-v2'))).toBe(before)
  await page.setContent(xml)
  await page.locator('svg').screenshot({path:'../output/web-qa/plan-export.png'})
})
