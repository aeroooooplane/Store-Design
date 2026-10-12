import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AiModel, AiOverview, AiSettings } from '@store/shared'
import { SettingsPage } from './SettingsPage.tsx'

const model = (id: string, overrides: Partial<AiModel> = {}): AiModel => ({
  id,
  label: id,
  provider: 'dashscope',
  purposes: ['agent', 'recognition'],
  vision: true,
  overseas: false,
  price: { inputCny: 1, outputCny: 2 },
  ...overrides,
})

function fakeApi(overview: AiOverview) {
  const patches: unknown[] = []
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
  const fetchMock = vi.fn(async (request: Request) => {
    const { pathname } = new URL(request.url)
    if (request.method === 'GET' && pathname === '/api/v1/ai') return json(200, overview)
    if (request.method === 'PATCH' && pathname === '/api/v1/ai/settings') {
      const patch = JSON.parse(await request.text()) as Partial<AiSettings>
      patches.push(patch)
      overview.settings = { ...overview.settings, ...patch }
      return json(200, overview.settings)
    }
    return json(404, { error: { code: 'NOT_FOUND', message: '接口不存在', requestId: 'r' } })
  })
  return { patches, fetchMock }
}

function show() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <SettingsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('SettingsPage', () => {
  it('shows the usable models, the budget, and saves a change', async () => {
    const server = fakeApi({
      models: [
        model('local', {
          provider: 'local',
          purposes: ['recognition'],
          vision: false,
          price: null,
        }),
        model('deepseek-flash', { provider: 'deepseek', purposes: ['agent'], vision: false }),
        model('qwen3-vl-flash'),
      ],
      settings: {
        agentModel: 'deepseek-flash',
        recognitionModel: 'local',
        recognitionFallback: 'qwen3-vl-flash',
      },
      budget: {
        day: '2026-10-12',
        limitCny: 50,
        spentCny: 12.3456,
        remainingCny: 37.6544,
        exceeded: false,
      },
    })
    vi.stubGlobal('fetch', server.fetchMock)
    show()

    const agent = await screen.findByLabelText<HTMLSelectElement>('Agent')
    expect(agent.value).toBe('deepseek-flash')
    expect([...agent.options].map((o) => o.value)).toEqual(['deepseek-flash', 'qwen3-vl-flash'])
    const recognition = screen.getByLabelText<HTMLSelectElement>('平面识别')
    expect([...recognition.options].map((o) => o.value)).toEqual(['local', 'qwen3-vl-flash'])
    // The fallback must be remote and able to see; '不使用' is allowed.
    const fallback = screen.getByLabelText<HTMLSelectElement>('识别失败后')
    expect([...fallback.options].map((o) => o.value)).toEqual(['', 'qwen3-vl-flash'])
    expect(screen.getByText(/剩余/).textContent).toContain('37.65')

    fireEvent.change(agent, { target: { value: 'qwen3-vl-flash' } })
    await waitFor(() => expect(server.patches).toEqual([{ agentModel: 'qwen3-vl-flash' }]))
    expect(await screen.findByRole('status')).toBeTruthy()
  })

  it('explains what to do when no key is configured and the budget is used up', async () => {
    const server = fakeApi({
      models: [
        model('local', {
          provider: 'local',
          purposes: ['recognition'],
          vision: false,
          price: null,
        }),
      ],
      settings: { agentModel: null, recognitionModel: 'local', recognitionFallback: null },
      budget: { day: '2026-10-12', limitCny: 50, spentCny: 50, remainingCny: 0, exceeded: true },
    })
    vi.stubGlobal('fetch', server.fetchMock)
    show()
    expect(await screen.findByText(/请在服务器配置 DeepSeek 或通义千问的密钥/)).toBeTruthy()
    expect(screen.queryByLabelText('Agent')).toBeNull()
    expect(screen.getByText(/额度已用完/)).toBeTruthy()
  })
})
