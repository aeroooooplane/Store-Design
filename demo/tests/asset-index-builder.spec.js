import {test,expect} from '@playwright/test'
import {mkdtemp,mkdir,copyFile,writeFile,readFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {spawnSync} from 'node:child_process'
import {realAssets} from '../src/real-assets.js'

async function run(mutate){
  const root=await mkdtemp(path.join(tmpdir(),'store-asset-index-'))
  const source=path.join(root,'素材库/04_assets/incoming/split-20260925-v2')
  await mkdir(source,{recursive:true})
  await mkdir(path.join(root,'demo/scripts'),{recursive:true})
  await mkdir(path.join(root,'demo/src/data'),{recursive:true})
  await copyFile(new URL('../scripts/build-asset-library.mjs',import.meta.url),path.join(root,'demo/scripts/build-asset-library.mjs'))
  await copyFile(new URL('../src/real-assets.js',import.meta.url),path.join(root,'demo/src/real-assets.js'))
  const manifest={assets:realAssets.map(a=>({asset_id:a.id,category:'测试类别',definition:'测试名称',status:'passed',instances:[{pid:1}],si_version:null}))}
  const validation={results:realAssets.map(a=>({asset_id:a.id,status:'passed',source_tight_face_bounds_m:[a.dimensions.w,a.dimensions.d,a.dimensions.h]}))}
  mutate?.(manifest,validation)
  await writeFile(path.join(source,'manifest.json'),JSON.stringify(manifest))
  await writeFile(path.join(source,'validation-summary.json'),JSON.stringify(validation))
  const output=path.join(root,'demo/src/data/asset-library.json')
  await writeFile(output,'prior-index')
  const result=spawnSync(process.execPath,[path.join(root,'demo/scripts/build-asset-library.mjs')],{encoding:'utf8'})
  return {result,output:await readFile(output,'utf8')}
}
test('builder rejects invalid display fields before replacing the previous index',async()=>{
  for(const change of [a=>a.category={},a=>a.definition='',a=>a.si_version={},a=>a.instances=[]]){
    const {result,output}=await run(m=>change(m.assets[0]))
    expect(result.status).not.toBe(0)
    expect(output).toBe('prior-index')
  }
})
test('builder preserves source dimensions and unknown SI for valid metadata',async()=>{
  const {result,output}=await run()
  expect(result.status,result.stderr).toBe(0)
  const data=JSON.parse(output)
  expect(data.assets).toHaveLength(4)
  expect(data.assets.every(a=>a.webReady&&a.siVersion===null&&a.facing===null)).toBe(true)
  expect(data.assets[0].dimensions).toEqual(realAssets[0].dimensions)
})
test('builder refuses duplicate joins and mismatched geometry without replacing the index',async()=>{
  for(const change of [(m,v)=>v.results.push(v.results[0]),m=>m.assets.push(m.assets[0]),(m,v)=>v.results[0].source_tight_face_bounds_m[0]+=1]){
    const {result,output}=await run(change)
    expect(result.status).not.toBe(0)
    expect(output).toBe('prior-index')
  }
})
