import {test,expect} from '@playwright/test'
const room={w:8,d:6,h:3,shopType:'边厅店'}
const layout={room,items:[{id:'i',name:'体验桌',type:'table',x:1,z:1,w:1,d:1,h:1}]}
const initial={nodes:[{id:'r',kind:'root',name:'测试门店',room},{id:'p',parent:'r',kind:'plan',name:'测试平面',layout}]}
async function open(page){
  await page.goto('/')
  await page.evaluate(p=>localStorage.setItem('insta-studio-v2',JSON.stringify(p)),initial)
  await page.reload()
  await page.locator('.plan-card').first().click()
  await page.locator('.drawing .plan g').first().click()
}
test('unrecoverable coordinate values are rejected at entry without breaking autosave',async({page})=>{
  await open(page)
  for(const [axis,value] of [['横向位置 / m','1001'],['纵向位置 / m','-1001']]){
    const field=page.getByLabel(axis)
    await field.fill(value)
    await expect(field).toHaveValue('1')
    await expect(page.getByRole('status')).toContainText('位置必须在 -1000 至 1000 米之间')
    await expect(page.getByRole('alert')).toHaveCount(0)
  }
  await page.getByLabel('横向位置 / m').fill('2.345')
  await expect.poll(()=>page.evaluate(async()=>JSON.parse((await (await import('/src/project-db.js')).readProjectRaw())).editorDraft?.layout.items[0].x)).toBe(2.345)
  await page.reload()
  await page.locator('.drawing .plan g').first().click()
  await expect(page.getByLabel('横向位置 / m')).toHaveValue('2.345')
})
test('recoverable out-of-room draft stays editable and blocks white-model confirmation',async({page})=>{
  await open(page)
  await page.getByLabel('横向位置 / m').fill('9')
  await expect(page.locator('.properties .warning')).toContainText('超出门店边界')
  await expect(page.getByRole('button',{name:'确认平面并生成白膜 →'})).toBeDisabled()
  await expect.poll(()=>page.evaluate(async()=>JSON.parse((await (await import('/src/project-db.js')).readProjectRaw())).editorDraft?.layout.items[0].x)).toBe(9)
  await page.getByLabel('横向位置 / m').fill('2')
  await expect(page.getByRole('button',{name:'确认平面并生成白膜 →'})).toBeEnabled()
})
