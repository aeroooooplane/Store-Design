import {test,expect} from '@playwright/test'

test('real asset addition and center rotation survive saved layout reload',async({page})=>{
  await page.goto('/')
  await page.getByRole('button',{name:'生成四个平面方案'}).click()
  await page.locator('.plan-card').first().click()
  await page.getByRole('button',{name:'＋ 真实体验桌',exact:true}).click({timeout:5000})
  await expect(page.getByLabel('道具结构')).toHaveCount(0)
  await page.getByRole('button',{name:'旋转 90°'}).click()
  await page.getByRole('button',{name:'保存平面快照',exact:true}).click()
  await page.reload()
  await page.locator('.branch-list button').filter({hasText:'平面快照'}).last().click()
  const item=await page.evaluate(()=>JSON.parse(localStorage.getItem('insta-studio-v2')).nodes.at(-1).layout.items.at(-1))
  expect(item.assetId).toBe('asset-408124')
  expect(item.rotation).toBe(90)
  expect(item.w).toBeCloseTo(1.8)
  expect(item.d).toBeCloseTo(1)
  expect(item.siVersion).toBeNull()
})

test('layout scene rejects missing real models rather than exporting parameter boxes',async({page})=>{
  await page.goto('/')
  await page.route('**/assets/su/asset-408124/model.glb',r=>r.fulfill({status:404,body:'missing'}))
  const result=await page.evaluate(async()=>{
    const {createScene}=await import('/src/scene.js')
    const {firstRealAsset}=await import('/src/AssetPreview.jsx')
    const {createAssetItem}=await import('/src/asset-contract.js')
    const scene=createScene(document.createElement('canvas'),{room:{w:8,d:6,h:3},items:[createAssetItem(firstRealAsset,'a',2,2)]})
    let before=false,after=false,error=''
    try{scene.image()}catch{before=true}
    try{await scene.ready}catch(e){error=e.message}
    try{scene.image()}catch{after=true}
    scene.dispose();return {before,after,error}
  })
  expect(result.before).toBe(true)
  expect(result.after).toBe(true)
  expect(result.error).toContain('404')
})

test('loaded real model receives layout rotation and location before any view exports',async({page})=>{
  await page.goto('/')
  const bytes=await page.evaluate(async()=>{
    const T=await import('/node_modules/three/build/three.module.js')
    const {GLTFExporter}=await import('/node_modules/three/examples/jsm/exporters/GLTFExporter.js')
    const m=new T.Mesh(new T.BoxGeometry(1,1.32688522,1.8),new T.MeshStandardMaterial())
    m.position.y=1.32688522/2
    return Array.from(new Uint8Array(await new GLTFExporter().parseAsync(m,{binary:true})))
  })
  await page.route('**/assets/su/asset-408124/model.glb',r=>r.fulfill({contentType:'model/gltf-binary',body:Buffer.from(bytes)}))
  const result=await page.evaluate(async()=>{
    const {createScene}=await import('/src/scene.js')
    const {firstRealAsset}=await import('/src/AssetPreview.jsx')
    const {createAssetItem,rotateItem}=await import('/src/asset-contract.js')
    const item=rotateItem(createAssetItem(firstRealAsset,'placed',2,3))
    const scene=createScene(document.createElement('canvas'),{room:{w:8,d:6,h:3},items:[item]})
    await scene.ready
    const geometry=scene.assetGeometry
    const image=scene.image();scene.dispose();return {geometry,image}
  })
  expect(result.geometry).toHaveLength(1)
  expect(result.geometry[0].rotationY).toBeCloseTo(-Math.PI/2)
  expect(result.geometry[0].position[0]).toBeCloseTo(2.5)
  expect(result.geometry[0].position[2]).toBeCloseTo(3.9)
  expect(result.image).toMatch(/^data:image\/png/)
})

test('local four-asset scene visual QA',async({page})=>{
  test.skip(process.env.REAL_ASSET_QA!=='1','Local-only converted source assets')
  await page.goto('/')
  for(const style of ['white','SI1.0']){
    const count=await page.evaluate(async style=>{
      const {createScene}=await import('/src/scene.js')
      const {realAssets}=await import('/src/real-assets.js')
      const {createAssetItem}=await import('/src/asset-contract.js')
      const positions=[[.5,.5],[.2,4.5],[3,.5],[5,2]]
      const items=realAssets.map((a,i)=>createAssetItem(a,`qa-${i}`,...positions[i]))
      const canvas=document.createElement('canvas');canvas.id='real-scene-qa';document.body.append(canvas)
      window.qaScene=createScene(canvas,{room:{w:8,d:6,h:3.2,shopType:'中岛店'},items},style)
      await window.qaScene.ready
      window.qaScene.view(1)
      return window.qaScene.assetGeometry.length
    },style)
    expect(count).toBe(4)
    await page.locator('#real-scene-qa').screenshot({path:`../output/web-qa/four-assets-${style}.png`})
    await page.evaluate(()=>{window.qaScene.dispose();document.getElementById('real-scene-qa').remove()})
  }
})

test('repeated asset loads once per scene and keeps independent transforms across styles',async({page})=>{
  await page.goto('/')
  const bytes=await page.evaluate(async()=>{
    const T=await import('/node_modules/three/build/three.module.js'),{GLTFExporter}=await import('/node_modules/three/examples/jsm/exporters/GLTFExporter.js')
    const m=new T.Mesh(new T.BoxGeometry(1,1.32688522,1.8),new T.MeshStandardMaterial({color:'#cc3311'}));m.position.y=1.32688522/2
    return Array.from(new Uint8Array(await new GLTFExporter().parseAsync(m,{binary:true})))
  })
  let requests=0
  await page.route('**/assets/su/asset-408124/model.glb',r=>{requests++;return r.fulfill({contentType:'model/gltf-binary',body:Buffer.from(bytes)})})
  const results=await page.evaluate(async()=>{
    const {createScene}=await import('/src/scene.js'),{realAssets}=await import('/src/real-assets.js'),{createAssetItem,rotateItem}=await import('/src/asset-contract.js')
    const items=[createAssetItem(realAssets[0],'first',1,1),rotateItem(createAssetItem(realAssets[0],'second',4,3))],results=[]
    for(const style of ['white','SI1.0']){
      const scene=createScene(document.createElement('canvas'),{room:{w:8,d:6,h:3},items},style)
      await scene.ready
      results.push({placed:scene.assetGeometry,meshes:scene.geometryManifest().filter(m=>m.itemId),image:scene.image().slice(0,22)})
      scene.dispose();scene.dispose()
    }
    return results
  })
  expect(requests).toBe(2) // One fetch in each scene, never a cross-scene stale cache.
  for(const result of results){
    expect(result.placed.map(p=>p.itemId)).toEqual(['first','second'])
    expect(result.placed[0].position[0]).toBeCloseTo(1.5)
    expect(result.placed[1].position[0]).toBeCloseTo(4.5)
    expect(result.placed[1].rotationY).toBeCloseTo(-Math.PI/2)
    expect(result.meshes).toHaveLength(2)
    expect(result.meshes[0].matrix).not.toEqual(result.meshes[1].matrix)
    expect(result.image).toBe('data:image/png;base64,')
  }
  expect(results[0].meshes).toEqual(results[1].meshes)
})
