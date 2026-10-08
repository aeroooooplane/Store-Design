import {readFile,realpath,stat} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import path from 'node:path'

const prefix='/__local-evidence/'
const localPeer=value=>['127.0.0.1','::1','::ffff:127.0.0.1'].includes(value)
const localHost=value=>/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(value||'')
const inside=(base,file)=>{const relative=path.relative(base,file);return relative!==''&&!relative.startsWith('..')&&!path.isAbsolute(relative)}

export function createEvidenceMiddleware(root,stores){
  const allowed=new Map()
  for(const store of stores)for(const [kind,refs] of [['layout',store.layouts],['render',store.renders]])for(const ref of refs){
    const url=`${prefix}${store.id}/${kind}/${ref.page}`
    if(allowed.has(url))throw Error('Duplicate evidence URL')
    allowed.set(url,{...ref,kind})
  }
  return async(req,res,next)=>{
    if(!req.url?.startsWith(prefix))return next()
    const fail=(status,error)=>{res.statusCode=status;res.setHeader('Content-Type','application/json; charset=utf-8');res.end(JSON.stringify({error}))}
    res.setHeader('Cache-Control','no-store')
    res.setHeader('Cross-Origin-Resource-Policy','same-origin')
    res.setHeader('X-Content-Type-Options','nosniff')
    if(!localPeer(req.socket.remoteAddress)||!localHost(req.headers.host)||req.headers['sec-fetch-site']==='cross-site')return fail(403,'证据仅允许本机同源访问')
    if(req.headers.origin&&req.headers.origin!==`http://${req.headers.host}`)return fail(403,'证据仅允许本机同源访问')
    if(!['GET','HEAD'].includes(req.method))return fail(405,'仅允许只读请求')
    const ref=allowed.get(req.url)
    if(!ref)return fail(404,'证据不在允许清单中')
    try{
      const base=await realpath(path.join(root,'资源库/90_处理过程与审核/PDF拆分/pages'))
      const file=await realpath(path.resolve(root,ref.path))
      if(!inside(base,file))return fail(403,'证据路径不在允许目录')
      const ext=path.extname(file).toLowerCase()
      if(ref.kind==='layout'?ext!=='.pdf':!['.jpg','.jpeg','.png'].includes(ext))return fail(403,'证据文件类型不匹配')
      const info=await stat(file)
      if(!info.isFile()||info.size>64*1024*1024)return fail(413,'证据文件超出预览限制')
      const bytes=await readFile(file)
      if(createHash('sha256').update(bytes).digest('hex')!==ref.sha256)return fail(409,'文件哈希与证据索引不一致，请重新核对，未显示文件')
      res.setHeader('Content-Type',ext==='.pdf'?'application/pdf':ext==='.png'?'image/png':'image/jpeg')
      res.setHeader('Content-Length',bytes.length)
      res.setHeader('X-Evidence-SHA256',ref.sha256)
      res.end(req.method==='HEAD'?undefined:bytes)
    }catch{fail(404,'本机文件缺失或无法读取；请同步对应资料，索引不会替代原件')}
  }
}

export function localEvidencePlugin(root,stores){
  const install=server=>{server.middlewares.use(createEvidenceMiddleware(root,stores))}
  return {name:'local-case-evidence',configureServer:install,configurePreviewServer:install}
}
