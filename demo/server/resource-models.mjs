import {createReadStream} from 'node:fs'
import {stat, realpath} from 'node:fs/promises'
import path from 'node:path'

// Preserve the public asset URLs while keeping the canonical files in the resource library.
export function resourceModelsPlugin(root, assets) {
  const ids = new Set(assets.map(a => a.id))
  const base = path.resolve(root, '资源库/04_软装道具模型/网页模型')
  const middleware = async (req, res, next) => {
    const url = req.url?.split('?')[0] || ''
    if (!url.startsWith('/assets/su/')) return next()
    const fail = (status, message) => {res.statusCode=status;res.setHeader('Content-Type','text/plain; charset=utf-8');res.end(message)}
    const peer = ['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress)
    const host = /^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(req.headers.host || '')
    if (!peer || !host || req.headers['sec-fetch-site'] === 'cross-site' || (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`)) return fail(403, '模型仅允许本机同源访问')
    const match = /^\/assets\/su\/(asset-\d+)\/model\.glb$/.exec(url)
    if (!match || !ids.has(match[1])) return fail(404, '模型不在已核定清单中')
    if (!['GET','HEAD'].includes(req.method)) return fail(405, '仅支持读取模型')
    try {
      const file = await realpath(path.join(base, match[1], 'model.glb'))
      const resolvedBase = await realpath(base)
      const relative = path.relative(resolvedBase, file)
      if (relative.startsWith('..') || path.isAbsolute(relative)) return fail(403, '模型超出资源目录')
      const info = await stat(file)
      if (!info.isFile()) return fail(404, '模型文件不存在')
      res.setHeader('Content-Type','model/gltf-binary');res.setHeader('Content-Length',info.size)
      res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Cross-Origin-Resource-Policy','same-origin')
      if (req.method === 'HEAD') return res.end()
      const stream = createReadStream(file)
      stream.on('error', () => res.destroy());res.on('close', () => stream.destroy());stream.pipe(res)
    } catch {return fail(404, '本机缺少对应GLB，请按资源补传清单恢复模型文件。')}
  }
  const install = server => {server.middlewares.use(middleware)}
  return {name:'resource-library-models',configureServer:install,configurePreviewServer:install}
}
