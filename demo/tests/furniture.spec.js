import {test,expect} from '@playwright/test'
import {furnitureParts,profileFor} from '../src/furniture.js'

test('furniture stays inside its footprint and preserves distinct supports',()=>{
  for(const profile of ['open-table','pedestal-table','closed-counter','shelf-cabinet','solid']){
    for(const [w,d] of [[1.8,.5],[.5,1.8]]){
      const parts=furnitureParts({type:'table',profile,w,d,h:.9})
      for(const p of parts) for(const [axis,size,limit] of [['x','w',w],['y','h',.9],['z','d',d]]){
        expect(p[size]).toBeGreaterThan(0)
        expect(p[axis]-p[size]/2).toBeGreaterThanOrEqual(-1e-9)
        expect(p[axis]+p[size]/2).toBeLessThanOrEqual(limit+1e-9)
      }
      if(profile==='open-table')expect(parts.filter(p=>p.role==='leg')).toHaveLength(4)
      if(profile==='pedestal-table')expect(parts.filter(p=>p.role==='base')).toHaveLength(1)
    }
  }
  expect(profileFor({type:'structure',profile:'open-table'})).toBe('solid')
  expect(profileFor({type:'table'})).toBe('open-table')
})

test('profile selection survives snapshot and white model uses identical furniture across styles',async({page})=>{
  await page.goto('/')
  await page.getByRole('button',{name:'打开真实图纸样本 · 上海星光摄影城'}).click()
  await page.locator('.drawing svg g').nth(4).click()
  await page.getByLabel('道具结构').selectOption('open-table')
  await page.getByRole('button',{name:'保存平面快照'}).click()
  await page.reload()
  await page.locator('.branch-list button').filter({hasText:'平面快照'}).last().click()
  await page.locator('.drawing svg g').nth(4).click()
  await expect(page.getByLabel('道具结构')).toHaveValue('open-table')
  const signatures=await page.evaluate(async()=>{
    const {createScene}=await import('/src/scene.js')
    const {realSample}=await import('/src/sample.js')
    return ['white','SI1.0','SI2.0'].map(style=>{
      const scene=createScene(document.createElement('canvas'),realSample,style)
      const geometry=scene.furnitureGeometry;scene.dispose();return geometry
    })
  })
  expect(signatures[0]).toEqual(signatures[1])
  expect(signatures[1]).toEqual(signatures[2])
  expect(signatures[0].filter(p=>p.itemId==='s03-block-front')).toHaveLength(1)
})
