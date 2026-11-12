import { test } from 'node:test'
import assert from 'node:assert/strict'
import { makeProject } from './usable-project.mjs'

function fixture() {
  return {
    sample: {store_id:'DEMO',name:'合成空间',shopType:'边厅',si:'SI2.0',source:{sha256:'a'.repeat(64),page:1}},
    plan: {store_id:'DEMO',transform:{mmPerPixel:10},space:{schemaVersion:1,height:4,boundary:[[0,0],[6,0],[6,8],[0,8]],entrances:[{kind:'main',a:[1,8],b:[5,8]}],obstacles:[]},layout:{schemaVersion:3,items:[{id:'不应自动摆放'}]}},
    dimensions: {store_id:'DEMO',sourceSha256:'a'.repeat(64),sourcePage:1,mmPerPixel:10,dimensions:[{role:'calibration',pointsPx:[[0,0],[600,0]],lengthMm:6000},{role:'independent-check',pointsPx:[[600,0],[600,800]],lengthMm:8000}]},
    exportedAt:'2026-11-12T00:00:00.000Z',
  }
}
test('保留空间与入口，原生项目不自动摆放旧道具，不升级为已审核',()=>{
  const f=fixture(),before=structuredClone(f),r=makeProject(f)
  assert.deepEqual(f,before)
  assert.equal(r.project.nodes[0].layout,null)
  assert.deepEqual(r.project.nodes[0].space.entrances,f.plan.space.entrances)
  assert.equal(r.project.nodes[0].space.calibration.verified,false)
  assert.equal(r.project.nodes[0].origin,'agent')
})
test('独立尺寸需重新计算，不信任旧报告误差',()=>{
  const f=fixture();f.dimensions.independentRelativeError=0;f.dimensions.dimensions[1].lengthMm=7000
  assert.throws(()=>makeProject(f),/误差/)
})
test('来源编号、指纹、页号和比例不一致时阻断',()=>{
  for(const [key,value] of [['store_id','OTHER'],['sourceSha256','b'.repeat(64)],['sourcePage',2],['mmPerPixel',12]]){
    const f=fixture();f.dimensions[key]=value;assert.throws(()=>makeProject(f))
  }
})
test('自交轮廓和悬空入口不能进入可用样例',()=>{
  const f=fixture();f.plan.space.boundary=[[0,0],[6,8],[6,0],[0,8]];assert.throws(()=>makeProject(f),/几何/)
  const g=fixture();g.plan.space.entrances[0].a=[3,3];assert.throws(()=>makeProject(g),/几何/)
})
