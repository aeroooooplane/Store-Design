import {test,expect} from '@playwright/test'
import {readSaved} from './browser-storage.js'

test('project exceeding localStorage size imports, survives refresh and exports intact',async({page})=>{
  const project={nodes:[{id:'large-root',kind:'root',name:'大容量项目',room:{w:8,d:6,h:3,notes:'x'.repeat(6*1024*1024)}}]}
  await page.goto('/')
  await page.getByLabel('导入项目 JSON').setInputFiles({name:'large.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(project))})
  await expect(page.getByRole('status')).toContainText('已导入')
  await page.reload()
  await expect(page.locator('.branch-list')).toContainText('大容量项目')
  const stored=await page.evaluate(async()=>{
    const {readProjectRaw}=await import('/src/project-db.js')
    return JSON.parse(await readProjectRaw())
  })
  expect(stored.nodes.find(n=>n.name==='大容量项目').room.notes).toHaveLength(6*1024*1024)
  const download=page.waitForEvent('download')
  await page.getByRole('button',{name:'导出项目快照',exact:true}).click()
  const stream=await(await download).createReadStream(),chunks=[]
  for await(const chunk of stream)chunks.push(chunk)
  const exported=JSON.parse(Buffer.concat(chunks).toString())
  expect(exported).toEqual(stored)
})

test('database v1 upgrades atomically and keeps the original record in backups',async({page})=>{
  await page.goto('/favicon.svg')
  await page.evaluate(()=>new Promise((resolve,reject)=>{
    const request=indexedDB.open('store-design-projects',1)
    request.onupgradeneeded=()=>request.result.createObjectStore('projects',{keyPath:'key'})
    request.onerror=()=>reject(request.error)
    request.onsuccess=()=>{
      const db=request.result,tx=db.transaction('projects','readwrite')
      tx.objectStore('projects').put({key:'insta-studio-v2',schemaVersion:1,project:{nodes:[{id:'v1',kind:'root',name:'旧数据库',room:{w:8,d:6,h:3}}]}})
      tx.oncomplete=()=>{db.close();resolve()};tx.onabort=()=>reject(tx.error)
    }
  }))
  await page.goto('/')
  await expect(page.locator('.branch-list')).toContainText('旧数据库')
  expect((await readSaved(page)).schemaVersion).toBe(2)
  const backup=await page.evaluate(async()=>{
    const db=await(await import('/src/project-db.js')).openProjectDatabase()
    return new Promise(resolve=>{const request=db.transaction('backups').objectStore('backups').getAll();request.onsuccess=()=>resolve(request.result[0])})
  })
  expect(backup.record.schemaVersion).toBe(1)
  expect(backup.record.project.nodes[0].id).toBe('v1')
})

test('migration quota failure cannot start an empty project or overwrite legacy data',async({page})=>{
  const raw=JSON.stringify({nodes:[{id:'legacy',kind:'root',name:'待迁移',room:{w:8,d:6,h:3}}]})
  await page.addInitScript(raw=>{
    localStorage.setItem('insta-studio-v2',raw)
    const put=IDBObjectStore.prototype.put
    IDBObjectStore.prototype.put=function(value,...args){if(this.name==='backups')throw new DOMException('quota','QuotaExceededError');return put.call(this,value,...args)}
  },raw)
  await page.goto('/')
  await expect(page.getByRole('alert')).toContainText('原始数据未覆盖')
  await expect(page.getByRole('button',{name:'生成四个平面方案'})).toHaveCount(0)
  expect(await readSaved(page)).toBeNull()
  expect(await page.evaluate(()=>localStorage.getItem('insta-studio-v2'))).toBe(raw)
})

test('future project schema is rejected before any save',async({page})=>{
  const raw=JSON.stringify({schemaVersion:999,nodes:[]})
  await page.addInitScript(raw=>localStorage.setItem('insta-studio-v2',raw),raw)
  await page.goto('/')
  await expect(page.getByRole('alert')).toContainText('不支持的项目版本')
  expect(await readSaved(page)).toBeNull()
  expect(await page.evaluate(()=>localStorage.getItem('insta-studio-v2'))).toBe(raw)
})

test('invalid PNG data cannot be stored as a completed eight-view cache',async({page})=>{
  await page.goto('/')
  const rejected=await page.evaluate(async()=>{
    const {saveRenderImages}=await import('/src/project-db.js')
    try{await saveRenderImages({id:'bad',kind:'render',style:'SI1.0',layout:{room:{w:8,d:6,h:3},items:[]}},Array(8).fill('data:image/png;base64,YmFk'));return false}
    catch{return true}
  })
  expect(rejected).toBe(true)
})

test('pending asynchronous save protects navigation until its transaction finishes',async({page})=>{
  await page.goto('/')
  await expect(page.getByRole('button',{name:'生成四个平面方案'})).toBeVisible()
  await page.evaluate(()=>{navigator.locks.request('store-design:insta-studio-v2',()=>new Promise(resolve=>{window.releaseSaveGate=resolve}))})
  await expect.poll(()=>page.evaluate(()=>!!window.releaseSaveGate)).toBe(true)
  try{
    await page.getByRole('button',{name:'生成四个平面方案'}).click()
    await expect.poll(()=>page.evaluate(async()=>(await navigator.locks.query()).pending.length)).toBeGreaterThan(0)
    expect(await page.evaluate(()=>{const event=new Event('beforeunload',{cancelable:true});window.dispatchEvent(event);return event.defaultPrevented})).toBe(true)
  }finally{await page.evaluate(()=>window.releaseSaveGate())}
  await expect.poll(async()=>(await readSaved(page)).nodes.length).toBe(5)
  await expect.poll(()=>page.evaluate(()=>{const event=new Event('beforeunload',{cancelable:true});window.dispatchEvent(event);return event.defaultPrevented})).toBe(false)
})

test('saved eight-view images survive reload only for their original layout and style',async({page})=>{
  await page.goto('/')
  await page.getByRole('button',{name:'生成四个平面方案'}).click()
  await page.locator('.plan-card').first().click()
  await page.getByRole('button',{name:'确认平面并生成白膜'}).click()
  await page.getByRole('button',{name:'确认白膜，渲染八视角'}).click()
  await expect(page.locator('.renders img')).toHaveCount(8)
  const urls=await page.locator('.renders img').evaluateAll(images=>images.map(i=>i.src))
  await page.getByRole('button',{name:'保存八视角供刷新恢复'}).click()
  await expect(page.getByRole('status')).toContainText('八视角已保存')
  await page.reload()
  await page.locator('.branch-list button').filter({hasText:'SI1.0 · 8 视角'}).click()
  await expect(page.locator('.renders img')).toHaveCount(8)
  expect(await page.locator('.renders img').evaluateAll(images=>images.map(i=>i.src))).toEqual(urls)
  const stale=await page.evaluate(async()=>{
    const {readProjectRaw,loadRenderImages}=await import('/src/project-db.js')
    const node=JSON.parse(await readProjectRaw()).nodes.find(n=>n.kind==='render')
    return loadRenderImages({...node,style:'SI2.0'})
  })
  expect(stale).toBeNull()
})

test('legacy localStorage migrates once and its exact original remains recoverable',async({page})=>{
  const raw=JSON.stringify({nodes:[{id:'old-root',kind:'root',name:'旧项目',room:{w:8,d:6,h:3}}]})
  await page.addInitScript(raw=>localStorage.setItem('insta-studio-v2',raw),raw)
  await page.goto('/')
  await expect(page.locator('.branch-list')).toContainText('旧项目')
  const result=await page.evaluate(async()=>{
    const {readProjectRaw}=await import('/src/project-db.js')
    return {legacy:localStorage.getItem('insta-studio-v2'),project:JSON.parse(await readProjectRaw())}
  })
  expect(result.legacy).toBe(raw)
  expect(result.project.schemaVersion).toBe(2)
  await page.getByRole('button',{name:'＋ 新建尺寸方案'}).click()
  await page.getByRole('button',{name:'生成四个平面方案'}).click()
  await page.reload()
  await expect(page.locator('.branch-list button')).toHaveCount(6)
})
