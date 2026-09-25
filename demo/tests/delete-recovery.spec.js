import {test,expect} from '@playwright/test'
import {realAssets} from '../src/real-assets.js'
import {createAssetItem,rotateItem} from '../src/asset-contract.js'

const room={w:8,d:6,h:3,shopType:'边厅店'}
const items=[rotateItem(createAssetItem(realAssets[0],'real',1,1)),{id:'plain',name:'普通桌',type:'table',x:5,z:3,w:1,d:1,h:1}]
const initial={nodes:[{id:'r',kind:'root',name:'门店',room},{id:'p',parent:'r',kind:'plan',name:'初始平面',layout:{room,items}}]}
async function open(page){
  await page.goto('/')
  await page.evaluate(p=>localStorage.setItem('insta-studio-v2',JSON.stringify(p)),initial)
  await page.reload()
  await page.locator('.plan-card').first().click()
}

test('undo deletion restores asset identity, orientation and original ordering without rewriting history',async({page})=>{
  await open(page)
  await page.locator('.drawing .plan g').first().click()
  await page.getByRole('button',{name:'删除',exact:true}).click()
  await page.locator('.drawing .plan g').first().click()
  await page.getByRole('button',{name:'删除',exact:true}).click()
  await expect(page.locator('.properties')).toContainText('道具 0 / 200')
  await expect(page.getByRole('button',{name:'撤销删除',exact:true})).toBeVisible()
  await page.getByRole('button',{name:'撤销删除',exact:true}).click()
  await expect(page.locator('.properties')).toContainText('道具 1 / 200')
  await page.getByRole('button',{name:'撤销删除',exact:true}).click()
  await expect(page.locator('.properties')).toContainText('道具 2 / 200')
  await expect(page.getByRole('button',{name:'撤销删除',exact:true})).toBeDisabled()
  await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem('insta-studio-v2')).editorDraft??null)).toBeNull()
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('insta-studio-v2')).nodes[1].layout.items)).toEqual(items)
  await page.getByRole('button',{name:'保存平面快照',exact:true}).click()
  await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem('insta-studio-v2')).nodes.length)).toBe(3)
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('insta-studio-v2')).nodes[2].layout.items)).toEqual(items)
})

test('deletion recovery cannot cross saved branches or page refresh',async({page})=>{
  await open(page)
  await page.locator('.drawing .plan g').first().click()
  await page.getByRole('button',{name:'删除',exact:true}).click()
  await expect(page.getByRole('button',{name:'撤销删除',exact:true})).toBeEnabled()
  await page.getByRole('button',{name:'保存平面快照',exact:true}).click()
  await expect(page.getByRole('button',{name:'撤销删除',exact:true})).toBeDisabled()
  await page.locator('.drawing .plan g').first().click()
  await page.getByRole('button',{name:'删除',exact:true}).click()
  await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem('insta-studio-v2')).editorDraft?.layout.items.length)).toBe(0)
  await page.reload()
  await expect(page.locator('.properties')).toContainText('道具 0 / 200')
  await expect(page.getByRole('button',{name:'撤销删除',exact:true})).toBeDisabled()
})

test('reopening the same original node starts a fresh deletion recovery scope',async({page})=>{
  await open(page)
  await page.locator('.drawing .plan g').first().click()
  await page.getByRole('button',{name:'删除',exact:true}).click()
  await page.locator('.branch-list button').filter({hasText:'初始平面'}).click()
  await expect(page.locator('.properties')).toContainText('道具 2 / 200')
  await expect(page.getByRole('button',{name:'撤销删除',exact:true})).toBeDisabled()
  await expect(page.locator('.branch-list button').filter({hasText:'自动保存的调整'})).toHaveCount(1)
})
