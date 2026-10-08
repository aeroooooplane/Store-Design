import {test,expect} from '@playwright/test'
import {issues} from '../src/layout.js'
import {exportLayoutSvg} from '../src/plan-export.js'
import {realAssets} from '../src/real-assets.js'
import {createAssetItem} from '../src/asset-contract.js'
const item=createAssetItem(realAssets[1],'display',1,1)
const layout={room:{w:8,d:6,h:2,shopType:'边厅店'},items:[item]}
test('over-height real furniture is flagged without scaling and cannot be exported as a checked plan',()=>{
  const before=structuredClone(layout)
  expect(issues(layout)).toContain(`${item.name}高度超过层高`)
  expect(()=>exportLayoutSvg(layout)).toThrow('高度超过层高')
  expect(layout).toEqual(before)
  expect(issues({...layout,room:{...layout.room,h:item.h}})).toEqual([])
  expect(issues({...layout,room:{...layout.room,h:item.h-.0005}})).toEqual([])
})
test('legacy over-height layouts stay editable but cannot confirm a white model',async({page})=>{
  const project={nodes:[{id:'r',kind:'root',name:'低层高',room:layout.room},{id:'p',parent:'r',kind:'plan',name:'待核平面',layout}]}
  await page.goto('/')
  await page.evaluate(p=>localStorage.setItem('insta-studio-v2',JSON.stringify(p)),project)
  await page.reload()
  await page.locator('.plan-card').first().click()
  await expect(page.locator('.properties .warning')).toContainText('高度超过层高')
  await expect(page.getByRole('button',{name:'确认平面并生成白膜 →'})).toBeDisabled()
  expect(await page.evaluate(async()=>JSON.parse((await (await import('/src/project-db.js')).readProjectRaw())).nodes[1].layout.items[0])).toEqual(item)
  await page.locator('.drawing .plan g').first().click()
  await page.getByRole('button',{name:'删除',exact:true}).click()
  await expect(page.getByRole('button',{name:'确认平面并生成白膜 →'})).toBeEnabled()
  await page.getByRole('button',{name:'撤销删除',exact:true}).click()
  await expect(page.getByRole('button',{name:'确认平面并生成白膜 →'})).toBeDisabled()
})
test('direct scene creation rejects over-height historical scenes before WebGL or model loading',async({page})=>{
  await page.goto('/')
  const result=await page.evaluate(async l=>{
    const {createScene}=await import('/src/scene.js')
    try{const scene=createScene({},l);scene.dispose();return 'accepted'}catch(e){return e.message}
  },layout)
  expect(result).toContain('高度超过层高')
})
