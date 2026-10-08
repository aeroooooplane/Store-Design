import fs from 'node:fs/promises'
import {createHash} from 'node:crypto'
import assert from 'node:assert/strict'
import {fileURLToPath} from 'node:url'
import {chromium} from '../../demo/node_modules/@playwright/test/index.mjs'
const root=new URL('../../资源库/99_历史归档/渲染对照/s03-v2/',import.meta.url)
const manifest=JSON.parse(await fs.readFile(new URL('manifest.json',root),'utf8'))
assert.equal(manifest.assets.length,8)
for(const a of manifest.assets)assert.equal(createHash('sha256').update(await fs.readFile(new URL(a.file,root))).digest('hex'),a.sha256)
const prompts=JSON.parse(await fs.readFile(new URL('ai-prompts.json',root),'utf8'))
assert.ok(prompts.prompt.includes('FOUR slim legs'))
const browser=await chromium.launch({channel:'msedge',headless:true})
try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[]
  page.on('pageerror',e=>errors.push(e.message))
  await page.goto(new URL('ai.html',root).href)
  assert.equal(await page.locator('img').count(),10)
  assert.ok(await page.locator('img').evaluateAll(imgs=>imgs.every(i=>i.complete&&i.naturalWidth>0)))
  for(const href of await page.locator('a').evaluateAll(as=>as.map(a=>a.getAttribute('href'))))await fs.access(new URL(href,root))
  await page.locator('summary').first().click()
  await page.locator('input').first().fill('80')
  assert.equal(await page.locator('#overlay-0').evaluate(el=>el.style.opacity),'0.8')
  assert.deepEqual(errors,[])
  await page.screenshot({path:fileURLToPath(new URL('ai-gallery-preview.png',root)),fullPage:true})
  console.log('Verified 8 image hashes, complete prompt, 10 loaded images, local links, overlay control, no page errors.')
}finally{await browser.close()}
