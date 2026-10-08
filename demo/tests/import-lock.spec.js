import {test,expect} from '@playwright/test'
import {replaceSaved} from './browser-storage.js'

test('pending import freezes editor mutations until its write completes',async({page})=>{
  await page.goto('/')
  await page.getByRole('button',{name:'生成四个平面方案'}).click()
  await page.locator('.plan-card').first().click()
  const original=await page.locator('.drawing svg g').count()
  await page.getByRole('button',{name:'＋ 收银台',exact:true}).click()
  await expect.poll(()=>page.evaluate(async()=>JSON.parse((await (await import('/src/project-db.js')).readProjectRaw())).editorDraft?.layout.items.length)).toBe(original+1)
  await page.evaluate(async()=>{
    window.lockHeld=false
    navigator.locks.request('store-design:insta-studio-v2',()=>new Promise(resolve=>{window.releaseImportLock=resolve;window.lockHeld=true}))
  })
  await expect.poll(()=>page.evaluate(async()=>window.lockHeld)).toBe(true)
  const incoming={nodes:[{id:'incoming',kind:'root',name:'导入门店',room:{w:8,d:6,h:3}}]}
  await page.getByLabel('导入项目 JSON').setInputFiles({name:'project.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(incoming))})
  await expect.poll(()=>page.evaluate(async()=>(await navigator.locks.query()).pending.length)).toBeGreaterThan(0)
  await expect(page.getByRole('status')).toContainText('暂时锁定编辑')
  await expect(page.getByRole('button',{name:'＋ 收银台',exact:true}).click({trial:true,timeout:500})).rejects.toThrow()
  // Dispatch also checks queued event protection, beyond native inert hit testing.
  await page.getByRole('button',{name:'＋ 收银台',exact:true,includeHidden:true}).dispatchEvent('click')
  await expect(page.locator('.properties')).toContainText(`道具 ${original+1} / 200`)
  await page.getByRole('button',{name:'保存平面快照',exact:true,includeHidden:true}).dispatchEvent('click')
  await page.evaluate(async()=>window.releaseImportLock())
  await expect(page.getByRole('status')).toContainText('已导入')
  const saved=await page.evaluate(async()=>JSON.parse((await (await import('/src/project-db.js')).readProjectRaw())))
  expect(saved.nodes).toHaveLength(7)
  expect(saved.nodes.find(n=>n.name==='导入前保留的调整').layout.items).toHaveLength(original+1)
  await page.getByRole('button',{name:'＋ 新建尺寸方案'}).click()
  await page.getByRole('button',{name:'生成四个平面方案'}).click()
  await expect(page.locator('.plan-card')).toHaveCount(4)
})

test('pending import cannot generate setup branches and failed import unlocks setup',async({page})=>{
  await page.goto('/')
  await expect.poll(()=>page.evaluate(async()=>(await (await import('/src/project-db.js')).readProjectRaw()))).not.toBeNull()
  await page.evaluate(async()=>{
    window.lockHeld=false
    navigator.locks.request('store-design:insta-studio-v2',()=>new Promise(resolve=>{window.releaseImportLock=resolve;window.lockHeld=true}))
  })
  await expect.poll(()=>page.evaluate(async()=>window.lockHeld)).toBe(true)
  const raw=JSON.stringify({nodes:[{id:'r',kind:'root',name:'门店',room:{w:8,d:6,h:3}}]})
  await page.getByLabel('导入项目 JSON').setInputFiles({name:'project.json',mimeType:'application/json',buffer:Buffer.from(raw)})
  await expect.poll(()=>page.evaluate(async()=>(await navigator.locks.query()).pending.length)).toBeGreaterThan(0)
  await page.locator('form.setup').dispatchEvent('submit')
  await page.locator('.sample-button').dispatchEvent('click')
  // An external change makes the import fail safely when its lock is released.
  await replaceSaved(page,{schemaVersion:2,nodes:[],external:true})
  await page.evaluate(()=>window.releaseImportLock())
  await expect(page.getByRole('status')).toContainText('导入失败')
  await expect(page.getByRole('button',{name:'生成四个平面方案'})).toBeVisible()
  await page.getByRole('button',{name:'生成四个平面方案'}).click()
  await expect(page.locator('.plan-card')).toHaveCount(4)
  await expect(page.locator('.branch-list button')).toHaveCount(5)
})
