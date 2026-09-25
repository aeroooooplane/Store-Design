import {test,expect} from '@playwright/test'
import {writeFile,mkdir} from 'node:fs/promises'

test('local repeated real-asset scene records load and JS heap before and after disposal',async({page,context})=>{
  test.skip(process.env.ASSET_PERF_QA!=='1','Bounded local benchmark, not a GPU performance certification')
  test.setTimeout(180000)
  await page.goto('/')
  const cdp=await context.newCDPSession(page),results=[]
  const heap=async()=>{await cdp.send('HeapProfiler.collectGarbage');return (await cdp.send('Runtime.getHeapUsage')).usedSize}
  // Warm module loading separately from measured model loading.
  await page.evaluate(async()=>{await import('/src/scene.js');await import('/src/real-assets.js');await import('/src/asset-contract.js')})
  for(const copies of [1,4,4]){
    const before=await heap(),requests=[]
    const listener=r=>{if(r.url().endsWith('/model.glb'))requests.push(r.url())}
    page.on('request',listener)
    const metrics=await page.evaluate(async copies=>{
      const {createScene}=await import('/src/scene.js'),{realAssets}=await import('/src/real-assets.js'),{createAssetItem}=await import('/src/asset-contract.js')
      const items=Array.from({length:copies},(_,i)=>createAssetItem(realAssets[0],`copy-${i}`,1+i*2,1))
      const started=performance.now()
      window.perfScene=createScene(document.createElement('canvas'),{room:{w:12,d:8,h:3.2,shopType:'中岛店'},items},'SI1.0')
      await window.perfScene.ready
      const readyMs=performance.now()-started
      window.perfScene.view(1)
      const meshes=window.perfScene.geometryManifest().filter(m=>m.itemId!==null)
      return {readyMs,copies:window.perfScene.assetGeometry.length,meshCount:meshes.length,vertices:meshes.reduce((sum,m)=>sum+m.vertices,0)}
    },copies)
    const loaded=await heap()
    await page.evaluate(()=>{window.perfScene.dispose();window.perfScene=null})
    const disposed=await heap()
    page.off('request',listener)
    expect(metrics.copies).toBe(copies)
    expect(metrics.meshCount).toBeGreaterThan(0)
    results.push({...metrics,modelRequests:requests.length,heapBytes:{before,loaded,disposed}})
  }
  const report={at:new Date().toISOString(),scope:'1, 4, 4 copies of asset-408124; Edge test browser; JS heap after explicit GC only, not GPU/native memory or RTX4070 certification',results}
  await mkdir('../output/web-qa',{recursive:true})
  await writeFile(`../output/web-qa/asset-performance-${report.at.replace(/[:.]/g,'-')}.json`,JSON.stringify(report,null,2))
  console.log(JSON.stringify(report))
})
