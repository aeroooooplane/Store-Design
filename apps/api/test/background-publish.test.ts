import fs, { mkdtemp, open, rm } from 'node:fs/promises'
import { syncBuiltinESMExports } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, it } from 'vitest'
import type { LightMyRequestResponse } from 'fastify'
import { createTestApp, png } from './helpers.ts'
import { renderChain } from './fixtures.ts'

function barrier() {
  let release!: () => void
  const promise = new Promise<void>((resolve) => {
    release = resolve
  })
  return { promise, release }
}

it('重复上传期间已有图片始终完整可读且不会重新打开覆盖', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'background-publish-'))
  const t = await createTestApp({ STORAGE_ROOT: dir })
  const originalRead = fs.readFile
  const originalWrite = fs.writeFile
  const reached = barrier()
  const resume = barrier()
  const writes: string[] = []
  let duplicate: Promise<LightMyRequestResponse> | undefined
  try {
    const { cameras } = await renderChain(t, { projectName: '背景同图复用回归' })
    const bytes = png(300, 200)
    const upload = (id: string) =>
      t.app.inject({
        method: 'POST',
        url: `/api/v1/cameras/${id}/background-image`,
        headers: { 'content-type': 'image/png' },
        payload: bytes,
      })
    const first = await upload(cameras[0]!.id)
    expect(first.statusCode).toBe(201)
    const image = first.json<{ fileId: string; url: string }>()
    const initial = await t.app.inject({ method: 'GET', url: image.url })
    expect(initial.statusCode).toBe(200)
    expect(initial.rawPayload.length).toBeGreaterThan(0)
    const isBackground = (file: unknown) =>
      String(file).includes(`${path.sep}backgrounds${path.sep}`)
    fs.readFile = (async (...args: Parameters<typeof fs.readFile>) => {
      const data = await originalRead(...args)
      if (isBackground(args[0])) {
        reached.release()
        await resume.promise
      }
      return data
    }) as typeof fs.readFile
    fs.writeFile = async (file, data, options) => {
      if (!isBackground(file) || (typeof file === 'object' && 'fd' in file))
        return originalWrite(file, data, options)
      const handle = await open(file, typeof options === 'object' ? (options?.flag ?? 'w') : 'w')
      try {
        writes.push(String(file))
        reached.release()
        await resume.promise
        await handle.writeFile(data)
      } finally {
        await handle.close()
      }
    }
    syncBuiltinESMExports()
    duplicate = upload(cameras[1]!.id)
    await Promise.race([reached.promise, duplicate.then(() => undefined)])
    const during = await t.app.inject({ method: 'GET', url: image.url })
    resume.release()
    const second = await duplicate
    expect(during.statusCode).toBe(200)
    expect(during.rawPayload).toEqual(initial.rawPayload)
    expect(writes).toEqual([])
    expect(second.statusCode).toBe(201)
    expect(second.json().fileId).toBe(image.fileId)
  } finally {
    resume.release()
    if (duplicate) await duplicate
    fs.readFile = originalRead
    fs.writeFile = originalWrite
    syncBuiltinESMExports()
    await t.close()
    await rm(dir, { recursive: true, force: true })
  }
})
