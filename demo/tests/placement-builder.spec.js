import {test,expect} from '@playwright/test'
import {createHash} from 'node:crypto'
import {placementEntry} from '../scripts/build-placement-manifest.mjs'

// Header-only fixture exercises the metadata gate; geometry is separately reloaded by conversion and runtime.
function fixture(){
  const bytes=Buffer.alloc(20);bytes.write('glTF');bytes.writeUInt32LE(2,4);bytes.writeUInt32LE(bytes.length,8)
  const named={asset_id:'asset-1',standard_name:'开箱桌',variant:'测试',material_category:'软装物料',tight_face_bounds_xyz_mm:[1800,800,900]}
  const report={id:'asset-1',status:'converted-dimensions-checked-visual-review-pending',dimensions:{w:1.8,d:.8,h:.9},expectedDimensions:{w:1.8,d:.8,h:.9},unit:'m',upAxis:'Y',origin:'bottom-center',url:'/assets/su/asset-1/model.glb',bytes:bytes.length,glbSha256:createHash('sha256').update(bytes).digest('hex')}
  return {bytes,named,report,policy:{categoryOverrides:{}}}
}
test('manifest gate rejects broken conversion contracts and file integrity',()=>{
  for(const mutate of [
    f=>delete f.report.expectedDimensions,
    f=>f.report.expectedDimensions.w=NaN,
    f=>f.report.origin='center',
    f=>f.report.unit='inch',
    f=>f.report.dimensions.w+=1,
    f=>f.report.glbSha256='0'.repeat(64),
    f=>f.named.standard_name='徕卡墙',
    f=>f.named.material_category='信息化物料',
    f=>f.named.asset_id='asset-2',
    f=>f.bytes.writeUInt32LE(1,4),
  ]){
    const f=fixture();mutate(f)
    expect(()=>placementEntry(f.named,f.report,f.bytes,f.policy)).toThrow()
  }
})
test('validated metadata preserves dimensions and explicitly pending style acceptance',()=>{
  const f=fixture(),entry=placementEntry(f.named,f.report,f.bytes,f.policy)
  expect(entry.dimensions).toEqual(f.report.dimensions)
  expect(entry.siVersion).toBeNull()
  expect(entry.facing).toBeNull()
  expect(entry.name).toBe('开箱桌 · 测试')
})
