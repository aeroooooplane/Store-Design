import {test,expect} from '@playwright/test'

test('compact project tools expand for backup and export the active draft on mobile',async({page})=>{
  await page.setViewportSize({width:390,height:900})
  await page.goto('/')
  await page.getByRole('button',{name:'生成四个平面方案'}).click()
  await page.locator('.plan-card').first().click()
  const original=await page.locator('.drawing svg g').count()
  await page.getByRole('button',{name:'＋ 收银台',exact:true}).click()
  const tools=page.getByRole('region',{name:'项目工具',exact:true})
  await expect(tools).toBeVisible()
  await expect(tools.getByLabel('导入项目 JSON')).toBeHidden()
  await tools.locator('summary').click()
  await expect(tools.getByLabel('导入项目 JSON')).toBeVisible()
  const downloaded=page.waitForEvent('download')
  await tools.getByRole('button',{name:'导出当前备份'}).click()
  const stream=await(await downloaded).createReadStream(),chunks=[]
  for await(const chunk of stream)chunks.push(chunk)
  expect(JSON.parse(Buffer.concat(chunks).toString()).editorDraft.layout.items).toHaveLength(original+1)
  await tools.screenshot({path:'test-results/project-tools-mobile.png'})
  await tools.getByRole('button',{name:'查看五店案例证据'}).click()
  await expect(tools.locator('.case-card')).toHaveCount(5)
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(391)
})
