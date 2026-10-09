import {readFile, readdir, writeFile, rename} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import path from 'node:path'
import {fileURLToPath, pathToFileURL} from 'node:url'
import {validateAsset} from '../src/asset-contract.js'

const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const readJSON = async file => JSON.parse(await readFile(file, 'utf8'))

export function placementEntry(named, report, bytes, policy, facing = null) {
  if(named.asset_id !== report.id || !/^asset-\d+$/.test(report.id)) throw Error('资产编号不匹配')
  if(named.material_category !== '软装物料' || /墙|标识|灯|吊|屏/.test(named.standard_name)) throw Error('未核定为落地软装：'+report.id)
  if(report.status !== 'converted-dimensions-checked-visual-review-pending') throw Error('缺少转换校验：'+report.id)
  if(bytes.length < 20 || bytes.toString('ascii',0,4) !== 'glTF' || bytes.readUInt32LE(4)!==2 || bytes.readUInt32LE(8)!==bytes.length) throw Error('无效 GLB：'+report.id)
  if(bytes.length !== report.bytes || hash(bytes)!==report.glbSha256) throw Error('GLB 哈希或大小不匹配：'+report.id)
  const expected = named.tight_face_bounds_xyz_mm
  if(!Array.isArray(expected) || expected.length!==3 || ['w','d','h'].some((k,i) => !Number.isFinite(expected[i]) || !Number.isFinite(report.expectedDimensions?.[k]) || Math.abs(report.dimensions?.[k]-expected[i]/1000)>.001 || Math.abs(report.dimensions?.[k]-report.expectedDimensions?.[k])>.001)) throw Error('源模型尺寸不匹配：'+report.id)
  const category=policy.categoryOverrides[report.id] || (/收银/.test(named.standard_name)?'counter':/桌|试飞台/.test(named.standard_name)?'table':'display')
  return validateAsset({id:report.id, name:named.standard_name+' · '+named.variant, standardName:named.standard_name,
    variant:named.variant, category, materialCategory:named.material_category, styleFamily:named.si_family,
    dimensions:report.dimensions, url:report.url, unit:report.unit, upAxis:report.upAxis, origin:report.origin,
    installation:'floor', siVersion:null, facing:facing?.front ?? null, bytes:report.bytes, glbSha256:report.glbSha256,
    sourceSha256:report.sourceSha256, namedSkpSha256:named.named_sha256,
    catalogueUrl:'/model-library/#'+report.id,
    status:facing ? '尺寸与原点已校验；正面方向已初审；SI归属见目录，材质待验收' : '尺寸与原点已校验；SI归属见目录，正面及材质待验收'})
}

export async function buildPlacementManifest(repo) {
  const demo=path.join(repo,'demo'),dir=path.join(repo,'资源库/04_软装道具模型/网页模型')
  const named=await readJSON(path.join(repo,'资源库/04_软装道具模型/单件模型/manifest.json'))
  const policy=await readJSON(path.join(demo,'src/data/placement-policy.json'))
  const facing=(await readJSON(path.join(dir,'facing.json'))).assets
  const byId=new Map(named.assets.map(a=>[a.asset_id,a]))
  if(byId.size!==named.assets.length) throw Error('命名清单含重复编号')
  // Only the IDs the legacy workbench enables; the other converted GLBs wait for the new catalogue.
  const enabled=new Set(policy.webAssets)
  const folders=(await readdir(dir,{withFileTypes:true})).filter(e=>e.isDirectory()&&/^asset-\d+$/.test(e.name)).map(e=>e.name)
  for(const id of enabled) if(!folders.includes(id)) throw Error('开放摆放的资产缺少 GLB：'+id)
  const assets=[]
  for(const folder of folders.filter(id=>enabled.has(id)).map(name=>({name}))){
    const report=await readJSON(path.join(dir,folder.name,'conversion.json'))
    if(report.id!==folder.name || !byId.has(report.id)) throw Error('转换记录没有唯一来源：'+folder.name)
    const source=path.resolve(repo,report.source),rel=path.relative(repo,source)
    if(rel.startsWith('..')||path.isAbsolute(rel)) throw Error('转换来源超出项目')
    if(hash(await readFile(source))!==report.sourceSha256) throw Error('源 DAE 已变化：'+report.id)
    if(report.url!==`/assets/su/${report.id}/model.glb`) throw Error('转换地址不匹配')
    assets.push(placementEntry(byId.get(report.id),report,await readFile(path.join(dir,folder.name,'model.glb')),policy,facing[report.id]))
  }
  const priority=id=>{const i=policy.preferredOrder.indexOf(id);return i<0?policy.preferredOrder.length:i}
  assets.sort((a,b)=>priority(a.id)-priority(b.id)||a.id.localeCompare(b.id,undefined,{numeric:true}))
  for(const [category,id] of Object.entries(policy.planningDefaults)) if(!assets.some(a=>a.id===id&&a.category===category)) throw Error('缺少默认规划规格：'+category)
  const output={schemaVersion:1, source:'本机转换报告与已审核命名清单', assets}
  const target=path.join(demo,'src/data/placement-manifest.json')
  await writeFile(target+'.tmp',JSON.stringify(output,null,2)+'\n')
  await rename(target+'.tmp',target)
  return output
}

if(process.argv[1] && import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  const result=await buildPlacementManifest(path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'))
  console.log(`${result.assets.length} verified, floor-mounted assets; source models unchanged.`)
}
