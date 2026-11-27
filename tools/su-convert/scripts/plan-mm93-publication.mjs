// Produces a reviewable delta for the designated publisher; never changes OneDrive resources.
import { readFile, writeFile, readdir, mkdir, copyFile, realpath } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import assert from 'node:assert/strict'

const [outArg] = process.argv.slice(2)
assert.ok(outArg, 'Usage: node plan-mm93-publication.mjs external-package')
const out=path.resolve(outArg),repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..')
const resource=await realpath(path.join(repo,'资源库')),id='asset-90000607',releaseVersion='models-20261127-mm93'
const sha=b=>createHash('sha256').update(b).digest('hex'),enc=v=>JSON.stringify(v,null,2)+'\n'
const load=async f=>JSON.parse((await readFile(f,'utf8')).replace(/^\uFEFF/,''))
const {entry}=await load(path.join(out,'catalog-delta.json')),validation=await load(path.join(out,'package-validation.json'))
const browser=await load(path.join(out,'isolated-catalog-validation.json'))
assert.equal(entry.asset_id,id);assert.equal(browser.rows.length,4);assert.deepEqual(browser.errors,[])
assert.ok(browser.rows.every(r=>r.placementSaved&&r.rotation&&r.observed.finishPrepared))
const audit='90_处理过程与审核/模型发布/20261127/mm93'
await mkdir(path.join(out,'payload',audit,'五向'),{recursive:true})
await copyFile(path.join(out,'five-views',id+'.png'),path.join(out,'payload',audit,'五向',id+'.png'))
await copyFile(path.join(out,id+'.png'),path.join(out,'payload',audit,'透明缩略图.png'))
const files=[],metadata=[]
const row=async(stagedFile,relativePath)=>{const bytes=await readFile(path.join(out,stagedFile));return {relativePath,stagedFile,sha256:sha(bytes),bytes:bytes.length}}
async function walk(relative){for(const e of await readdir(path.join(out,'payload',relative),{withFileTypes:true})){
  const rel=relative?relative+'/'+e.name:e.name
  if(e.isDirectory())await walk(rel);else files.push({...await row('payload/'+rel,rel),assetId:id})
}}
await walk('')
for(const file of ['manifest.json','facing.json']){
  const relativePath='04_模型库/'+file,live=await readFile(path.join(resource,relativePath))
  assert.equal(sha(live),validation.baselineMetadata[file],'Shared metadata changed; prepare a fresh candidate')
  metadata.push({...await row('metadata/'+relativePath,relativePath),baselineSha256:sha(live)})
}
const before=await load(path.join(resource,'04_模型库/manifest.json')),after=await load(path.join(out,'metadata/04_模型库/manifest.json'))
assert.equal(after.assets.length,before.assets.length+1)
assert.deepEqual(after.assets.slice(0,-1),before.assets,'Existing asset entries must remain unchanged')
assert.equal(after.assets.at(-1).asset_id,id)
const lock=await load(path.join(repo,'resources.lock.json'))
for(const m of metadata)assert.equal(lock.requiredFiles[m.relativePath].toLowerCase(),m.baselineSha256,'Resource lock and metadata baseline differ')
for(const f of [...files,...metadata])lock.requiredFiles[f.relativePath]=f.sha256.toUpperCase()
lock.releaseVersions.models=releaseVersion
const plan={schemaVersion:1,date:'2026-11-27',resourceRoot:resource,releaseVersion,assetCount:1,assetIds:[id],files,metadata,sources:[],
  originalSourceSha256:validation.sourceSha256,displayLengthMm:validation.displayLengthMm,physicallyMeasured:false}
await writeFile(path.join(out,'publication-plan.json'),enc(plan),{flag:'wx'})
await writeFile(path.join(out,'resources.lock.candidate.json'),enc(lock),{flag:'wx'})
const summary={id,name:entry.display_name,releaseVersion,payloadFiles:files.length,metadataFiles:metadata.length,
  payloadBytes:files.reduce((n,f)=>n+f.bytes,0),planSha256:sha(Buffer.from(enc(plan))),lockSha256:sha(Buffer.from(enc(lock))),
  baselineAssets:before.assets.length,resultAssets:after.assets.length,oldEntriesUnchanged:true,isolatedScenarios:browser.rows.length,
  originalAppearanceUnchanged:true,displayLengthMm:validation.displayLengthMm,productionPublished:false}
await writeFile(path.join(out,'publication-summary.json'),enc(summary),{flag:'wx'})
console.log(JSON.stringify(summary))
