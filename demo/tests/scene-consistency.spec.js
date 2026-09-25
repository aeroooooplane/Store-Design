import {test,expect} from '@playwright/test'

test('white and styled edge-shop exports include identical enclosure, sign and light geometry',async({page})=>{
  await page.goto('/')
  const manifests=await page.evaluate(async()=>{
    const {createScene}=await import('/src/scene.js')
    const results=[]
    for(const style of ['white','SI1.0','SI2.0']){
      const scene=createScene(document.createElement('canvas'),{room:{w:8,d:6,h:3},items:[]},style)
      await scene.ready;results.push(scene.geometryManifest());scene.dispose()
    }
    return results
  })
  expect(manifests[0]).toHaveLength(6) // Floor, three cutaway walls, sign plane, light bar.
  expect(manifests[0]).toEqual(manifests[1])
  expect(manifests[1]).toEqual(manifests[2])
})

test('closed scene refuses camera rendering as well as image export',async({page})=>{
  await page.goto('/')
  const result=await page.evaluate(async()=>{
    const {createScene}=await import('/src/scene.js')
    const scene=createScene(document.createElement('canvas'),{room:{w:8,d:6,h:3},items:[]})
    await scene.ready;scene.dispose()
    let view=false,image=false
    try{scene.view(1)}catch{view=true}
    try{scene.image()}catch{image=true}
    return {view,image}
  })
  expect(result).toEqual({view:true,image:true})
})

test('closing a loading real-asset scene cancels readiness and never adds a late placeholder',async({page})=>{
  await page.goto('/')
  await page.route('**/assets/su/asset-408124/model.glb',()=>{})
  const result=await page.evaluate(async()=>{
    const {createScene}=await import('/src/scene.js')
    const {realAssets}=await import('/src/real-assets.js')
    const {createAssetItem}=await import('/src/asset-contract.js')
    const scene=createScene(document.createElement('canvas'),{room:{w:8,d:6,h:3},items:[createAssetItem(realAssets[0],'a',2,2)]})
    scene.dispose();scene.dispose()
    let rejected=false,blocked=false
    try{await scene.ready}catch{rejected=true}
    try{scene.image()}catch{blocked=true}
    return {rejected,blocked,count:scene.assetGeometry.length}
  })
  expect(result).toEqual({rejected:true,blocked:true,count:0})
})
