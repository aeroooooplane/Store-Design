import {test,expect} from '@playwright/test'
import {readFile} from 'node:fs/promises'

test('editor downloads a bounded PNG of the current plan without changing saved history',async({page})=>{
  await page.goto('/')
  await page.getByRole('button',{name:'生成四个平面方案'}).click()
  await page.locator('.plan-card').first().click()
  await expect(page.getByRole('button',{name:'导出平面 PNG',exact:true})).toBeVisible()
  const before=await page.evaluate(async()=>(await (await import('/src/project-db.js')).readProjectRaw()))
  const downloading=page.waitForEvent('download')
  await page.getByRole('button',{name:'导出平面 PNG',exact:true}).click()
  const download=await downloading,bytes=await readFile(await download.path())
  await download.saveAs('../output/web-qa/plan-export-preview.png')
  expect(download.suggestedFilename()).toBe('store-plan.png')
  expect([...bytes.subarray(0,8)]).toEqual([137,80,78,71,13,10,26,10])
  const w=bytes.readUInt32BE(16),h=bytes.readUInt32BE(20)
  expect(w).toBeGreaterThan(1000);expect(h).toBeGreaterThan(1000)
  expect(Math.max(w,h)).toBeLessThanOrEqual(4096)
  expect(w*h).toBeLessThanOrEqual(8000000)
  await expect(page.getByRole('status')).toContainText('不保证打印比例')
  expect(await page.evaluate(async()=>(await (await import('/src/project-db.js')).readProjectRaw()))).toBe(before)
})

test('raster export bounds large sheets and rejects decode failures instead of blank output',async({page})=>{
  await page.goto('/')
  const result=await page.evaluate(async()=>{
    const {exportLayoutPng}=await import('/src/plan-raster.js')
    const {exportLayoutSvg}=await import('/src/plan-export.js')
    const layout={room:{w:100,d:100,h:3},items:[]}
    const source=exportLayoutSvg(layout,{forRaster:true})
    const large=await exportLayoutPng(layout)
    const decode=HTMLImageElement.prototype.decode
    HTMLImageElement.prototype.decode=async()=>{throw Error('decode unavailable')}
    let error=''
    try{await exportLayoutPng(layout)}catch(e){error=e.message}finally{HTMLImageElement.prototype.decode=decode}
    return {width:large.width,height:large.height,size:large.blob.size,type:large.blob.type,error,source}
  })
  expect(result.width*result.height).toBeLessThanOrEqual(8000000)
  expect(Math.max(result.width,result.height)).toBeLessThanOrEqual(4096)
  expect(result.type).toBe('image/png');expect(result.size).toBeGreaterThan(1000)
  expect(result.error).toContain('decode unavailable')
  expect(result.source).toContain('不保证打印比例')
  expect(result.source).not.toContain('按原尺寸打印为 1:50')
})
