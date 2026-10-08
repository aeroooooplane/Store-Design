import {test,expect} from '@playwright/test'
import {readFile} from 'node:fs/promises'
import {createHash} from 'node:crypto'

test('restored SI library serves all named models, previews and legends from canonical paths',async({request,page})=>{
  const manifest=JSON.parse(await readFile('../资源库/04_软装道具模型/单件模型/manifest.json','utf8'))
  expect(manifest.assets).toHaveLength(90)
  const images=new Set()
  for(const asset of manifest.assets){
    const model=await request.head('/model-library/'+asset.named_skp)
    expect(model.status(),asset.named_skp).toBe(200)
    expect(Number(model.headers()['content-length'])).toBe(asset.bytes)
    for(const file of [asset.preview,...asset.additional_views||[],asset.plan_legend?.file,asset.plan_legend?.context,asset.plan_legend?.raw_file].filter(Boolean))images.add(file)
  }
  for(const file of images){
    const response=await request.get('/model-library/'+file)
    expect(response.status(),file).toBe(200)
    expect(response.headers()['content-type'],file).toMatch(/^image\//)
  }
  const first=manifest.assets[0]
  const response=await request.get('/model-library/'+first.named_skp)
  expect(createHash('sha256').update(await response.body()).digest('hex')).toBe(first.named_sha256)
  await page.goto('/model-library/')
  await expect(page.locator('article')).toHaveCount(90)
  await page.locator('img').evaluateAll(async images=>{await Promise.all(images.map(img=>{img.loading='eager';return img.decode()}))})
  for(const version of ['SI1.0','SI2.0']){
    const pdf=await request.head('/si-standards/'+version+'.pdf')
    expect(pdf.status()).toBe(200);expect(pdf.headers()['content-type']).toBe('application/pdf')
  }
})
