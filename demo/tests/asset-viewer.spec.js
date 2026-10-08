import {test,expect} from '@playwright/test'

async function fixture(page){
  await page.goto('/')
  const encoded=await page.evaluate(async()=>{
    const T=await import('/node_modules/three/build/three.module.js')
    const {GLTFExporter}=await import('/node_modules/three/examples/jsm/exporters/GLTFExporter.js')
    const mesh=new T.Mesh(new T.BoxGeometry(2,1,1),new T.MeshStandardMaterial({color:'#d03020',opacity:.7,transparent:true}))
    mesh.position.y=.5
    const buffer=await new GLTFExporter().parseAsync(mesh,{binary:true})
    return Array.from(new Uint8Array(buffer))
  })
  await page.route('**/assets/fixture.glb',r=>r.fulfill({contentType:'model/gltf-binary',body:Buffer.from(encoded)}))
}

test('GLB viewer waits for loading, keeps geometry across white/original, and refuses disposed export',async({page})=>{
  await fixture(page)
  const result=await page.evaluate(async()=>{
    const {createAssetViewer}=await import('/src/asset-viewer.js')
    const asset={id:'fixture',name:'测试柜',url:'/assets/fixture.glb',unit:'m',upAxis:'Y',origin:'bottom-center',dimensions:{w:2,h:1,d:1}}
    const viewer=createAssetViewer(document.createElement('canvas'),asset)
    let pending=false;try{viewer.image()}catch{pending=true}
    await viewer.ready
    const original=viewer.inspect()
    const originalImage=viewer.image()
    viewer.setWhite(true)
    const white=viewer.inspect(),whiteImage=viewer.image()
    viewer.setWhite(false)
    const restored=viewer.image()
    viewer.dispose();viewer.dispose()
    let disposed=false;try{viewer.image()}catch{disposed=true}
    return {pending,disposed,original,white,changed:originalImage!==whiteImage,restored:originalImage===restored}
  })
  expect(result.pending).toBe(true)
  expect(result.disposed).toBe(true)
  expect(result.original.bounds).toEqual(result.white.bounds)
  expect(result.original.meshCount).toBe(1)
  expect(result.white.opacities).toEqual(result.original.opacities)
  expect(result.changed).toBe(true)
  expect(result.restored).toBe(true)
})

test('missing GLB reports a failure and cannot export a placeholder',async({page})=>{
  await page.goto('/')
  await page.route('**/assets/missing.glb',r=>r.fulfill({status:404,body:'missing'}))
  const result=await page.evaluate(async()=>{
    const {createAssetViewer}=await import('/src/asset-viewer.js')
    const viewer=createAssetViewer(document.createElement('canvas'),{id:'missing',name:'missing',url:'/assets/missing.glb',unit:'m',upAxis:'Y',origin:'bottom-center',dimensions:{w:2,h:1,d:1}})
    let error,blocked=false
    try{await viewer.ready}catch(e){error=e.message}
    try{viewer.image()}catch{blocked=true}
    viewer.dispose();return {error,blocked}
  })
  expect(result.error).toContain('404')
  expect(result.blocked).toBe(true)
})

test('asset preview panel explains missing local assets without breaking the layout workflow',async({page})=>{
  await page.route('**/assets/su/asset-408124/model.glb',r=>r.fulfill({status:404,body:'missing'}))
  await page.goto('/')
  await page.getByRole('button',{name:'预览真实 SU 体验桌'}).click({timeout:5000})
  await expect(page.getByRole('alert')).toContainText('404')
  await expect(page.getByRole('button',{name:'下载道具预览 PNG'})).toBeDisabled()
  await page.getByRole('button',{name:'关闭道具预览'}).click()
  await page.getByRole('button',{name:'生成四个平面方案 →'}).click()
  await expect(page.locator('.plan-card')).toHaveCount(4)
})

test('local real asset visual QA',async({page})=>{
  test.skip(process.env.REAL_ASSET_QA!=='1','Requires the preserved local SU conversion, not uploaded to Git')
  await page.goto('/')
  await page.getByRole('button',{name:'预览真实 SU 体验桌'}).click()
  await expect(page.getByRole('status').filter({hasText:'真实网格已载入'})).toBeVisible({timeout:60000})
  await page.locator('canvas[aria-label="真实 SU 道具三维预览"]').screenshot({path:'../output/web-qa/asset-408124-material.png'})
  await page.getByRole('button',{name:'查看白模'}).click()
  await page.locator('canvas[aria-label="真实 SU 道具三维预览"]').screenshot({path:'../output/web-qa/asset-408124-white.png'})
  const downloadPromise=page.waitForEvent('download')
  await page.getByRole('button',{name:'下载道具预览 PNG'}).click()
  const download=await downloadPromise
  expect(download.suggestedFilename()).toBe('asset-408124-white.png')
})
