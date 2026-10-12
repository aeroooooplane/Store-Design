import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { AiOverview, AiSettings } from '@store/shared'
import { beijingDay, budgetStatus, recordUsage } from '../src/ai/budget.ts'
import { chat } from '../src/ai/chat.ts'
import { costCny, findModel } from '../src/ai/models.ts'
import { loadConfig } from '../src/config/env.ts'
import { createTestApp } from './helpers.ts'
import type { TestApp } from './helpers.ts'

const WITH_KEYS = {
  DEEPSEEK_API_KEY: 'sk-test-deepseek',
  DASHSCOPE_API_KEY: 'sk-test-dashscope',
  AI_DAILY_BUDGET_CNY: '1',
}

describe('beijingDay', () => {
  it('rolls over at 00:00 Beijing time, not UTC', () => {
    expect(beijingDay(new Date('2026-10-11T15:59:00Z'))).toBe('2026-10-11')
    expect(beijingDay(new Date('2026-10-11T16:00:00Z'))).toBe('2026-10-12')
  })
})

describe('costCny', () => {
  it('prices by the million tokens and rounds up to 0.0001', () => {
    const spec = findModel('qwen3-vl-flash')
    if (!spec) throw new Error('missing model')
    // 1000 in × 0.3 + 500 out × 3 per million = 0.0003 + 0.0015
    expect(costCny(spec, 1000, 500)).toBe(0.0018)
    expect(costCny(spec, 1, 1)).toBe(0.0001)
    const local = findModel('local')
    if (!local) throw new Error('missing local')
    expect(costCny(local, 100000, 100000)).toBe(0)
  })
})

describe('AI without any key', () => {
  let t: TestApp
  beforeAll(async () => {
    t = await createTestApp()
  })
  afterAll(async () => {
    await t.close()
  })

  it('lists only local recognition and has no agent model', async () => {
    const response = await t.app.inject({ method: 'GET', url: '/api/v1/ai' })
    expect(response.statusCode).toBe(200)
    const overview = response.json<AiOverview>()
    expect(overview.models.map((m) => m.id)).toEqual(['local'])
    expect(overview.settings).toEqual({
      agentModel: null,
      recognitionModel: 'local',
      recognitionFallback: null,
    })
    expect(overview.budget).toMatchObject({ limitCny: 50, spentCny: 0, exceeded: false })
  })

  it('refuses a model whose key is missing', async () => {
    const response = await t.app.inject({
      method: 'PATCH',
      url: '/api/v1/ai/settings',
      payload: { agentModel: 'deepseek-flash' },
    })
    expect(response.statusCode).toBe(400)
    expect(response.json().error.message).toContain('未配置密钥')
  })
})

describe('AI with domestic keys', () => {
  let t: TestApp
  beforeAll(async () => {
    t = await createTestApp(WITH_KEYS)
  })
  afterAll(async () => {
    await t.close()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('lists domestic models, hides overseas ones, and picks defaults', async () => {
    const overview = (await t.app.inject({ method: 'GET', url: '/api/v1/ai' })).json<AiOverview>()
    expect(overview.models.map((m) => m.id)).toEqual([
      'local',
      'deepseek-flash',
      'qwen3-vl-plus',
      'qwen3-vl-flash',
    ])
    expect(overview.models.every((m) => !m.overseas)).toBe(true)
    expect(overview.settings).toEqual({
      agentModel: 'deepseek-flash',
      recognitionModel: 'local',
      recognitionFallback: 'qwen3-vl-plus',
    })
  })

  it('saves choices and checks what each model can do', async () => {
    const saved = await t.app.inject({
      method: 'PATCH',
      url: '/api/v1/ai/settings',
      payload: { agentModel: 'qwen3-vl-flash', recognitionFallback: 'qwen3-vl-flash' },
    })
    expect(saved.statusCode).toBe(200)
    expect(saved.json<AiSettings>()).toEqual({
      agentModel: 'qwen3-vl-flash',
      recognitionModel: 'local',
      recognitionFallback: 'qwen3-vl-flash',
    })

    const notVision = await t.app.inject({
      method: 'PATCH',
      url: '/api/v1/ai/settings',
      payload: { recognitionFallback: 'deepseek-flash' },
    })
    expect(notVision.statusCode).toBe(400)
    expect(notVision.json().error.message).toContain('不能作为兜底')

    const same = await t.app.inject({
      method: 'PATCH',
      url: '/api/v1/ai/settings',
      payload: { recognitionModel: 'qwen3-vl-flash' },
    })
    expect(same.statusCode).toBe(400)
    expect(same.json().error.message).toContain('不能与平面识别模型相同')

    const empty = await t.app.inject({ method: 'PATCH', url: '/api/v1/ai/settings', payload: {} })
    expect(empty.statusCode).toBe(400)
  })

  it('books every call and stops at the daily limit', async () => {
    const config = loadConfig({ NODE_ENV: 'test', ...WITH_KEYS })
    const db = t.database.db
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: { body: string }) => {
        expect(url).toBe('https://api.deepseek.com/chat/completions')
        const body = JSON.parse(init.body) as { model: string; messages: unknown[] }
        expect(body.model).toBe('deepseek-flash')
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: '{"ok":true}' } }],
            usage: { prompt_tokens: 100_000, completion_tokens: 50_000 },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      }),
    )
    const result = await chat(db, config, {
      purpose: 'agent',
      modelId: 'deepseek-flash',
      messages: [{ role: 'user', content: '你好' }],
      json: true,
    })
    // 100k × 2 + 50k × 8 per million = 0.2 + 0.4
    expect(result).toMatchObject({ text: '{"ok":true}', costCny: 0.6, model: 'deepseek-flash' })
    expect(await budgetStatus(db, 1)).toMatchObject({ spentCny: 0.6, remainingCny: 0.4 })

    await recordUsage(db, {
      purpose: 'recognition',
      provider: 'dashscope',
      model: 'qwen3-vl-plus',
      tokensIn: 1,
      tokensOut: 1,
      costCny: 0.5,
    })
    const budget = (await t.app.inject({ method: 'GET', url: '/api/v1/ai/budget' })).json()
    expect(budget).toMatchObject({ limitCny: 1, spentCny: 1.1, remainingCny: 0, exceeded: true })

    await expect(
      chat(db, config, {
        purpose: 'agent',
        modelId: 'deepseek-flash',
        messages: [{ role: 'user', content: '再来' }],
      }),
    ).rejects.toMatchObject({ code: 'BUDGET_EXCEEDED', statusCode: 402 })
  })

  it('turns a vendor failure into UPSTREAM_FAILED without booking anything', async () => {
    const config = loadConfig({ NODE_ENV: 'test', ...WITH_KEYS, AI_DAILY_BUDGET_CNY: '100' })
    const db = t.database.db
    const before = (await budgetStatus(db, 100)).spentCny
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{"error":"rate limited"}', { status: 429 })),
    )
    await expect(
      chat(db, config, {
        purpose: 'recognition',
        modelId: 'qwen3-vl-flash',
        messages: [
          { role: 'user', content: '看图', images: [{ mediaType: 'image/png', base64: 'AAAA' }] },
        ],
      }),
    ).rejects.toMatchObject({ code: 'UPSTREAM_FAILED', statusCode: 502 })
    expect((await budgetStatus(db, 100)).spentCny).toBe(before)

    // A model that cannot see pictures is refused before any request goes out.
    await expect(
      chat(db, config, {
        purpose: 'recognition',
        modelId: 'deepseek-flash',
        messages: [
          { role: 'user', content: '看图', images: [{ mediaType: 'image/png', base64: 'AAAA' }] },
        ],
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' })
  })
})
