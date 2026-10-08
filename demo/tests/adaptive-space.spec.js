import {test,expect} from '@playwright/test'
import {generatePlans,issues} from '../src/layout.js'
import {assetPose} from '../src/asset-contract.js'
import {findRealAsset} from '../src/real-assets.js'
import {parseProject} from '../src/project-import.js'

test('space capacity grows with area and every generated asset keeps its real size',()=>{
  const counts=[]
  for(const side of [4,6,10,15]){
    const plans=generatePlans({w:side,d:side,h:3.2,shopType:'边厅店'})
    counts.push(plans[0].items.filter(i=>i.type==='table').length)
    for(const plan of plans){expect(issues(plan)).toEqual([]);for(const item of plan.items)expect(()=>assetPose(item,findRealAsset(item.assetId))).not.toThrow()}
  }
  expect(counts).toEqual([1,2,5,12])
})

test('rectangular shops leave entrance and circulation free over the supported range',()=>{
  for(const shopType of ['边厅店','中岛店'])for(const w of [4,5,6,8,12,20,30])for(const d of [4,5,8,15,30]){
    for(const plan of generatePlans({w,d,h:3.2,shopType})){
      expect(issues(plan),`${shopType} ${w}x${d} ${plan.name}`).toEqual([])
      expect(plan.items.length).toBeLessThanOrEqual(200)
      expect(plan.planning.placed).toBeGreaterThan(0)
    }
  }
})

test('moving an object into the reserved entrance is detected',()=>{
  const plan=generatePlans({w:8,d:6,h:3.2})[0]
  plan.items[0].z=5
  expect(issues(plan).some(s=>s.includes('通道'))).toBeTruthy()
})

test('backup import rejects corrupt or out-of-room circulation metadata',()=>{
  const room={w:8,d:6,h:3.2},layout=generatePlans(room)[0]
  const nodes=[{id:'r',name:'空间',kind:'root',room},{id:'p',name:'方案',kind:'plan',parent:'r',layout}]
  expect(()=>parseProject(JSON.stringify({nodes}))).not.toThrow()
  layout.planning.zones[0].x=100
  expect(()=>parseProject(JSON.stringify({nodes}))).toThrow(/通道/)
})

test('real furniture finish renders differ from white and keep geometry across eight cameras',async({page})=>{
  test.setTimeout(180000)
  await page.goto('/')
  const result=await page.evaluate(async()=>{
    const {generatePlans}=await import('/src/layout.js'),{createScene}=await import('/src/scene.js')
    const plan=generatePlans({w:8,d:6,h:3.2,shopType:'边厅店'})[0],images=[],manifests=[]
    for(const style of ['white','SI1.0','SI2.0']){
      const canvas=document.createElement('canvas');canvas.id='qa-'+style;document.body.append(canvas)
      const scene=createScene(canvas,plan,style)
      try{await scene.ready;manifests.push(JSON.stringify(scene.geometryManifest()));
        const views=[];for(let i=0;i<8;i++){scene.view(i);views.push(scene.image())}images.push(views)
        scene.view(7)
        const img=document.createElement('img');img.id='proof-'+style;img.src=scene.image();img.style.width='960px';document.body.append(img)
      }finally{scene.dispose();canvas.remove()}
    }
    return {sameGeometry:new Set(manifests).size===1,differentStyle:images[0][0]!==images[1][0]&&images[1][0]!==images[2][0],views:images.map(v=>new Set(v).size)}
  })
  expect(result).toEqual({sameGeometry:true,differentStyle:true,views:[8,8,8]})
  for(const style of ['white','SI1.0','SI2.0'])await page.locator(`[id="proof-${style}"]`).screenshot({path:`test-results/quality-${style}.png`})
})
