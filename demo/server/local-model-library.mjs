import {readFile, realpath, stat} from 'node:fs/promises'
import {createReadStream} from 'node:fs'
import path from 'node:path'

import {LIBRARY as library} from './model-library-paths.mjs'
const review='资源库/05_店铺形象设计标准/历史阅读记录'
const guide='docs/si-standards-review-20261001.md'
const localPeer=value=>['127.0.0.1','::1','::ffff:127.0.0.1'].includes(value)
const localHost=value=>/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(value||'')
const escape=value=>value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')

export function localModelLibraryPlugin(root){
  const middleware=async(req,res,next)=>{
    const raw=req.url?.split('?')[0]||''
    if(!['/model-library','/model-library/','/si-standards/','/si-guide/'].some(prefix=>raw===prefix||raw.startsWith(prefix.endsWith('/')?prefix:prefix+'/')))return next()
    const fail=(status,message)=>{res.statusCode=status;res.setHeader('Content-Type','text/plain; charset=utf-8');res.end(message)}
    res.setHeader('Cache-Control','no-store')
    res.setHeader('X-Content-Type-Options','nosniff')
    res.setHeader('Cross-Origin-Resource-Policy','same-origin')
    if(!localPeer(req.socket.remoteAddress)||!localHost(req.headers.host)||req.headers['sec-fetch-site']==='cross-site'||(req.headers.origin&&req.headers.origin!==`http://${req.headers.host}`))return fail(403,'模型库仅允许本机同源访问')
    if(!['GET','HEAD'].includes(req.method))return fail(405,'仅支持浏览和下载')
    if(raw==='/model-library'){res.statusCode=302;res.setHeader('Location','/model-library/');return res.end()}
    let url
    try{url=decodeURIComponent(raw)}catch{return fail(400,'无效的文件地址')}
    try{
      // Resolve only explicitly indexed assets; never expose the whole project directory.
      const allowed=new Map()
      const add=(route,relative)=>allowed.set(route,path.resolve(root,relative))
      for(const name of ['模型目录.html','模型清单.csv','缺少效果图清单.csv','README.md','manifest.json'])add('/model-library/'+name,library+'/'+name)
      add('/model-library/',library+'/模型目录.html')
      const manifest=JSON.parse(await readFile(path.join(root,library,'manifest.json'),'utf8'))
      for(const asset of manifest.assets)for(const file of [asset.named_skp,asset.preview,...asset.additional_views||[],asset.product_image,asset.plan_symbol?.svg,asset.plan_symbol?.png].filter(Boolean))add('/model-library/'+file,library+'/'+file)
      add('/model-library/_图例来源/index.json',library+'/_图例来源/index.json')
      for(const asset of manifest.assets)if(asset.plan_legend){
        for(const file of [asset.plan_legend.file,asset.plan_legend.context,asset.plan_legend.raw_file].filter(Boolean))add('/model-library/'+file,library+'/'+file)
      }
      add('/si-standards/标准阅读索引.html',review+'/标准阅读索引.html')
      for(const version of ['SI1.0','SI2.0'])add('/si-standards/'+version+'.pdf','资源库/05_店铺形象设计标准/PDF/'+version+'手册-店铺形象设计标准.pdf')
      add('/si-guide/si-standards-review-20261001.md',guide)
      if(url.startsWith('/si-standards/')){
        const pages=JSON.parse(await readFile(path.join(root,review,'逐页文字与阅读索引.json'),'utf8'))
        for(const page of pages)add('/si-standards/'+page.preview,review+'/'+page.preview)
      }
      const requested=allowed.get(url)
      if(!requested)return fail(404,'该文件不在模型库清单中')
      const file=await realpath(requested),base=await realpath(root)
      const relative=path.relative(base,file)
      if(relative.startsWith('..')||path.isAbsolute(relative))return fail(403,'文件不在项目目录中')
      const info=await stat(file)
      if(!info.isFile())return fail(404,'文件不存在')
      const ext=path.extname(file).toLowerCase()
      if(ext==='.html'||ext==='.md'){
        let content=await readFile(file,'utf8')
        const back='<nav class="catalogue-nav" style="padding:16px 32px;border-bottom:1px solid #111;background:white;color:#111"><a style="color:inherit;margin-right:24px" href="/">← 返回设计工作台</a><a style="color:inherit" href="/model-library/">SI 模型库</a></nav>'
        if(ext==='.md')content='<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>模型库使用与命名记录</title>'+back+'<pre style="white-space:pre-wrap;max-width:1000px;margin:32px auto;padding:20px;font:16px/1.8 sans-serif">'+escape(content)+'</pre></html>'
        else content=content.replace('<header>',back+'<header>').replaceAll('../../05_店铺形象设计标准/历史阅读记录/','/si-standards/').replaceAll('../../../资源库/05_店铺形象设计标准/历史阅读记录/','/si-standards/').replaceAll('../../../docs/','/si-guide/').replaceAll('../05_店铺形象设计标准/历史阅读记录/','/si-standards/').replaceAll('../../docs/','/si-guide/')
        res.setHeader('Content-Type','text/html; charset=utf-8');res.setHeader('Content-Length',Buffer.byteLength(content));return res.end(req.method==='HEAD'?undefined:content)
      }
      if(ext==='.svg')res.setHeader('Content-Security-Policy',"default-src 'none'; style-src 'unsafe-inline'")
      const types={'.pdf':'application/pdf','.jpg':'image/jpeg','.png':'image/png','.svg':'image/svg+xml','.json':'application/json; charset=utf-8','.csv':'text/csv; charset=utf-8','.skp':'application/octet-stream'}
      res.setHeader('Content-Type',types[ext]||'application/octet-stream')
      res.setHeader('Content-Length',info.size)
      if(ext==='.skp'||ext==='.csv')res.setHeader('Content-Disposition',`attachment; filename*=UTF-8''${encodeURIComponent(path.basename(file))}`)
      if(req.method==='HEAD')return res.end()
      const stream=createReadStream(file);stream.on('error',()=>res.destroy());res.on('close',()=>stream.destroy());stream.pipe(res)
    }catch{return fail(404,'本机模型库文件缺失，请检查项目中的已命名模型和标准阅读目录。')}
  }
  const install=server=>{server.middlewares.use(middleware)}
  return {name:'local-si-model-library',configureServer:install,configurePreviewServer:install}
}
