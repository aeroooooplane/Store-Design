import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { schema } from '@store/database'
import { rectangleSpace } from '@store/shared'
import type {
  AgentAction,
  AgentMessage,
  AgentReply,
  AgentSession,
  DesignNode,
  NodeCreated,
} from '@store/shared'
import { createTestApp } from './helpers.ts'
import type { TestApp } from './helpers.ts'

/** One placeable catalogue model: a 1.0 × 1.8 m island table. */
async function seedAsset(t: TestApp) {
  const [file] = await t.database.db
    .insert(schema.storedFiles)
    .values({
      root: 'resource',
      storageKey: 'models/asset-1.glb',
      kind: 'glb',
      contentType: 'model/gltf-binary',
      bytes: 1,
      sha256: 'a'.repeat(64),
    })
    .returning()
  await t.database.db.insert(schema.assets).values({
    id: 'asset-1',
    standardName: '1800mm普通中岛桌',
    variant: 'A',
    materialCategory: '软装物料',
    siFamily: 'SI1.0',
    function: 'island_table',
    installation: 'floor',
    width: 1,
    depth: 1.8,
    height: 1.327,
    footprintSource: 'glb',
    front: 'any',
    placeable: true,
    glbFileId: file?.id,
  })
}

async function projectWithSpace(t: TestApp) {
  const project = await t.app.inject({
    method: 'POST',
    url: '/api/v1/projects',
    payload: { name: 'Agent 测试', shopType: 'island' },
  })
  const { id } = project.json<{ id: string }>()
  const space = await t.app.inject({
    method: 'POST',
    url: `/api/v1/projects/${id}/nodes`,
    payload: { parentId: null, kind: 'space', name: '空间', space: rectangleSpace(8, 6, 3.2) },
  })
  expect(space.statusCode).toBe(201)
  return { projectId: id, spaceNode: space.json<NodeCreated>().node }
}

async function newSession(t: TestApp, projectId: string): Promise<AgentSession> {
  const response = await t.app.inject({
    method: 'POST',
    url: `/api/v1/projects/${projectId}/agent/sessions`,
    payload: {},
  })
  expect(response.statusCode).toBe(201)
  return response.json<AgentSession>()
}

type Call = { id: string; function: { name: string; arguments: string } }
const toolReply = (calls: Call[]) =>
  new Response(
    JSON.stringify({
      choices: [
        { message: { content: null, tool_calls: calls.map((c) => ({ type: 'function', ...c })) } },
      ],
      usage: { prompt_tokens: 1000, completion_tokens: 50 },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  )
const textReply = (text: string) =>
  new Response(
    JSON.stringify({
      choices: [{ message: { content: text } }],
      usage: { prompt_tokens: 1000, completion_tokens: 20 },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  )

describe('agent without a model', () => {
  let t: TestApp
  beforeAll(async () => {
    t = await createTestApp()
  })
  afterAll(async () => {
    await t.close()
  })

  it('keeps sessions but refuses to chat until a model is configured', async () => {
    const { projectId } = await projectWithSpace(t)
    const session = await newSession(t, projectId)
    expect(session.title).toBe('新对话')
    const list = await t.app.inject({
      method: 'GET',
      url: `/api/v1/projects/${projectId}/agent/sessions`,
    })
    expect(list.json<AgentSession[]>().map((s) => s.id)).toEqual([session.id])

    const response = await t.app.inject({
      method: 'POST',
      url: `/api/v1/agent/sessions/${session.id}/messages`,
      payload: { text: '帮我放一张中岛桌' },
    })
    expect(response.statusCode).toBe(400)
    expect(response.json().error.message).toContain('Agent 模型')
  })
})

describe('agent with DeepSeek', () => {
  let t: TestApp
  beforeAll(async () => {
    t = await createTestApp({ DEEPSEEK_API_KEY: 'sk-test-deepseek', AI_DAILY_BUDGET_CNY: '50' })
    await seedAsset(t)
  })
  afterAll(async () => {
    await t.close()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('answers through tools, makes a node per change and can undo it', async () => {
    const { projectId, spaceNode } = await projectWithSpace(t)
    const session = await newSession(t, projectId)
    const bodies: {
      messages: { role: string; tool_call_id?: string; content: unknown }[]
      tools?: unknown[]
    }[] = []
    const fetchMock = vi.fn(async (_url: string, init: { body: string }) => {
      const body = JSON.parse(init.body) as (typeof bodies)[number]
      bodies.push(body)
      switch (bodies.length) {
        case 1:
          return toolReply([
            {
              id: 'call_1',
              function: { name: 'list_models', arguments: '{"function":"island_table"}' },
            },
          ])
        case 2:
          return toolReply([
            {
              id: 'call_2',
              function: { name: 'place_item', arguments: '{"modelId":"asset-1","along":"back"}' },
            },
          ])
        default:
          return textReply('已在后墙中间放了一张 1800 中岛桌。')
      }
    })
    vi.stubGlobal('fetch', fetchMock)

    const response = await t.app.inject({
      method: 'POST',
      url: `/api/v1/agent/sessions/${session.id}/messages`,
      payload: { text: '在后墙放一张中岛桌', nodeId: spaceNode.id },
    })
    expect(response.statusCode).toBe(200)
    const reply = response.json<AgentReply>()
    expect(fetchMock).toHaveBeenCalledTimes(3)
    // The model is offered the tools and sees the project state up front.
    expect(bodies[0]?.tools?.length).toBeGreaterThan(5)
    expect(String(bodies[0]?.messages[1]?.content)).toContain('"area_m2":48')
    // The tool result goes back under its call id.
    const toolTurn = bodies[1]?.messages.find((m) => m.role === 'tool')
    expect(toolTurn?.tool_call_id).toBe('call_1')
    expect(String(toolTurn?.content)).toContain('asset-1')

    expect(reply.userMessage.content).toMatchObject({
      text: '在后墙放一张中岛桌',
      nodeId: spaceNode.id,
    })
    expect(reply.reply.content.text).toContain('中岛桌')
    expect(reply.reply.model).toBe('deepseek-flash')
    expect(reply.currentNodeId).not.toBeNull()
    expect(reply.currentNodeId).not.toBe(spaceNode.id)

    const messages = (
      await t.app.inject({ method: 'GET', url: `/api/v1/agent/sessions/${session.id}/messages` })
    ).json<AgentMessage[]>()
    expect(messages.map((m) => m.role)).toEqual([
      'user',
      'assistant',
      'tool',
      'assistant',
      'tool',
      'assistant',
    ])
    const actions = messages.flatMap((m) => m.actions)
    expect(actions.map((a) => [a.toolName, a.status])).toEqual([
      ['list_models', 'succeeded'],
      ['place_item', 'succeeded'],
    ])
    const placed = actions[1]
    expect(placed?.resultingNodeId).toBe(reply.currentNodeId)

    const node = (
      await t.app.inject({ method: 'GET', url: `/api/v1/nodes/${reply.currentNodeId}` })
    ).json<DesignNode>()
    expect(node).toMatchObject({
      kind: 'plan',
      parentId: spaceNode.id,
      origin: 'agent',
      name: '方案 · Agent',
    })
    expect(node.layout?.items).toHaveLength(1)
    const item = node.layout?.items[0]
    // Against the back wall (z = 0), centred, long side along the wall (the model has no front).
    expect(item).toMatchObject({ assetId: 'asset-1', rotation: 90, w: 1.8, d: 1 })
    expect(item?.cx).toBeCloseTo(4, 2)
    expect(item?.cz).toBeCloseTo(0.52, 2)
    // The session took its title from the first message and booked the spend.
    const sessions = (
      await t.app.inject({ method: 'GET', url: `/api/v1/projects/${projectId}/agent/sessions` })
    ).json<AgentSession[]>()
    expect(sessions[0]?.title).toBe('在后墙放一张中岛桌')
    expect(messages.filter((m) => m.role === 'assistant').every((m) => m.costCny > 0)).toBe(true)

    // Undo hides the node; a second undo and undoing a read-only call are refused.
    const undone = await t.app.inject({
      method: 'POST',
      url: `/api/v1/agent/actions/${placed?.id}/undo`,
    })
    expect(undone.statusCode).toBe(200)
    expect(undone.json<AgentAction>().undoneAt).not.toBeNull()
    const hidden = (
      await t.app.inject({ method: 'GET', url: `/api/v1/nodes/${reply.currentNodeId}` })
    ).json<DesignNode>()
    expect(hidden.hidden).toBe(true)
    expect(
      (await t.app.inject({ method: 'POST', url: `/api/v1/agent/actions/${placed?.id}/undo` }))
        .statusCode,
    ).toBe(409)
    expect(
      (await t.app.inject({ method: 'POST', url: `/api/v1/agent/actions/${actions[0]?.id}/undo` }))
        .statusCode,
    ).toBe(409)
  })

  it('continues from the node it just made and reports a failed tool to the model', async () => {
    const { projectId, spaceNode } = await projectWithSpace(t)
    const session = await newSession(t, projectId)
    const bodies: { messages: { role: string; content: unknown }[] }[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: { body: string }) => {
        bodies.push(JSON.parse(init.body) as (typeof bodies)[number])
        switch (bodies.length) {
          case 1:
            return toolReply([
              {
                id: 'a',
                function: { name: 'place_item', arguments: '{"modelId":"asset-1","along":"left"}' },
              },
              {
                id: 'b',
                function: {
                  name: 'place_item',
                  arguments: '{"modelId":"asset-9","along":"right"}',
                },
              },
            ])
          case 2:
            return toolReply([
              {
                id: 'c',
                function: { name: 'rotate_item', arguments: '{"itemId":"nope","rotation":90}' },
              },
            ])
          default:
            return textReply('放了一张，另一个模型不存在。')
        }
      }),
    )
    const response = await t.app.inject({
      method: 'POST',
      url: `/api/v1/agent/sessions/${session.id}/messages`,
      payload: { text: '左右各放一张桌子', nodeId: spaceNode.id },
    })
    expect(response.statusCode).toBe(200)
    const reply = response.json<AgentReply>()
    const messages = (
      await t.app.inject({ method: 'GET', url: `/api/v1/agent/sessions/${session.id}/messages` })
    ).json<AgentMessage[]>()
    const actions = messages.flatMap((m) => m.actions)
    expect(actions.map((a) => a.status)).toEqual(['succeeded', 'failed', 'failed'])
    expect(String(actions[1]?.result?.error)).toContain('asset-9')
    expect(String(actions[2]?.result?.error)).toContain('nope')
    // The second round saw the item the first round placed (the state moved on).
    const placedTurn = bodies[1]?.messages.find((m) => m.role === 'tool')
    // Long side along the left wall, just inside it, nothing outside the boundary.
    expect(String(placedTurn?.content)).toContain('"cx_mm":520,"cz_mm":3000')
    expect(String(placedTurn?.content)).toContain('"rotation":0')
    expect(String(placedTurn?.content)).not.toContain('超出')
    expect(reply.currentNodeId).toBe(actions[0]?.resultingNodeId)
  })

  it('keeps the user message when the model fails', async () => {
    const { projectId, spaceNode } = await projectWithSpace(t)
    const session = await newSession(t, projectId)
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{"error":"down"}', { status: 500 })),
    )
    const response = await t.app.inject({
      method: 'POST',
      url: `/api/v1/agent/sessions/${session.id}/messages`,
      payload: { text: '你好', nodeId: spaceNode.id },
    })
    expect(response.statusCode).toBe(502)
    const messages = (
      await t.app.inject({ method: 'GET', url: `/api/v1/agent/sessions/${session.id}/messages` })
    ).json<AgentMessage[]>()
    expect(messages.map((m) => m.role)).toEqual(['user'])
  })
})
