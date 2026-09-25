import {test,expect} from '@playwright/test'
import {readFile} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {unzipSync,strFromU8} from 'three/addons/libs/fflate.module.js'
import {realAssets} from '../src/real-assets.js'
import {createAssetItem} from '../src/asset-contract.js'
import {parseProject} from '../src/project-import.js'

async function downloadBytes(page,name){
  const downloading=page.waitForEvent('download')
  await page.getByRole('button',{name,exact:true}).click()
  return readFile(await(await downloading).path())
}

test.skip(process.env.PRODUCTION_QA!=='1','Requires a fresh build and original local assets; use playwright.preview.config.js')

test('built preview opens verified local PDF and image without source modules',async({page,request})=>{
  const manifest=JSON.parse(await readFile(new URL('../src/data/case-library.json',import.meta.url)))
  const store=manifest.stores[0],ref=store.layouts[0],scripts=[]
  page.on('request',r=>{if(r.resourceType()==='script')scripts.push(r.url())})
  const pdf=await request.get(`/__local-evidence/${store.id}/layout/${ref.page}`)
  expect(pdf.status()).toBe(200)
  expect(createHash('sha256').update(await pdf.body()).digest('hex')).toBe(ref.sha256)
  await page.goto('/')
  await page.getByRole('button',{name:'查看五店案例证据'}).click()
  await page.getByLabel('案例用途').selectOption('render')
  const card=page.locator('.case-reference').first()
  await card.locator('summary').click()
  await card.getByRole('button',{name:'载入本机证据'}).click()
  await expect(card.getByRole('link',{name:'打开已校验文件'})).toBeVisible()
  await expect.poll(()=>card.locator('img').evaluate(img=>img.naturalWidth)).toBeGreaterThan(0)
  expect(scripts.some(url=>url.includes('/assets/index-'))).toBe(true)
  expect(scripts.some(url=>url.includes('/src/')||url.includes('/@vite/'))).toBe(false)
  await page.screenshot({path:'../output/web-qa/production-evidence.png',fullPage:true})
})

test('built preview loads four real assets and exports the same layout in eight views',async({page})=>{
  const room={w:8,d:6,h:3.2,shopType:'中岛店'},positions=[[.5,.5],[.2,4.5],[3,.5],[5,2]]
  const items=realAssets.map((a,i)=>createAssetItem(a,`qa-${i}`,...positions[i]))
  const project={nodes:[{id:'r',kind:'root',name:'生产验证',room},{id:'p',parent:'r',kind:'plan',name:'四资产验证',layout:{room,items}}]}
  const loaded=new Set(),errors=[],scripts=[]
  page.on('pageerror',e=>errors.push(e.message))
  page.on('response',r=>{if(r.url().endsWith('/model.glb')&&r.status()===200)loaded.add(new URL(r.url()).pathname)})
  page.on('request',r=>{if(r.resourceType()==='script')scripts.push(r.url())})
  await page.goto('/')
  await page.getByLabel('导入项目 JSON').setInputFiles({name:'four-assets.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(project))})
  await expect(page.getByRole('status')).toContainText('已导入')
  await page.locator('.plan-card').first().click()
  await expect(page.locator('.properties')).toContainText('道具 4 / 200')
  const svgBytes=await downloadBytes(page,'导出平面 SVG')
  const svgLayout=await page.evaluate(xml=>JSON.parse(new DOMParser().parseFromString(xml,'image/svg+xml').querySelector('metadata').textContent).layout,svgBytes.toString())
  expect(svgLayout.items).toEqual(items)
  const png=await downloadBytes(page,'导出平面 PNG')
  expect([...png.subarray(0,8)]).toEqual([137,80,78,71,13,10,26,10])
  expect(png.readUInt32BE(16)*png.readUInt32BE(20)).toBeLessThanOrEqual(8000000)
  await expect(page.getByRole('status')).toContainText('不保证打印比例')
  await page.getByRole('button',{name:'确认平面并生成白膜'}).click()
  await expect(page.getByRole('button',{name:'确认白膜，渲染八视角'})).toBeEnabled({timeout:90000})
  expect([...loaded].sort()).toEqual(realAssets.map(a=>a.url).sort())
  await page.locator('.model canvas').screenshot({path:'../output/web-qa/production-four-assets-white.png'})
  await page.getByRole('button',{name:'确认白膜，渲染八视角'}).click()
  await expect(page.locator('.renders img')).toHaveCount(8,{timeout:90000})
  await page.screenshot({path:'../output/web-qa/production-four-assets-eight-views.png',fullPage:true})
  const downloading=page.waitForEvent('download')
  await page.getByRole('button',{name:'下载八视角完整包 ZIP'}).click()
  const files=unzipSync(await readFile(await(await downloading).path()))
  const manifest=JSON.parse(strFromU8(files['manifest.json'])),layout=JSON.parse(strFromU8(files['layout.json']))
  expect(layout.items).toEqual(items)
  expect(layout).toEqual(svgLayout)
  expect(manifest.views).toHaveLength(8)
  expect(manifest.layoutSha256).toBe(createHash('sha256').update(files['layout.json']).digest('hex'))
  for(const view of manifest.views)expect(view.sha256).toBe(createHash('sha256').update(files[view.file]).digest('hex'))
  const backupBytes=await downloadBytes(page,'导出项目快照')
  const backup=parseProject(backupBytes.toString())
  expect(backup.nodes.at(-1).layout).toEqual(layout)
  await page.reload()
  await page.getByLabel('导入项目 JSON').setInputFiles({name:'round-trip.json',mimeType:'application/json',buffer:backupBytes})
  await expect(page.getByRole('status')).toContainText('已导入')
  const recovered=await page.evaluate(()=>JSON.parse(localStorage.getItem('insta-studio-v2')))
  expect(recovered.nodes).toHaveLength(backup.nodes.length*2)
  expect(new Set(recovered.nodes.map(n=>n.id)).size).toBe(recovered.nodes.length)
  expect(recovered.nodes.at(-1).layout).toEqual(layout)
  expect(errors).toEqual([])
  expect(scripts.some(url=>url.includes('/src/')||url.includes('/@vite/'))).toBe(false)
})
