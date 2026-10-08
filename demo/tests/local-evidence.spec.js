import {test,expect} from '@playwright/test'
import {createEvidenceMiddleware} from '../server/local-evidence.mjs'
import {mkdtemp,mkdir,writeFile,rm,readFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {createHash} from 'node:crypto'

test('evidence reader checks content hashes and blocks files outside the allowed page directory',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'store-evidence-test-'))
  try{
    await mkdir(path.join(root,'output/pdf/cleaned-v2/pages'),{recursive:true})
    const bytes=Buffer.from('%PDF-1.4\nfixture'),relative='output/pdf/cleaned-v2/pages/fixture.pdf'
    await writeFile(path.join(root,relative),bytes)
    await writeFile(path.join(root,'outside.pdf'),bytes)
    const hash=createHash('sha256').update(bytes).digest('hex')
    const middleware=createEvidenceMiddleware(root,[{id:'test',layouts:[{page:1,path:relative,sha256:hash},{page:2,path:relative,sha256:'0'.repeat(64)},{page:3,path:'outside.pdf',sha256:hash}],renders:[]}])
    async function get(page){
      const result={statusCode:200,headers:{},setHeader(k,v){this.headers[k]=v},end(body){this.body=body}}
      await middleware({url:`/__local-evidence/test/layout/${page}`,method:'GET',socket:{remoteAddress:'127.0.0.1'},headers:{host:'localhost:5179'}},result,()=>{throw Error('Unexpected fallback')})
      return result
    }
    const valid=await get(1)
    expect(valid.statusCode).toBe(200);expect(valid.body.equals(bytes)).toBe(true)
    expect(valid.headers['X-Evidence-SHA256']).toBe(hash)
    expect((await get(2)).statusCode).toBe(409)
    expect((await get(3)).statusCode).toBe(403)
  }finally{
    // Only the dedicated directory created by this test may be removed.
    if(path.dirname(root)===path.resolve(tmpdir())&&path.basename(root).startsWith('store-evidence-test-'))await rm(root,{recursive:true})
  }
})

test('local source evidence opens as a hash-verified image and PDF',async({page,request})=>{
  test.skip(process.env.LOCAL_EVIDENCE_QA!=='1','Requires original local case assets')
  const manifest=JSON.parse(await readFile(new URL('../src/data/case-library.json',import.meta.url)))
  const store=manifest.stores[0],ref=store.layouts[0]
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
})

test('local evidence endpoint rejects unknown files, cross-site access and mutation methods',async({request})=>{
  const url='/__local-evidence/PDF-001/layout/14'
  expect((await request.get('/__local-evidence/not-allowed')).status()).toBe(404)
  expect((await request.get(url,{headers:{origin:'https://untrusted.example'}})).status()).toBe(403)
  expect((await request.get(url,{headers:{'sec-fetch-site':'cross-site'}})).status()).toBe(403)
  expect((await request.post(url)).status()).toBe(405)
})

test('missing local evidence reports an error without offering a placeholder PDF',async({page})=>{
  await page.route('**/__local-evidence/**',route=>route.fulfill({status:404,contentType:'application/json',body:JSON.stringify({error:'本机文件缺失'})}))
  await page.goto('/')
  await page.getByRole('button',{name:'查看五店案例证据'}).click()
  const ref=page.locator('.case-reference').first()
  await ref.locator('summary').click()
  await ref.getByRole('button',{name:'载入本机证据'}).click({timeout:5000})
  await expect(ref.getByRole('alert')).toContainText('本机文件缺失')
  await expect(ref.getByRole('link',{name:'打开已校验文件'})).toHaveCount(0)
})
