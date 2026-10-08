// Metadata-only derived index. Never copy or modify models, images or source labels.
import {readFile,writeFile} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {realAssets} from '../src/real-assets.js'
const root=new URL('../../',import.meta.url)
const source='素材库/04_assets/incoming/split-20260925-v2/'
const hashes={}
async function read(name){
  const bytes=await readFile(new URL(source+name,root))
  hashes[name]=createHash('sha256').update(bytes).digest('hex')
  return JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/,''))
}
const manifest=await read('manifest.json'),validation=await read('validation-summary.json')
const checks=new Map(validation.results.map(row=>[row.asset_id,row]))
if(checks.size!==validation.results.length)throw Error('Duplicate validation IDs')
const ids=new Set()
const assets=manifest.assets.map(entry=>{
  if(!['category','definition'].every(key=>typeof entry[key]==='string'&&entry[key].trim()))throw Error('Invalid source label')
  if(entry.si_version!=null&&(typeof entry.si_version!=='string'||!entry.si_version.trim()))throw Error('Invalid source SI field')
  if(!Array.isArray(entry.instances)||entry.instances.length===0)throw Error('Missing source instances')
  if(!/^asset-\d+$/.test(entry.asset_id)||ids.has(entry.asset_id))throw Error('Invalid or duplicate asset ID')
  ids.add(entry.asset_id)
  const check=checks.get(entry.asset_id),bounds=check?.source_tight_face_bounds_m
  if(entry.status!=='passed'||check?.status!=='passed'||bounds?.length!==3||!bounds.every(n=>Number.isFinite(n)&&n>0))throw Error('Unverified dimensions: '+entry.asset_id)
  const web=realAssets.find(a=>a.id===entry.asset_id)
  if(web&&['w','d','h'].some((key,i)=>Math.abs(web.dimensions[key]-bounds[i])>.001))throw Error('Web dimension mismatch: '+entry.asset_id)
  return {id:entry.asset_id,category:entry.category,sourceName:entry.definition,instanceCount:entry.instances.length,
    dimensions:{w:bounds[0],d:bounds[1],h:bounds[2]},siVersion:entry.si_version??null,facing:null,webReady:!!web}
})
if(realAssets.some(a=>!ids.has(a.id)))throw Error('Web asset missing from source')
const output={schemaVersion:1,sourceDirectory:source,sourceHashes:hashes,assets}
await writeFile(new URL('demo/src/data/asset-library.json',root),JSON.stringify(output,null,2)+'\n')
console.log(`${assets.length} metadata records; ${assets.filter(a=>a.webReady).length} web-enabled; no model files copied.`)
