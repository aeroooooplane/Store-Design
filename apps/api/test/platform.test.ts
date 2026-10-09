import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { loadConfig } from '../src/config/env.ts'
import { createTestApp } from './helpers.ts'
import type { TestApp } from './helpers.ts'

let t: TestApp

beforeAll(async () => {
  t = await createTestApp()
})

afterAll(async () => {
  await t.close()
})

describe('health', () => {
  it('reports the database as reachable', async () => {
    const response = await t.app.inject({ method: 'GET', url: '/api/v1/health' })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ status: 'ok', database: 'ok' })
  })
})

describe('cross-cutting behaviour', () => {
  it('answers unknown routes with the standard error body', async () => {
    const response = await t.app.inject({ method: 'GET', url: '/api/v1/nope' })
    expect(response.statusCode).toBe(404)
    expect(response.json()).toEqual({
      error: { code: 'NOT_FOUND', message: '接口不存在', requestId: expect.any(String) },
    })
  })

  it('echoes a safe x-request-id and replaces an unsafe one', async () => {
    const kept = await t.app.inject({
      method: 'GET',
      url: '/api/v1/health',
      headers: { 'x-request-id': 'trace-12345678' },
    })
    expect(kept.headers['x-request-id']).toBe('trace-12345678')
    const replaced = await t.app.inject({
      method: 'GET',
      url: '/api/v1/health',
      headers: { 'x-request-id': '<script>' },
    })
    expect(replaced.headers['x-request-id']).not.toBe('<script>')
  })

  it('sets security headers and only allows the configured web origin', async () => {
    const allowed = await t.app.inject({
      method: 'GET',
      url: '/api/v1/health',
      headers: { origin: 'http://127.0.0.1:5173' },
    })
    expect(allowed.headers['x-content-type-options']).toBe('nosniff')
    expect(allowed.headers['access-control-allow-origin']).toBe('http://127.0.0.1:5173')
    const foreign = await t.app.inject({
      method: 'GET',
      url: '/api/v1/health',
      headers: { origin: 'https://evil.example' },
    })
    expect(foreign.headers['access-control-allow-origin']).toBeUndefined()
  })

  it('rejects malformed JSON and oversized bodies with stable codes', async () => {
    const malformed = await t.app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      headers: { 'content-type': 'application/json' },
      payload: '{"name":',
    })
    expect(malformed.statusCode).toBe(400)
    expect(malformed.json().error.code).toBe('VALIDATION_FAILED')

    const oversized = await t.app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ name: 'x'.repeat(6 * 1024 * 1024), shopType: 'zone' }),
    })
    expect(oversized.statusCode).toBe(413)
    expect(oversized.json().error.code).toBe('PAYLOAD_TOO_LARGE')
  })

  it('serves the OpenAPI document and the docs page', async () => {
    const spec = t.app.swagger() as { paths: Record<string, unknown> }
    expect(Object.keys(spec.paths)).toEqual(
      expect.arrayContaining(['/api/v1/projects', '/api/v1/projects/{projectId}']),
    )
    const docs = await t.app.inject({ method: 'GET', url: '/api/docs/' })
    expect(docs.statusCode).toBe(200)
  })
})

describe('rate limiting', () => {
  it('returns RATE_LIMITED once the per-minute budget is used up', async () => {
    const limited = await createTestApp({ RATE_LIMIT_MAX: '2' })
    try {
      const statuses: number[] = []
      for (let i = 0; i < 3; i++) {
        statuses.push(
          (await limited.app.inject({ method: 'GET', url: '/api/v1/health' })).statusCode,
        )
      }
      expect(statuses).toEqual([200, 200, 429])
      const blocked = await limited.app.inject({ method: 'GET', url: '/api/v1/health' })
      expect(blocked.json().error.code).toBe('RATE_LIMITED')
    } finally {
      await limited.close()
    }
  })
})

describe('configuration', () => {
  it('rejects invalid values without echoing them', () => {
    expect(() => loadConfig({ API_PORT: 'abc', DEEPSEEK_API_KEY: 'sk-secret' })).toThrow(/API_PORT/)
    try {
      loadConfig({ API_PORT: 'abc', DEEPSEEK_API_KEY: 'sk-secret' })
    } catch (error) {
      expect(String(error)).not.toContain('sk-secret')
    }
  })

  it('treats empty keys as unset and parses flags', () => {
    const config = loadConfig({ DEEPSEEK_API_KEY: '', ENABLE_OVERSEAS_MODELS: 'true' })
    expect(config.ai.deepseekApiKey).toBeUndefined()
    expect(config.ai.enableOverseasModels).toBe(true)
  })
})
