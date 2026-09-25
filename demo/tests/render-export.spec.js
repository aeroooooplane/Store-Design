import {test,expect} from '@playwright/test'
import {unzipSync,strFromU8} from 'three/addons/libs/fflate.module.js'
import {buildRenderBundle} from '../src/render-export.js'
import {readFile} from 'node:fs/promises'
import {createHash} from 'node:crypto'

const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII='
const node={id:'render-1',kind:'render',name:'预览',style:'SI1.0',layout:{name:'方案',room:{w:8,d:6,h:3,shopType:'边厅店'},items:[]}}

test('render ZIP binds eight named PNGs to one layout hash and the actual relative cameras',async()=>{
  const files=unzipSync(await buildRenderBundle(node,Array(8).fill(png)))
  expect(Object.keys(files).filter(n=>n.endsWith('.png'))).toHaveLength(8)
  expect(files['views/01.png'].slice(0,8)).toEqual(new Uint8Array([137,80,78,71,13,10,26,10]))
  const manifest=JSON.parse(strFromU8(files['manifest.json']))
  expect(manifest.nodeId).toBe('render-1')
  expect(manifest.layoutSha256).toMatch(/^[0-9a-f]{64}$/)
  expect(manifest.views[0].camera.position).toEqual([4,9.2,10.8])
  expect(manifest.views[0].camera.target).toEqual([4,.75,3])
  expect(manifest.views[0].sha256).toMatch(/^[0-9a-f]{64}$/)
  expect(manifest.views[0].width).toBe(1)
  expect(JSON.parse(strFromU8(files['layout.json']))).toEqual(node.layout)
  expect(strFromU8(files['plan.svg'])).toContain('非施工图')
})

test('incomplete images or non-PNG input cannot produce a misleading completed render pack',async()=>{
  await expect(buildRenderBundle(node,Array(7).fill(png))).rejects.toThrow(/8/)
  await expect(buildRenderBundle(node,[...Array(7).fill(png),'data:image/png;base64,YmFk'])).rejects.toThrow(/PNG/)
  await expect(buildRenderBundle({...node,kind:'plan'},Array(8).fill(png))).rejects.toThrow()
})

test('completed render screen downloads one ZIP for the selected branch',async({page})=>{
  await page.goto('/')
  let navigations=0
  page.on('framenavigated',frame=>{if(frame===page.mainFrame())navigations++})
  await page.getByRole('button',{name:'生成四个平面方案'}).click()
  await page.locator('.plan-card').first().click()
  await page.getByRole('button',{name:'确认平面并生成白膜'}).click()
  await page.getByRole('button',{name:'确认白膜，渲染八视角'}).click()
  await expect(page.locator('.renders img')).toHaveCount(8)
  const download=page.waitForEvent('download',{timeout:15000})
  await page.getByRole('button',{name:'下载八视角完整包 ZIP'}).click({timeout:5000})
  const saved=await download
  expect(saved.suggestedFilename()).toBe('store-views.zip')
  const files=unzipSync(await readFile(await saved.path()))
  const manifest=JSON.parse(strFromU8(files['manifest.json']))
  expect(manifest.views).toHaveLength(8)
  expect(manifest.layoutSha256).toBe(createHash('sha256').update(files['layout.json']).digest('hex'))
  for(const view of manifest.views){
    expect([view.width,view.height]).toEqual([960,640])
    expect(view.sha256).toBe(createHash('sha256').update(files[view.file]).digest('hex'))
  }
  expect(navigations).toBe(0)
})
