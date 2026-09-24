import {test,expect} from '@playwright/test'

test('island selection survives area mode, snapshots and reload',async({page})=>{
 await page.goto('/')
 await expect(page.getByLabel('门店铺型')).toHaveValue('边厅店')
 await page.getByLabel('门店铺型').selectOption('中岛店')
 await page.getByRole('button',{name:'输入面积',exact:true}).click()
 await expect(page.getByLabel('门店铺型')).toHaveValue('中岛店')
 await page.getByRole('button',{name:'生成四个平面方案'}).click()
 await expect(page.locator('.plan-card')).toHaveCount(4)
 await expect(page.locator('.plan-card').first()).toContainText('中岛店')
 await page.locator('.plan-card').first().click()
 await expect(page.locator('.drawing')).toContainText('四周开放')
 await page.getByRole('button',{name:'确认平面并生成白膜'}).click()
 await expect(page.locator('.model canvas')).toBeVisible()
 await expect(page.getByLabel('渲染风格')).toHaveValue('SI1.0')
 const nodes=await page.evaluate(()=>JSON.parse(localStorage.getItem('insta-studio-v2')).nodes)
 expect(nodes.every(n=>(n.room||n.layout.room).shopType==='中岛店')).toBeTruthy()
 await page.reload()
 await expect(page.locator('.plan-card').first()).toContainText('中岛店')
 await page.screenshot({path:'test-results/island-gallery.png',fullPage:true})
})

test('legacy rooms migrate to edge shop without losing furniture',async({page})=>{
 await page.addInitScript(()=>localStorage.setItem('insta-studio-v2',JSON.stringify({nodes:[
  {id:'root',kind:'root',name:'旧项目',room:{w:8,d:6,h:3}},
  {id:'plan',parent:'root',kind:'plan',name:'旧方案',layout:{room:{w:8,d:6,h:3},items:[{id:'table',type:'table',name:'体验桌',x:3,z:2,w:1.5,d:.8,h:.85}]}}
 ]})))
 await page.goto('/')
 await expect(page.locator('.plan-card')).toContainText('边厅店')
 const nodes=await page.evaluate(()=>JSON.parse(localStorage.getItem('insta-studio-v2')).nodes)
 expect(nodes[0].room.shopType).toBe('边厅店')
 expect(nodes[1].layout.room.shopType).toBe('边厅店')
 expect(nodes[1].layout.items[0].x).toBe(3)
})

test('shop type changes rendered enclosure for identical furniture',async({page})=>{
 await page.goto('/')
 const distinct=await page.evaluate(async()=>{
  const {createScene}=await import('/src/scene.js')
  const render=shopType=>{const scene=createScene(document.createElement('canvas'),{room:{w:8,d:6,h:3,shopType},items:[]});const image=scene.image();scene.dispose();return image}
  return render('边厅店')!==render('中岛店')
 })
 expect(distinct).toBe(true)
})
