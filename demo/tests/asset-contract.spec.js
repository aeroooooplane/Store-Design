import {test, expect} from '@playwright/test'
import {createAssetItem, rotateItem, assetPose, validateAsset} from '../src/asset-contract.js'

// Hand-measured fixture, not a claim about a production SU asset.
const asset={id:'fixture-table',name:'测试桌',category:'table',url:'/assets/table.glb',
  dimensions:{w:1.8,d:.8,h:.9},unit:'m',upAxis:'Y',origin:'bottom-center',siVersion:null}

test('real assets keep their measured size and unknown SI rather than inheriting placeholder sizes',()=>{
  const item=createAssetItem(asset,'placed-1',2,3)
  expect(item).toMatchObject({id:'placed-1',assetId:'fixture-table',w:1.8,d:.8,h:.9,x:2,z:3,rotation:0})
  expect(item.siVersion).toBeNull()
  expect(assetPose(item,asset)).toEqual({position:[2.9,0,3.4],rotationY:0})
})

test('quarter turns rotate real geometry and footprint together while preserving its center',()=>{
  const original=createAssetItem(asset,'placed-1',2,3)
  const rotated=rotateItem(original)
  expect(rotated.w).toBe(.8)
  expect(rotated.d).toBe(1.8)
  expect(rotated.x).toBeCloseTo(2.5)
  expect(rotated.z).toBeCloseTo(2.5)
  expect(assetPose(rotated,asset).rotationY).toBeCloseTo(-Math.PI/2)
  let item=original
  for(let i=0;i<4;i++)item=rotateItem(item)
  expect(item.rotation).toBe(0)
  for(const field of ['x','z','w','d','h'])expect(item[field]).toBeCloseTo(original[field])
  expect(original.rotation).toBe(0)
})

test('old parametric projects keep their previous top-left rotation behavior',()=>{
  const legacy={id:'old',type:'table',w:1.8,d:.8,h:.9,x:2,z:3}
  expect(rotateItem(legacy)).toEqual({...legacy,w:.8,d:1.8})
  expect(legacy.w).toBe(1.8)
})

test('reject missing provenance frame and invalid dimensions instead of inventing scale',()=>{
  for(const change of [{unit:'inch'},{upAxis:'Z'},{origin:'center'},{url:'https://outside.test/a.glb'},
    {dimensions:{w:0,d:.8,h:.9}},{dimensions:{w:1.8,d:NaN,h:.9}}]){
    expect(()=>validateAsset({...asset,...change})).toThrow()
  }
  const item=createAssetItem(asset,'placed-1',2,3)
  expect(()=>assetPose({...item,w:2},asset)).toThrow(/尺寸/)
  expect(()=>assetPose({...item,rotation:45},asset)).toThrow(/旋转/)
  expect(()=>assetPose({...item,assetId:'different'},asset)).toThrow(/资产/)
  expect(()=>createAssetItem(asset,'placed-1',Infinity,3)).toThrow(/坐标/)
})
