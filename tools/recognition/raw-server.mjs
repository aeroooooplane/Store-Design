// 本地试验入口：不接触主工作台数据库，不下载模型，不提供云端调用。
import http from 'node:http'
import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID, createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { previewProject } from './raw-project.mjs'
import { scaleCandidates, heightCandidates } from './raw-semantics.mjs'
const run = promisify(execFile),
  config = JSON.parse(await fs.readFile(process.argv[2], 'utf8'))
const model = await fs.readFile(config.model)
if (createHash('sha256').update(model).digest('hex') !== config.modelSha256)
  throw Error('模型指纹不符')
const root = path.resolve(config.output)
await fs.mkdir(root, { recursive: true })
const host = '127.0.0.1',
  port = config.port ?? 3080,
  origin = `http://${host}:${port}`
const html = await fs.readFile(new URL('./raw-upload.html', import.meta.url))
let busy = false
const send = (res, status, data) => {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  })
  res.end(JSON.stringify(data))
}
const body = async (req) => {
  let chunks = [],
    size = 0
  for await (const c of req) {
    size += c.length
    if (size > 28 * 1024 * 1024) throw Error('请求超过限制')
    chunks.push(c)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}
const safeId = (s) => /^[a-f0-9-]{36}$/.test(s)
const server = http.createServer(async (req, res) => {
  try {
    if (req.headers.host !== `${host}:${port}`) return send(res, 403, { error: '仅允许本机地址' })
    const url = new URL(req.url, origin)
    if (req.method === 'GET' && url.pathname === '/') {
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Security-Policy':
          "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'",
      })
      return res.end(html)
    }
    const m =
      /^\/result\/([^/]+)\/(input\.png|raw\.json|reading\.json|semantic\.json|project\.json|export-provenance\.json)$/.exec(
        url.pathname,
      )
    if (req.method === 'GET' && m && safeId(m[1])) {
      const data = await fs.readFile(path.join(root, m[1], m[2]))
      res.writeHead(200, {
        'Content-Type': m[2].endsWith('.png') ? 'image/png' : 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
      })
      return res.end(data)
    }
    if (req.method !== 'POST') return send(res, 404, { error: '不存在' })
    if (req.headers.origin !== origin || req.headers['x-local-recognition'] !== '1')
      return send(res, 403, { error: '仅接受本页面主动操作' })
    if (url.pathname === '/recognize') {
      if (busy) return send(res, 409, { error: '正在识别另一张图，请稍后再试' })
      busy = true
      try {
        const data = await body(req)
        if (typeof data.image !== 'string') throw Error('未提供图片')
        const bytes = Buffer.from(data.image, 'base64')
        if (bytes.length > 20 * 1024 * 1024) throw Error('图片超过20MB')
        const id = randomUUID(),
          input = path.join(root, id + '.input'),
          out = path.join(root, id)
        await fs.writeFile(input, bytes, { flag: 'wx' })
        const started = Date.now()
        await run(
          config.python,
          [
            '-B',
            '-X',
            'utf8',
            path.join(import.meta.dirname, 'raw-infer.py'),
            '--image',
            input,
            '--model',
            config.model,
            '--out',
            out,
          ],
          { timeout: 120000, maxBuffer: 1024 * 1024, windowsHide: true },
        )
        await run(process.execPath, [path.join(import.meta.dirname, 'raw-read.mjs'), out], {
          timeout: 180000,
          maxBuffer: 1024 * 1024,
          windowsHide: true,
        })
        const raw = JSON.parse(await fs.readFile(path.join(out, 'raw.json'), 'utf8')),
          reading = JSON.parse(await fs.readFile(path.join(out, 'reading.json'), 'utf8'))
        const semantic = {
          scale: scaleCandidates(reading.texts, raw.lines),
          height: heightCandidates(reading.texts),
        }
        await fs.writeFile(path.join(out, 'semantic.json'), JSON.stringify(semantic, null, 2), {
          flag: 'wx',
        })
        return send(res, 200, {
          id,
          raw,
          reading,
          semantic,
          seconds: (Date.now() - started) / 1000,
          completeAutomatically: false,
          cloudRequests: 0,
        })
      } finally {
        busy = false
      }
    }
    if (url.pathname === '/export') {
      const data = await body(req)
      if (!safeId(data.id)) throw Error('结果编号无效')
      const out = path.join(root, data.id),
        raw = JSON.parse(await fs.readFile(path.join(out, 'raw.json'), 'utf8'))
      const result = previewProject(raw, data.options)
      // 每次导出创建独立目录；自动原始候选及先前人工操作保留。
      const exportId = randomUUID(),
        dest = path.join(root, exportId)
      await fs.mkdir(dest)
      await fs.writeFile(path.join(dest, 'project.json'), JSON.stringify(result.project, null, 2))
      await fs.writeFile(
        path.join(dest, 'export-provenance.json'),
        JSON.stringify({ ...result.provenance, sourceRun: data.id }, null, 2),
      )
      return send(res, 200, {
        projectUrl: `/result/${exportId}/project.json`,
        provenanceUrl: `/result/${exportId}/export-provenance.json`,
      })
    }
    return send(res, 404, { error: '不存在' })
  } catch (e) {
    send(res, 400, { error: e instanceof Error ? e.message : '处理失败' })
  }
})
server.listen(port, host, () => console.log(`RAW_READY ${origin}`))
process.on('SIGINT', () => server.close())
process.on('SIGTERM', () => server.close())
