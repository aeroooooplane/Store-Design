import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { schema } from '@store/database'
import type { Project } from '@store/shared'
import { createTestApp } from './helpers.ts'
import type { TestApp } from './helpers.ts'

let t: TestApp

beforeAll(async () => {
  t = await createTestApp()
})

afterAll(async () => {
  await t.close()
})

async function create(body: Record<string, unknown>): Promise<Project> {
  const response = await t.app.inject({ method: 'POST', url: '/api/v1/projects', payload: body })
  expect(response.statusCode).toBe(201)
  return response.json()
}

function write(
  method: 'PATCH' | 'DELETE' | 'POST',
  url: string,
  revision?: number,
  payload?: object,
) {
  return t.app.inject({
    method,
    url,
    payload,
    headers: revision === undefined ? {} : { 'if-match': `"${revision}"` },
  })
}

describe('POST /projects', () => {
  it('creates a project with defaults and returns its revision as ETag', async () => {
    const response = await t.app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      payload: { name: ' 南京德基 ', shopType: 'side_hall' },
    })
    expect(response.statusCode).toBe(201)
    expect(response.headers.etag).toBe('"1"')
    expect(response.json()).toMatchObject({
      name: '南京德基',
      shopType: 'side_hall',
      market: 'domestic',
      siStyle: 'SI1.0',
      revision: 1,
      deletedAt: null,
    })
  })

  it('explains validation failures field by field', async () => {
    const response = await t.app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      payload: { name: '', shopType: 'flagship' },
    })
    expect(response.statusCode).toBe(400)
    const { error } = response.json()
    expect(error.code).toBe('VALIDATION_FAILED')
    expect(error.requestId).toEqual(expect.any(String))
    expect(error.details.map((d: { path: string }) => d.path).sort()).toEqual([
      '/name',
      '/shopType',
    ])
  })

  it('rejects unknown fields such as a client-supplied owner', async () => {
    const response = await t.app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      payload: { name: 'A', shopType: 'zone', ownerId: 'someone' },
    })
    expect(response.statusCode).toBe(400)
  })
})

describe('GET /projects', () => {
  it('pages, searches literally and separates the recycle bin', async () => {
    const tag = `检索-${Date.now()}`
    const first = await create({ name: `${tag} 100%`, shopType: 'island' })
    await create({ name: `${tag} 普通`, shopType: 'island' })
    await write('DELETE', `/api/v1/projects/${first.id}`, 1)

    const active = await t.app.inject({
      method: 'GET',
      url: `/api/v1/projects?q=${encodeURIComponent(tag)}`,
    })
    expect(active.json()).toMatchObject({ total: 1, page: 1, pageSize: 20 })

    const literal = await t.app.inject({
      method: 'GET',
      url: `/api/v1/projects?status=all&q=${encodeURIComponent('100%')}`,
    })
    expect(literal.json().items.map((p: Project) => p.id)).toEqual([first.id])

    const bin = await t.app.inject({
      method: 'GET',
      url: '/api/v1/projects?status=deleted&pageSize=1',
    })
    expect(bin.json().items).toHaveLength(1)
    expect(bin.json().items[0].deletedAt).not.toBeNull()
  })

  it('rejects out-of-range paging parameters', async () => {
    const response = await t.app.inject({ method: 'GET', url: '/api/v1/projects?pageSize=1000' })
    expect(response.statusCode).toBe(400)
    expect(response.json().error.message).toBe('查询参数校验失败')
  })
})

describe('GET /projects/:id', () => {
  it('returns 404 for unknown ids and 400 for malformed ids', async () => {
    const missing = await t.app.inject({
      method: 'GET',
      url: '/api/v1/projects/00000000-0000-4000-8000-000000000000',
    })
    expect(missing.statusCode).toBe(404)
    expect(missing.json().error.code).toBe('NOT_FOUND')
    const malformed = await t.app.inject({ method: 'GET', url: '/api/v1/projects/not-a-uuid' })
    expect(malformed.statusCode).toBe(400)
  })
})

describe('optimistic locking', () => {
  it('requires If-Match, rejects stale revisions and bumps the revision on success', async () => {
    const project = await create({ name: '锁', shopType: 'zone' })
    const url = `/api/v1/projects/${project.id}`

    const missing = await write('PATCH', url, undefined, { siStyle: 'SI2.0' })
    expect(missing.statusCode).toBe(428)
    expect(missing.json().error.code).toBe('REVISION_REQUIRED')

    const updated = await write('PATCH', url, 1, { siStyle: 'SI2.0' })
    expect(updated.statusCode).toBe(200)
    expect(updated.headers.etag).toBe('"2"')
    expect(updated.json()).toMatchObject({ siStyle: 'SI2.0', revision: 2 })

    const stale = await write('PATCH', url, 1, { name: '旧窗口' })
    expect(stale.statusCode).toBe(409)
    expect(stale.json().error).toMatchObject({
      code: 'REVISION_CONFLICT',
      details: { currentRevision: 2 },
    })
  })

  it('accepts weak and unquoted ETags but rejects garbage', async () => {
    const project = await create({ name: 'ETag', shopType: 'zone' })
    const url = `/api/v1/projects/${project.id}`
    const weak = await t.app.inject({
      method: 'PATCH',
      url,
      payload: { name: '弱 ETag' },
      headers: { 'if-match': 'W/"1"' },
    })
    expect(weak.statusCode).toBe(200)
    const garbage = await t.app.inject({
      method: 'PATCH',
      url,
      payload: { name: 'x' },
      headers: { 'if-match': 'abc' },
    })
    expect(garbage.statusCode).toBe(400)
  })
})

describe('recycle bin', () => {
  it('soft-deletes, blocks edits while deleted, restores and audits both actions', async () => {
    const project = await create({ name: '回收站', shopType: 'island' })
    const url = `/api/v1/projects/${project.id}`

    const deleted = await write('DELETE', url, 1)
    expect(deleted.statusCode).toBe(200)
    expect(deleted.json().deletedAt).not.toBeNull()

    const edit = await write('PATCH', url, 2, { name: '改名' })
    expect(edit.statusCode).toBe(409)
    expect(edit.json().error.code).toBe('INVALID_STATE')

    const deletedTwice = await write('DELETE', url, 2)
    expect(deletedTwice.json().error.code).toBe('INVALID_STATE')

    const restored = await write('POST', `${url}/restore`, 2)
    expect(restored.statusCode).toBe(200)
    expect(restored.json()).toMatchObject({ deletedAt: null, revision: 3 })

    const events = await t.database.db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.entityId, project.id))
    expect(events.map((e) => e.action).sort()).toEqual(['create', 'delete', 'restore'])
    expect(events.every((e) => e.actorKind === 'visitor' && e.requestId)).toBe(true)
  })
})
