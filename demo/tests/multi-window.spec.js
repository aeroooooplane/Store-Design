import {test,expect} from '@playwright/test'

test('stale window cannot overwrite a newer draft and can still export its own work',async({page,context})=>{
  await page.goto('/')
  await page.getByRole('button',{name:'生成四个平面方案'}).click()
  const other=await context.newPage();await other.goto('/')
  await page.locator('.plan-card').first().click()
  await page.getByRole('button',{name:'＋ 收银台',exact:true}).click()
  const saved=await page.evaluate(()=>localStorage.getItem('insta-studio-v2'))
  await other.getByRole('button',{name:'＋ 新建尺寸方案'}).click()
  await other.getByRole('button',{name:'生成四个平面方案'}).click()
  await expect(other.getByRole('alert')).toContainText('其他窗口')
  expect(await page.evaluate(()=>localStorage.getItem('insta-studio-v2'))).toBe(saved)
  const download=other.waitForEvent('download')
  await other.getByRole('button',{name:'导出项目快照'}).click()
  const stream=await(await download).createReadStream(),chunks=[]
  for await(const c of stream)chunks.push(c)
  expect(JSON.parse(Buffer.concat(chunks).toString()).nodes).toHaveLength(10)
})

test('simultaneous window saves serialize and refuse stale content',async({page,context})=>{
  await page.goto('/')
  const other=await context.newPage();await other.goto('/')
  await Promise.all([page.getByRole('button',{name:'生成四个平面方案'}).click(),other.getByRole('button',{name:'生成四个平面方案'}).click()])
  await expect.poll(async()=>await page.getByRole('alert').count()+await other.getByRole('alert').count()).toBe(1)
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('insta-studio-v2')).nodes.length)).toBe(5)
})
