// Model library location (资源库/04_模型库, restructured 2026-10-10). Files are found through its
// manifest.json, whose paths are relative to the library folder.
import {readFile} from 'node:fs/promises'
import path from 'node:path'

export const LIBRARY='资源库/04_模型库'

export async function readLibrary(repo){
  // Use the same RESOURCE_ROOT contract as catalog:white/finish/import for isolated builds.
  const resource=process.env.RESOURCE_ROOT?path.resolve(repo,process.env.RESOURCE_ROOT):path.join(repo,'资源库')
  const root=path.join(resource,'04_模型库')
  const text=await readFile(path.join(root,'manifest.json'),'utf8')
  const manifest=JSON.parse(text.replace(/^\uFEFF/,''))
  return {
    root,
    manifest,
    /** asset id → absolute folder holding model.glb and conversion.json */
    webModels:new Map(manifest.assets.filter(a=>a.web_model).map(a=>[a.asset_id,path.join(root,a.web_model)])),
    facingPath:path.join(root,'facing.json'),
  }
}

/** Where a newly converted web model of this asset goes. */
export function webModelDirFor(root,asset){
  return path.join(root,asset.web_model||path.posix.join(asset.folder,'网页模型'))
}
