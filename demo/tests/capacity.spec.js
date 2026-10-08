import {test,expect} from '@playwright/test'

test('generation stops before exceeding the recoverable node limit',async({page})=>{
  await page.addInitScript(()=>localStorage.setItem('insta-studio-v2',JSON.stringify({nodes:Array.from({length:497},(_,i)=>({id:`r${i}`,name:`项目 ${i}`,kind:'root',room:{w:8,d:6,h:3}}))})))
  await page.goto('/')
  await page.getByRole('button',{name:'＋ 新建尺寸方案'}).click()
  await expect(page.getByRole('button',{name:'生成四个平面方案'})).toBeDisabled()
  await expect(page.locator('main')).toContainText('剩余 3 个节点')
})

test('a full layout cannot add an unsavable 201st object',async({page})=>{
  await page.addInitScript(()=>localStorage.setItem('insta-studio-v2',JSON.stringify({nodes:[
    {id:'root',name:'容量测试',kind:'root',room:{w:30,d:30,h:3}},
    {id:'plan',parent:'root',name:'200件方案',kind:'plan',layout:{room:{w:30,d:30,h:3},items:Array.from({length:200},(_,i)=>({id:`i${i}`,name:'桌',type:'table',x:i%20,z:Math.floor(i/20),w:.5,d:.5,h:.9}))}}
  ]})))
  await page.goto('/')
  await page.locator('.plan-card').first().click()
  await expect(page.getByRole('button',{name:'＋ 收银台',exact:true})).toBeDisabled()
  await expect(page.getByRole('button',{name:'＋ 1800mm普通中岛桌 · 产品陈列A',exact:true})).toBeDisabled()
  await expect(page.locator('.properties')).toContainText('200 / 200')
})

test('last snapshot slot cannot be spent twice and a full history keeps dirty edits when navigating',async({page})=>{
  await page.addInitScript(()=>localStorage.setItem('insta-studio-v2',JSON.stringify({nodes:[
    ...Array.from({length:498},(_,i)=>({id:`r${i}`,name:`项目 ${i}`,kind:'root',room:{w:8,d:6,h:3}})),
    {id:'p',parent:'r0',name:'容量方案',kind:'plan',layout:{room:{w:8,d:6,h:3},items:[]}}
  ]})))
  await page.goto('/')
  await page.locator('.branch-list button').filter({hasText:'容量方案'}).click()
  await expect(page.getByRole('button',{name:'确认平面并生成白膜'})).toBeDisabled()
  await page.getByRole('button',{name:'保存平面快照',exact:true}).click()
  await expect(page.getByRole('button',{name:'保存平面快照',exact:true})).toBeDisabled()
  await page.getByRole('button',{name:'＋ 收银台',exact:true}).click()
  await expect(page.getByRole('button',{name:'＋ 新建尺寸方案'})).toBeDisabled()
  await page.locator('.branch-list button').filter({hasText:'容量方案'}).click()
  await expect(page.getByRole('status')).toContainText('未丢弃当前草稿')
  await expect(page.locator('.drawing svg g')).toHaveCount(1)
  await expect.poll(()=>page.evaluate(async()=>JSON.parse((await (await import('/src/project-db.js')).readProjectRaw())).editorDraft?.layout.items.length)).toBe(1)
})
