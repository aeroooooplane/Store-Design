import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { seedStoredFile } from './fixtures.ts'
import { createTestApp, png } from './helpers.ts'
import type { TestApp } from './helpers.ts'

let t: TestApp
let dir: string
const sha = (data: Buffer) => createHash('sha256').update(data).digest('hex')
const photo = png(800, 600)
const small = png(100, 80, 120)

async function seed(name: string, data: Buffer, contentType: string) {
  await writeFile(path.join(dir, 'resource', name), data)
  return seedStoredFile(t, {
    storageKey: name,
    kind: 'product_image',
    contentType,
    bytes: data.length,
    sha256: sha(data),
  })
}

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'thumbs-'))
  await mkdir(path.join(dir, 'resource'))
  t = await createTestApp({
    RESOURCE_ROOT: path.join(dir, 'resource'),
    STORAGE_ROOT: path.join(dir, 'storage'),
  })
})

afterAll(async () => {
  await t.close()
  await rm(dir, { recursive: true, force: true })
})

describe('GET /files/:id?w=', () => {
  it('serves a cached WebP of the requested width and answers conditional requests', async () => {
    const file = await seed('photo.png', photo, 'image/png')
    const url = `/api/v1/files/${file.id}?v=${file.sha256.slice(0, 16)}&w=160`
    const first = await t.app.inject({ method: 'GET', url })
    expect(first.statusCode).toBe(200)
    expect(first.headers['content-type']).toBe('image/webp')
    expect(first.headers['etag']).toBe(`"${file.sha256}-w160"`)
    expect(first.headers['cache-control']).toBe('private, max-age=31536000, immutable')
    const meta = await sharp(first.rawPayload).metadata()
    expect([meta.format, meta.width, meta.height]).toEqual(['webp', 160, 120])
    expect(await readdir(path.join(dir, 'storage', 'thumbs'))).toEqual([`${file.sha256}-w160.webp`])

    const again = await t.app.inject({ method: 'GET', url })
    expect(again.rawPayload.equals(first.rawPayload)).toBe(true)
    const cached = await t.app.inject({
      method: 'GET',
      url,
      headers: { 'if-none-match': `"${file.sha256}-w160"` },
    })
    expect(cached.statusCode).toBe(304)
    // The original stays available, with its own tag.
    const original = await t.app.inject({ method: 'GET', url: `/api/v1/files/${file.id}` })
    expect(original.headers['content-type']).toBe('image/png')
    expect(original.rawPayload.equals(photo)).toBe(true)
  })

  it('never enlarges, ignores the width for other files and refuses other widths', async () => {
    const tiny = await seed('small.png', small, 'image/png')
    const shrunk = await t.app.inject({ method: 'GET', url: `/api/v1/files/${tiny.id}?w=480` })
    const meta = await sharp(shrunk.rawPayload).metadata()
    expect([meta.format, meta.width, meta.height]).toEqual(['webp', 100, 80])

    const model = await seed('model.glb', Buffer.from('glTF-model'), 'model/gltf-binary')
    const glb = await t.app.inject({ method: 'GET', url: `/api/v1/files/${model.id}?w=160` })
    expect(glb.statusCode).toBe(200)
    expect(glb.headers['content-type']).toBe('model/gltf-binary')
    expect(glb.rawPayload.toString()).toBe('glTF-model')

    const odd = await t.app.inject({ method: 'GET', url: `/api/v1/files/${tiny.id}?w=999` })
    expect(odd.statusCode).toBe(400)
  })
})
