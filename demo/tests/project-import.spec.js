import {test,expect} from '@playwright/test'
import {parseProject,mergeProject} from '../src/project-import.js'

const backup={nodes:[{id:'r',kind:'root',name:'备份门店',room:{w:8,d:6,h:3}},
  {id:'p',parent:'r',kind:'plan',name:'备份方案',layout:{room:{w:8,d:6,h:3},items:[{id:'a',type:'table',name:'桌',x:2,z:2,w:1.8,d:.8,h:.9}]}}]}

test('import remaps every branch identity, sorts parent first, and preserves the existing project',()=>{
  const input=structuredClone(backup);input.nodes.reverse()
  const parsed=parseProject(JSON.stringify(input)),existing={nodes:[{id:'r',kind:'root',name:'原项目',room:{w:6,d:6,h:3}}]}
  let n=0
  const merged=mergeProject(existing,parsed,()=>`new-${++n}`)
  expect(existing.nodes).toHaveLength(1)
  expect(merged.nodes).toHaveLength(3)
  expect(merged.nodes[0]).toEqual(existing.nodes[0])
  expect(merged.nodes[2].parent).toBe(merged.nodes[1].id)
  expect(merged.nodes[1].id).not.toBe('r')
  expect(merged.nodes[2].layout.room.shopType).toBe('边厅店')
  expect(merged.nodes[2].layout.items[0].x).toBe(2)
})

test('broken graphs, invalid numbers and tampered real-asset dimensions are rejected',()=>{
  for(const edit of [
    p=>p.nodes.push(structuredClone(p.nodes[0])),
    p=>p.nodes[1].parent='missing',
    p=>{p.nodes[0].kind='edit';p.nodes[0].layout=p.nodes[1].layout;p.nodes[0].parent='p'},
    p=>p.nodes[1].layout.items[0].x='NaN',
    p=>Object.assign(p.nodes[1].layout.items[0],{assetId:'asset-408124',w:30}),
    p=>p.nodes[1].layout.source={file:{unexpected:'object'}},
    p=>p.nodes[1].layout.modelAdvice={trainingStores:{unexpected:'object'},placed:1},
  ]){const p=structuredClone(backup);edit(p);expect(()=>parseProject(JSON.stringify(p))).toThrow()}
  expect(()=>parseProject('{')).toThrow()
  expect(()=>parseProject(JSON.stringify({nodes:[],__proto__:null}))).toThrow()
  expect(()=>parseProject(' '.repeat(5*1024*1024+1))).toThrow(/大小/)
})

test('file import adds independent branches and preserves unsaved editor changes',async({page})=>{
  await page.goto('/')
  await page.getByRole('button',{name:'生成四个平面方案'}).click()
  await page.locator('.plan-card').first().click()
  await page.getByRole('button',{name:'＋ 收银台',exact:true}).click()
  await page.getByLabel('导入项目 JSON').setInputFiles({name:'backup.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(backup))},{timeout:5000})
  await expect(page.getByRole('status')).toContainText('已导入')
  const nodes=await page.evaluate(()=>JSON.parse(localStorage.getItem('insta-studio-v2')).nodes)
  expect(nodes).toHaveLength(8) // Original root + four plans, unsaved edit, two imported nodes.
  expect(nodes.find(n=>n.name==='导入前保留的调整').layout.items).toHaveLength(5)
  expect(new Set(nodes.map(n=>n.id)).size).toBe(8)
  await page.reload()
  await expect(page.locator('.plan-card')).toHaveCount(1)
})

test('storage quota rejection keeps the previous project and does not report import success',async({page})=>{
  await page.goto('/')
  await page.getByRole('button',{name:'生成四个平面方案'}).click()
  const before=await page.evaluate(()=>{
    const saved=localStorage.getItem('insta-studio-v2'),original=Storage.prototype.setItem
    Storage.prototype.setItem=function(key,value){if(key==='insta-studio-v2'&&value.includes('importedFrom'))throw new DOMException('quota','QuotaExceededError');return original.call(this,key,value)}
    return saved
  })
  await page.getByLabel('导入项目 JSON').setInputFiles({name:'backup.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(backup))})
  await expect(page.getByRole('status')).toContainText('导入失败')
  expect(await page.evaluate(()=>localStorage.getItem('insta-studio-v2'))).toBe(before)
  await expect(page.locator('.plan-card')).toHaveCount(4)
})

test('root layout injection is rejected before replacing the visible or saved project',async({page})=>{
  await page.goto('/')
  await page.getByRole('button',{name:'生成四个平面方案'}).click()
  await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem('insta-studio-v2')).nodes.length)).toBe(5)
  const before=await page.evaluate(()=>localStorage.getItem('insta-studio-v2'))
  const invalid=structuredClone(backup);invalid.nodes[0].layout={}
  await page.getByLabel('导入项目 JSON').setInputFiles({name:'bad-root.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(invalid))})
  await expect(page.getByRole('status')).toContainText('导入失败')
  await expect(page.locator('.plan-card')).toHaveCount(4)
  expect(await page.evaluate(()=>localStorage.getItem('insta-studio-v2'))).toBe(before)
})

test('large valid project downloads a backup that can be imported again',async({page})=>{
  const room={w:100,d:100,h:3,shopType:'边厅店'}
  const items=Array.from({length:200},(_,i)=>({id:`item-${i}`,type:'table',name:'桌',x:1+(i%20)*2,z:1+Math.floor(i/20)*2,w:1,d:1,h:1}))
  const project={nodes:[{id:'r',kind:'root',name:'大项目',room},...Array.from({length:130},(_,i)=>({id:`p-${i}`,parent:'r',kind:'plan',name:`方案${i}`,layout:{room,items}}))]}
  const raw=JSON.stringify(project)
  expect(Buffer.byteLength(raw)).toBeLessThan(5*1024*1024)
  expect(Buffer.byteLength(JSON.stringify(project,null,2))).toBeGreaterThan(5*1024*1024)
  await page.addInitScript(raw=>localStorage.setItem('insta-studio-v2',raw),raw)
  await page.goto('/')
  const downloading=page.waitForEvent('download')
  await page.getByRole('button',{name:'导出项目快照',exact:true}).click()
  const stream=await(await downloading).createReadStream(),chunks=[]
  for await(const chunk of stream)chunks.push(chunk)
  const downloaded=Buffer.concat(chunks).toString()
  expect(Buffer.byteLength(downloaded)).toBeLessThanOrEqual(5*1024*1024)
  const restored=parseProject(downloaded)
  expect(restored.nodes).toHaveLength(131)
  expect(restored.nodes[130].layout.items).toHaveLength(200)
  expect(restored.nodes[130].layout.items[199]).toEqual(items[199])
})
