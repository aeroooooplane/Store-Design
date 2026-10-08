import {test,expect} from '@playwright/test'
const room={w:8,d:6,h:2,shopType:'边厅店'}
const layout={room,items:[{id:'i',name:'高柜',type:'display',x:1,z:1,w:1,d:1,h:3}]}
for(const kind of ['white','render'])test(`${kind} can resume its exact layout as an independent editable child`,async({page})=>{
  const source={id:'s',kind,parent:'r',name:'需要调整',layout,...(kind==='render'?{style:'SI2.0'}:{})}
  await page.goto('/')
  await page.evaluate(p=>localStorage.setItem('insta-studio-v2',JSON.stringify(p)),{nodes:[{id:'r',kind:'root',name:'门店',room},source]})
  await page.reload()
  await page.locator('.branch-list button').filter({hasText:'需要调整'}).click()
  const resume=page.getByRole('button',{name:'复制当前布局继续编辑',exact:true})
  await expect(resume).toBeVisible()
  await resume.click()
  await expect(page.locator('.properties .warning')).toContainText('高度超过层高')
  await expect.poll(()=>page.evaluate(async()=>JSON.parse((await (await import('/src/project-db.js')).readProjectRaw())).nodes.length)).toBe(3)
  const saved=await page.evaluate(async()=>JSON.parse((await (await import('/src/project-db.js')).readProjectRaw())))
  expect(saved.nodes[1]).toEqual(source)
  expect(saved.nodes[2]).toMatchObject({kind:'edit',parent:'s',layout})
  await page.locator('.drawing .plan g').first().click()
  await page.getByRole('button',{name:'删除',exact:true}).click()
  await expect.poll(()=>page.evaluate(async()=>JSON.parse((await (await import('/src/project-db.js')).readProjectRaw())).editorDraft?.layout.items.length)).toBe(0)
  await page.reload()
  await expect(page.locator('.properties')).toContainText('道具 0 / 200')
})
test('full history cannot create another editable child',async({page})=>{
  const nodes=Array.from({length:499},(_,i)=>({id:`r${i}`,kind:'root',name:`门店${i}`,room}))
  nodes.push({id:'s',kind:'white',parent:'r0',name:'需要调整',layout})
  await page.goto('/')
  await page.evaluate(p=>localStorage.setItem('insta-studio-v2',JSON.stringify(p)),{nodes})
  await page.reload()
  await page.locator('.branch-list button').filter({hasText:'需要调整'}).click()
  await expect(page.getByRole('button',{name:'复制当前布局继续编辑',exact:true})).toBeDisabled()
})
