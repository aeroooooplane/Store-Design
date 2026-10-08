import {test,expect} from '@playwright/test'
import {readSaved,replaceSaved} from './browser-storage.js'

for(const raw of ['{broken',JSON.stringify({nodes:[{id:'bad',kind:'root',name:'坏项目',room:{w:-1,d:6,h:3}}]}),JSON.stringify({nodes:[{id:'bad-layout',kind:'root',name:'坏布局',room:{w:8,d:6,h:3},layout:{}}]})]){
  test(`invalid saved project is isolated without overwriting: ${raw.slice(0,40)}`,async({page})=>{
    await page.addInitScript(raw=>localStorage.setItem('insta-studio-v2',raw),raw)
    await page.goto('/')
    await expect(page.getByRole('alert')).toContainText('原始数据未覆盖')
    expect(await page.evaluate(()=>localStorage.getItem('insta-studio-v2'))).toBe(raw)
    const download=page.waitForEvent('download')
    await page.getByRole('button',{name:'下载原始数据'}).click()
    const stream=await (await download).createReadStream(),chunks=[]
    for await(const chunk of stream)chunks.push(chunk)
    expect(Buffer.concat(chunks).toString()).toBe(raw)
    await page.getByRole('button',{name:'隔离备份后新建'}).click()
    await expect(page.getByRole('button',{name:'生成四个平面方案'})).toBeVisible()
    const values=await page.evaluate(async()=>{const db=await(await import('/src/project-db.js')).openProjectDatabase();return new Promise((resolve,reject)=>{const request=db.transaction('backups').objectStore('backups').getAll();request.onsuccess=()=>resolve(request.result.map(r=>r.raw));request.onerror=()=>reject(request.error)})})
    expect(values).toContain(raw)
  })
}

test('failed isolation backup cannot unlock autosave or overwrite original',async({page})=>{
  await page.addInitScript(()=>{
    localStorage.setItem('insta-studio-v2','{broken')
    const original=IDBObjectStore.prototype.put
    IDBObjectStore.prototype.put=function(value,...args){if(this.name==='backups')throw Error('quota');return original.call(this,value,...args)}
  })
  await page.goto('/')
  await page.getByRole('button',{name:'隔离备份后新建'}).click()
  await expect(page.getByRole('alert')).toContainText('备份失败')
  expect(await page.evaluate(()=>localStorage.getItem('insta-studio-v2'))).toBe('{broken')
  await expect(page.getByRole('button',{name:'生成四个平面方案'})).toHaveCount(0)
})

test('valid empty and legacy saved projects restore normally',async({page})=>{
  await page.goto('/')
  await page.getByRole('button',{name:'生成四个平面方案'}).click()
  const p=await readSaved(page);for(const n of p.nodes){if(n.room)delete n.room.shopType;if(n.layout)delete n.layout.room.shopType}
  await replaceSaved(page,p)
  await page.reload()
  await expect(page.locator('.plan-card')).toHaveCount(4)
  await replaceSaved(page,{nodes:[]})
  await page.reload()
  await expect(page.getByRole('button',{name:'生成四个平面方案'})).toBeVisible()
})
