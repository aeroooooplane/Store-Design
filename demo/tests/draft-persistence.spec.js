import {test,expect} from '@playwright/test'
import {parseProject,mergeProject} from '../src/project-import.js'

async function edit(page){
  await page.goto('/')
  await page.getByRole('button',{name:'生成四个平面方案'}).click()
  await page.locator('.plan-card').first().click()
  const original=await page.locator('.drawing svg g').count()
  await page.getByRole('button',{name:'＋ 收银台',exact:true}).click()
  return original
}

test('refresh restores edited draft without mutating its original plan',async({page})=>{
  const original=await edit(page)
  await page.reload()
  await expect(page.getByRole('button',{name:'保存平面快照',exact:true})).toBeVisible()
  await expect(page.locator('.drawing svg g')).toHaveCount(original+1)
  const saved=await page.evaluate(async()=>JSON.parse((await (await import('/src/project-db.js')).readProjectRaw())))
  expect(saved.nodes.find(n=>n.kind==='plan').layout.items).toHaveLength(original)
})

test('new project preserves dirty draft as a history branch',async({page})=>{
  const original=await edit(page)
  await page.getByRole('button',{name:'＋ 新建尺寸方案'}).click()
  await expect(page.locator('.branch-list button').filter({hasText:'新建前保留的调整'})).toBeVisible()
  await page.getByRole('button',{name:'生成四个平面方案'}).click()
  await page.locator('.branch-list button').filter({hasText:'新建前保留的调整'}).click()
  await expect(page.locator('.drawing svg g')).toHaveCount(original+1)
})

test('project download includes current edits and imports them as an independent branch',async({page})=>{
  const original=await edit(page)
  const waiting=page.waitForEvent('download')
  await page.getByRole('button',{name:'导出项目快照'}).click()
  const stream=await (await waiting).createReadStream(),chunks=[]
  for await(const chunk of stream)chunks.push(chunk)
  const incoming=parseProject(Buffer.concat(chunks).toString())
  const merged=mergeProject({nodes:[]},incoming)
  expect(merged.nodes.some(n=>n.kind==='edit'&&n.layout.items.length===original+1)).toBe(true)
  expect(merged.nodes.filter(n=>n.kind==='plan')).toHaveLength(4)
})

test('malformed saved draft is rejected rather than silently dropped',()=>{
  const root={id:'r',kind:'root',name:'店',room:{w:8,d:6,h:3}}
  for(const draft of [{parent:'missing',layout:{room:root.room,items:[]}},{parent:'r',layout:{room:{w:-1,d:6,h:3},items:[]}}]){
    expect(()=>parseProject(JSON.stringify({nodes:[root],editorDraft:draft}))).toThrow()
  }
})
