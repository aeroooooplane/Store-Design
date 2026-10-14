import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { schema } from '@store/database'
import type {
  AgentAction,
  AgentMessage,
  AgentReply,
  AgentSession,
  DesignNode,
  NodeCreated,
} from '@store/shared'
import {
  createProject,
  createSpace,
  failUpdateOf,
  getNode,
  seedAsset,
  whiteChain,
} from './fixtures.ts'
import { createTestApp, png } from './helpers.ts'
import type { TestApp } from './helpers.ts'

async function projectWithSpace(t: TestApp) {
  const project = await createProject(t, { name: 'Agent 测试', shopType: 'island' })
  return { projectId: project.id, spaceNode: await createSpace(t, project.id) }
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

  it('undoes in one transaction: a failure on the second node leaves the first one shown', async () => {
    const { project, plan, white } = await whiteChain(t, { projectName: '撤销事务' })
    const session = await newSession(t, project.id)
    // An action that made two nodes, recorded the way the agent service does.
    const db = t.database.db
    const [message] = await db
      .insert(schema.agentMessages)
      .values({ sessionId: session.id, role: 'assistant', content: { text: '已生成' } })
      .returning()
    const [action] = await db
      .insert(schema.agentActions)
      .values({
        messageId: message?.id ?? '',
        toolName: 'generate_plans',
        input: {},
        result: { nodeIds: [plan.id, white.id] },
        status: 'succeeded',
        resultingNodeId: white.id,
      })
      .returning()
    const undo = () =>
      t.app.inject({ method: 'POST', url: `/api/v1/agent/actions/${action?.id}/undo` })
    const undoneAt = async () =>
      (
        await db
          .select()
          .from(schema.agentActions)
          .where(eq(schema.agentActions.id, action?.id ?? ''))
      )[0]?.undoneAt ?? null

    // Hiding the first node succeeds, hiding the second fails.
    const failing = failUpdateOf(t, schema.designNodes, 2)
    try {
      expect((await undo()).statusCode).toBe(500)
    } finally {
      failing.mockRestore()
    }
    expect((await getNode(t, plan.id)).hidden).toBe(false)
    expect((await getNode(t, white.id)).hidden).toBe(false)
    expect(await undoneAt()).toBeNull()

    // A clean undo hides both; undoing again is refused with the same answer as before.
    const undone = await undo()
    expect(undone.statusCode).toBe(200)
    expect(undone.json<AgentAction>().undoneAt).not.toBeNull()
    expect((await getNode(t, plan.id)).hidden).toBe(true)
    expect((await getNode(t, white.id)).hidden).toBe(true)
    const again = await undo()
    expect(again.statusCode).toBe(409)
    expect(again.json().error).toMatchObject({ code: 'INVALID_STATE', message: '该操作已撤销' })
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
    // Against the back wall (z = 0), centred, long side along the wall (the model has no front),
    // kept the planner's 0.3 m off the lease line of an island shop.
    expect(item).toMatchObject({ assetId: 'asset-1', rotation: 90, w: 1.8, d: 1 })
    expect(item?.cx).toBeCloseTo(4, 2)
    expect(item?.cz).toBeCloseTo(0.8, 2)
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
    // Long side along the left wall, 0.3 m inside it (island shop), nothing outside the boundary.
    expect(String(placedTurn?.content)).toContain('"cx_mm":800,"cz_mm":3000')
    expect(String(placedTurn?.content)).toContain('"rotation":0')
    expect(String(placedTurn?.content)).not.toContain('超出')
    expect(reply.currentNodeId).toBe(actions[0]?.resultingNodeId)
  })

  it('edits the space into a new space node and manages views, all undoable', async () => {
    const { projectId, spaceNode } = await projectWithSpace(t)
    const session = await newSession(t, projectId)
    let calls = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        calls += 1
        return calls === 1
          ? toolReply([
              {
                id: 'e',
                function: {
                  name: 'edit_space',
                  arguments:
                    '{"height_mm":3500,"entrance":{"side":"right","width_mm":2000},"add_column":{"cx_mm":2000,"cz_mm":2000,"size_mm":500}}',
                },
              },
            ])
          : textReply('层高改为 3.5 m，入口挪到右墙，加了一根柱子。')
      }),
    )
    const edited = (
      await t.app.inject({
        method: 'POST',
        url: `/api/v1/agent/sessions/${session.id}/messages`,
        payload: { text: '层高 3500，入口放右边 2 米宽，2 米处加根柱子', nodeId: spaceNode.id },
      })
    ).json<AgentReply>()
    const spaceNodeId = edited.currentNodeId
    expect(spaceNodeId).not.toBe(spaceNode.id)
    const node = (
      await t.app.inject({ method: 'GET', url: `/api/v1/nodes/${spaceNodeId}` })
    ).json<DesignNode>()
    expect(node).toMatchObject({
      kind: 'space',
      parentId: spaceNode.id,
      origin: 'agent',
      name: '空间 · Agent',
    })
    expect(node.space?.height).toBe(3.5)
    expect(node.space?.entrances).toEqual([{ kind: 'main', a: [8, 2], b: [8, 4] }])
    expect(node.space?.obstacles).toHaveLength(1)
    expect(node.space?.obstacles[0]?.polygon[0]).toEqual([1.75, 1.75])

    // A white model under a plan under the new space, so views exist.
    const plan = (
      await t.app.inject({
        method: 'POST',
        url: `/api/v1/projects/${projectId}/nodes`,
        payload: {
          parentId: spaceNodeId,
          kind: 'plan',
          name: '方案',
          layout: { schemaVersion: 3, items: [] },
        },
      })
    ).json<NodeCreated>().node
    const white = (
      await t.app.inject({
        method: 'POST',
        url: `/api/v1/projects/${projectId}/nodes`,
        payload: {
          parentId: plan.id,
          kind: 'white',
          name: '白模',
          layout: { schemaVersion: 3, items: [] },
        },
      })
    ).json<NodeCreated>().node
    calls = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        calls += 1
        return calls === 1
          ? toolReply([
              {
                id: 'v',
                function: {
                  name: 'add_view',
                  arguments: '{"name":"收银台方向","across":0.9,"along":1.2,"height":0.4}',
                },
              },
              { id: 'l', function: { name: 'list_views', arguments: '{}' } },
            ])
          : textReply('加了一个视角。')
      }),
    )
    const viewed = (
      await t.app.inject({
        method: 'POST',
        url: `/api/v1/agent/sessions/${session.id}/messages`,
        payload: { text: '从右前方店外加个视角', nodeId: white.id },
      })
    ).json<AgentReply>()
    expect(viewed.currentNodeId).toBe(white.id)
    const actions = (
      await t.app.inject({ method: 'GET', url: `/api/v1/agent/sessions/${session.id}/messages` })
    )
      .json<AgentMessage[]>()
      .flatMap((m) => m.actions)
    const added = actions.find((a) => a.toolName === 'add_view')
    const listed = actions.find((a) => a.toolName === 'list_views')
    expect(added?.status).toBe('succeeded')
    expect(typeof added?.result?.cameraId).toBe('string')
    expect((listed?.result?.views as unknown[]).length).toBe(9)
    const cameras = async () =>
      (await t.app.inject({ method: 'GET', url: `/api/v1/nodes/${white.id}/cameras` })).json<{
        cameras: { id: string; deletedAt: string | null }[]
      }>().cameras
    expect((await cameras()).map((c) => c.id)).toContain(added?.result?.cameraId)

    // Undo removes the view again; the space edit is undone by hiding its node.
    expect(
      (await t.app.inject({ method: 'POST', url: `/api/v1/agent/actions/${added?.id}/undo` }))
        .statusCode,
    ).toBe(200)
    expect((await cameras()).map((c) => c.id)).not.toContain(added?.result?.cameraId)
    const spaceEdit = actions.find((a) => a.toolName === 'edit_space')
    expect(
      (await t.app.inject({ method: 'POST', url: `/api/v1/agent/actions/${spaceEdit?.id}/undo` }))
        .statusCode,
    ).toBe(200)
    expect(
      (
        await t.app.inject({ method: 'GET', url: `/api/v1/nodes/${spaceNodeId}` })
      ).json<DesignNode>().hidden,
    ).toBe(true)
  })

  it('keeps a screenshot with the message but shows it only to a vision model', async () => {
    const { projectId, spaceNode } = await projectWithSpace(t)
    const session = await newSession(t, projectId)
    const bodies: { messages: { role: string; content: unknown }[] }[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: { body: string }) => {
        bodies.push(JSON.parse(init.body) as (typeof bodies)[number])
        return textReply('看不了图，但布局我知道。')
      }),
    )
    const response = await t.app.inject({
      method: 'POST',
      url: `/api/v1/agent/sessions/${session.id}/messages`,
      payload: { text: '看看这张图', nodeId: spaceNode.id, planPng: png(4, 4).toString('base64') },
    })
    expect(response.statusCode).toBe(200)
    const reply = response.json<AgentReply>()
    expect(reply.userMessage.imageUrl).toMatch(/^\/api\/v1\/files\//)
    const last = bodies[0]?.messages.at(-1)
    expect(last?.content).toBe('看看这张图')
  })

  it('switches the SI style and saves the plan with its props swapped', async () => {
    // The two 1.2 m cabinets of SI_SWAP, sharing the seeded model file.
    const [file] = await t.database.db.select().from(schema.storedFiles).limit(1)
    for (const [id, siFamily, depth] of [
      ['asset-2595882', 'SI1.0', 0.45],
      ['asset-34327615', 'SI2.0', 0.54],
    ] as const) {
      await seedAsset(t, {
        id,
        name: '1.2米配件柜',
        variant: siFamily,
        si: siFamily,
        fn: 'accessory_cabinet',
        w: 1.2,
        d: depth,
        h: 2.4,
        front: '+Z',
        glbFileId: file?.id,
      })
    }
    const { projectId, spaceNode } = await projectWithSpace(t)
    const plan = (
      await t.app.inject({
        method: 'POST',
        url: `/api/v1/projects/${projectId}/nodes`,
        payload: {
          parentId: spaceNode.id,
          kind: 'plan',
          name: '方案 A',
          layout: {
            schemaVersion: 3,
            items: [
              {
                id: 'c1',
                assetId: 'asset-2595882',
                function: 'accessory_cabinet',
                name: '1.2米配件柜',
                cx: 2,
                cz: 0.225,
                rotation: 0,
                w: 1.2,
                d: 0.45,
                h: 2.4,
              },
            ],
          },
        },
      })
    ).json<NodeCreated>().node
    const session = await newSession(t, projectId)
    let calls = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        calls += 1
        return calls === 1
          ? toolReply([
              { id: 's', function: { name: 'set_style', arguments: '{"siStyle":"SI2.0"}' } },
            ])
          : textReply('已切换为 SI2.0。')
      }),
    )
    const reply = (
      await t.app.inject({
        method: 'POST',
        url: `/api/v1/agent/sessions/${session.id}/messages`,
        payload: { text: '换成 SI2.0', nodeId: plan.id },
      })
    ).json<AgentReply>()
    expect(reply.currentNodeId).not.toBe(plan.id)
    const copy = (
      await t.app.inject({ method: 'GET', url: `/api/v1/nodes/${reply.currentNodeId}` })
    ).json<DesignNode>()
    expect(copy).toMatchObject({
      kind: 'plan',
      parentId: spaceNode.id,
      name: '方案 A · SI2.0',
      origin: 'agent',
    })
    expect(copy.layout?.items[0]).toMatchObject({ assetId: 'asset-34327615', cx: 2, cz: 0.27 })
    const project = (
      await t.app.inject({ method: 'GET', url: `/api/v1/projects/${projectId}` })
    ).json<{ siStyle: string }>()
    expect(project.siStyle).toBe('SI2.0')
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
