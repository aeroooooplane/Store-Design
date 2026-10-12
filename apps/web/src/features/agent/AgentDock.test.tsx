import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentAction, AgentMessage, AgentSession } from '@store/shared'
import { AgentDock, AgentSelectionProvider } from './AgentDock.tsx'

const PID = '11111111-1111-4111-8111-111111111111'
const S1 = '22222222-2222-4222-8222-222222222222'
const NEW = '33333333-3333-4333-8333-333333333333'
const SID = '44444444-4444-4444-8444-444444444444'
const AID = '55555555-5555-4555-8555-555555555555'
const AT = '2026-10-12T04:00:00.000Z'

interface Call {
  method: string
  path: string
  body: unknown
}

/** In-memory stand-in for the AI overview and agent APIs. */
function fakeApi(agentModel: string | null) {
  const state = { sessions: [] as AgentSession[], messages: [] as AgentMessage[] }
  const calls: Call[] = []
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
  const message = (
    role: AgentMessage['role'],
    text: string,
    actions: AgentAction[] = [],
  ): AgentMessage => ({
    id: crypto.randomUUID(),
    sessionId: SID,
    role,
    content: { text },
    imageUrl: null,
    model: role === 'assistant' ? 'deepseek-flash' : null,
    tokensIn: 0,
    tokensOut: 0,
    costCny: 0,
    createdAt: AT,
    actions,
  })

  const fetchMock = vi.fn(async (request: Request) => {
    const url = new URL(request.url)
    const text = request.method === 'GET' ? '' : await request.text()
    const body: unknown = text ? JSON.parse(text) : undefined
    calls.push({ method: request.method, path: url.pathname, body })
    const route = `${request.method} ${url.pathname}`

    if (route === 'GET /api/v1/ai') {
      return json(200, {
        models: agentModel
          ? [
              {
                id: agentModel,
                label: 'DeepSeek Flash',
                provider: 'deepseek',
                purposes: ['agent'],
                vision: false,
                overseas: false,
                price: { inputCny: 2, outputCny: 8 },
              },
            ]
          : [],
        settings: { agentModel, recognitionModel: 'local', recognitionFallback: null },
        budget: { day: '2026-10-12', limitCny: 50, spentCny: 0, remainingCny: 50, exceeded: false },
      })
    }
    if (route === `GET /api/v1/projects/${PID}/agent/sessions`) return json(200, state.sessions)
    if (route === `POST /api/v1/projects/${PID}/agent/sessions`) {
      const session = { id: SID, projectId: PID, title: '新对话', createdAt: AT, updatedAt: AT }
      state.sessions.unshift(session)
      return json(201, session)
    }
    if (route === `GET /api/v1/agent/sessions/${SID}/messages`) return json(200, state.messages)
    if (route === `POST /api/v1/agent/sessions/${SID}/messages`) {
      const { text: said } = body as { text: string }
      const user = message('user', said)
      const action: AgentAction = {
        id: AID,
        messageId: '77777777-7777-4777-8777-777777777777',
        toolName: 'place_item',
        input: { modelId: 'asset-1', along: 'back' },
        result: { done: '已放入「中岛桌」', nodeId: NEW },
        status: 'succeeded',
        resultingNodeId: NEW,
        undoneAt: null,
        createdAt: AT,
      }
      const reply = message('assistant', '已在后墙放了一张中岛桌。', [action])
      state.messages.push(user, reply)
      return json(200, { userMessage: user, reply, currentNodeId: NEW })
    }
    if (route === `POST /api/v1/agent/actions/${AID}/undo`) {
      for (const m of state.messages) {
        for (const a of m.actions) if (a.id === AID) a.undoneAt = AT
      }
      const undone = state.messages.flatMap((m) => m.actions).find((a) => a.id === AID)
      return json(200, undone)
    }
    if (route === `GET /api/v1/projects/${PID}/nodes`)
      return json(200, { projectId: PID, nodes: [] })
    return json(404, { error: { code: 'NOT_FOUND', message: route, requestId: 'r' } })
  })
  return { fetchMock, calls, state }
}

function mount(onSelect: (id: string) => void) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <AgentSelectionProvider>
          <AgentDock projectId={PID} nodeId={S1} onSelect={onSelect} />
        </AgentSelectionProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('AgentDock', () => {
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('starts a conversation on the first message, shows the actions and undoes one', async () => {
    const { fetchMock, calls } = fakeApi('deepseek-flash')
    vi.stubGlobal('fetch', fetchMock)
    const onSelect = vi.fn()
    mount(onSelect)

    fireEvent.click(screen.getByRole('button', { name: '设计助理' }))
    const input = await screen.findByLabelText('给设计助理的话')
    await waitFor(() => expect((input as HTMLTextAreaElement).disabled).toBe(false))
    fireEvent.change(input, { target: { value: '在后墙放一张中岛桌' } })
    fireEvent.click(screen.getByRole('button', { name: '发送' }))

    await screen.findByText('已在后墙放了一张中岛桌。')
    expect(screen.getByText('放置道具：已放入「中岛桌」')).toBeTruthy()
    expect(onSelect).toHaveBeenCalledWith(NEW)
    const sent = calls.find((c) => c.path === `/api/v1/agent/sessions/${SID}/messages`)
    expect(sent?.body).toEqual({ text: '在后墙放一张中岛桌', nodeId: S1 })
    // A model that cannot see pictures: the screenshot option is off and says why.
    expect(screen.getByLabelText<HTMLInputElement>('当前模型不能看图，不附截图').disabled).toBe(
      true,
    )
    expect(calls.some((c) => c.method === 'POST' && c.path.endsWith('/agent/sessions'))).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: '撤销' }))
    await screen.findByText('已撤销')
    expect(calls.some((c) => c.path === `/api/v1/agent/actions/${AID}/undo`)).toBe(true)
    expect(screen.queryByRole('button', { name: '撤销' })).toBeNull()
  })

  it('asks for a model before it can chat', async () => {
    const { fetchMock } = fakeApi(null)
    vi.stubGlobal('fetch', fetchMock)
    mount(vi.fn())
    fireEvent.click(screen.getByRole('button', { name: '设计助理' }))
    await screen.findByText(/还没有可用的 Agent 模型/)
    expect(screen.getByLabelText<HTMLTextAreaElement>('给设计助理的话').disabled).toBe(true)
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '发送' }).disabled).toBe(true)
  })
})
