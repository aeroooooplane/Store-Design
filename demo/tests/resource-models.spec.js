import {test,expect} from '@playwright/test'
import {resourceModelsPlugin} from '../server/resource-models.mjs'
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'

test('canonical GLB reader validates indexed paths, missing entities and local access',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'resource-models-'))
  try{
    const folder=path.join(root,'资源库/04_软装道具模型/网页模型/asset-1')
    await mkdir(folder,{recursive:true});await writeFile(path.join(folder,'model.glb'),Buffer.from('glTF'))
    let middleware
    resourceModelsPlugin(root,[{id:'asset-1'},{id:'asset-2'}]).configureServer({middlewares:{use(fn){middleware=fn}}})
    async function request(url,extra={}){
      const response={statusCode:200,headers:{},setHeader(k,v){this.headers[k]=v},end(body){this.body=body}}
      await middleware({url,method:'HEAD',socket:{remoteAddress:'127.0.0.1'},headers:{host:'localhost:5179'},...extra},response,()=>{response.fallback=true})
      return response
    }
    const found=await request('/assets/su/asset-1/model.glb')
    expect(found.statusCode).toBe(200);expect(found.headers['Content-Type']).toBe('model/gltf-binary');expect(found.headers['Content-Length']).toBe(4)
    expect((await request('/assets/su/asset-2/model.glb')).statusCode).toBe(404)
    expect((await request('/assets/su/asset-3/model.glb')).statusCode).toBe(404)
    expect((await request('/assets/su/../outside.glb')).statusCode).toBe(404)
    expect((await request('/assets/su/asset-1/model.glb',{method:'POST'})).statusCode).toBe(405)
    expect((await request('/assets/su/asset-1/model.glb',{headers:{host:'evil.example'}})).statusCode).toBe(403)
    expect((await request('/unrelated')).fallback).toBe(true)
  }finally{
    if(path.dirname(root)===path.resolve(tmpdir())&&path.basename(root).startsWith('resource-models-'))await rm(root,{recursive:true})
  }
})
