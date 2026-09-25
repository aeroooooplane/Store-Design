import {test,expect} from '@playwright/test'

const room={w:8,d:6,h:3,shopType:'边厅店'}
const layout={room,items:[{id:'i',name:'体验桌',type:'table',x:1,z:1,w:1,d:1,h:1}]}
const project={nodes:[{id:'r',kind:'root',name:'上海门店',room},{id:'p',parent:'r',kind:'plan',name:'Alpha 初始平面',layout},{id:'q',parent:'r',kind:'plan',name:'Beta 对比平面',layout}]}
async function setup(page){
  await page.goto('/')
  await page.evaluate(p=>localStorage.setItem('insta-studio-v2',JSON.stringify(p)),project)
  await page.reload()
  await expect(page.getByRole('searchbox',{name:'搜索历史名称'})).toBeVisible()
}
test('history name filtering is case insensitive, reversible and does not change saved data or graph',async({page})=>{
  await setup(page)
  const before=await page.evaluate(()=>localStorage.getItem('insta-studio-v2'))
  await page.getByRole('searchbox').fill('  ALPHA  ')
  await expect(page.locator('.branch-list button')).toHaveCount(1)
  await expect(page.locator('.branch-list')).toContainText('Alpha 初始平面')
  await expect(page.locator('.react-flow__node')).toHaveCount(3)
  await page.getByRole('searchbox').fill('不存在的名称')
  await expect(page.locator('.branch-list')).toContainText('没有匹配的历史节点')
  await page.getByRole('button',{name:'清空历史搜索'}).click()
  await expect(page.locator('.branch-list button')).toHaveCount(3)
  expect(await page.evaluate(()=>localStorage.getItem('insta-studio-v2'))).toBe(before)
})
test('opening filtered result preserves the dirty draft as a separate history node',async({page})=>{
  await setup(page)
  await page.locator('.branch-list button').filter({hasText:'Alpha'}).click()
  await page.locator('.drawing .plan g').first().click()
  await page.getByRole('button',{name:'删除',exact:true}).click()
  await page.getByRole('searchbox').fill('Beta')
  await page.locator('.branch-list button').click()
  await expect(page.locator('h1')).toHaveText('Beta 对比平面')
  await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem('insta-studio-v2')).nodes.length)).toBe(4)
  const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('insta-studio-v2')))
  expect(saved.nodes[1].layout.items).toEqual(layout.items)
  expect(saved.nodes[3].parent).toBe('p')
  expect(saved.nodes[3].layout.items).toEqual([])
})
test('history search remains usable on a narrow screen',async({page})=>{
  await page.setViewportSize({width:390,height:844})
  await page.goto('/')
  await page.evaluate(p=>localStorage.setItem('insta-studio-v2',JSON.stringify(p)),project)
  await page.reload()
  await page.getByRole('button',{name:'历史与备份'}).click()
  await expect(page.getByRole('searchbox',{name:'搜索历史名称'})).toBeVisible()
  await page.getByRole('searchbox',{name:'搜索历史名称'}).fill('Beta')
  await expect(page.locator('.branch-list button')).toHaveCount(1)
  await page.locator('.branch-list button').click()
  await expect(page.locator('h1')).toHaveText('Beta 对比平面')
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
})
