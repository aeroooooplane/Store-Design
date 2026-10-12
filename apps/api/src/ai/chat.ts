import type { Database } from '@store/database'
import type { AiPurpose } from '@store/shared'
import type { AppConfig } from '../config/env.ts'
import { AppError } from '../lib/app-error.ts'
import { assertBudget, recordUsage } from './budget.ts'
import { costCny, findModel } from './models.ts'
import type { ModelSpec } from './models.ts'

/** A picture handed to a vision model, base64 without the data: prefix. */
export interface ChatImage {
  mediaType: 'image/png' | 'image/jpeg'
  base64: string
}

/** A function the model may call; `parameters` is a JSON schema object. */
export interface ToolSpec {
  name: string
  description: string
  parameters: Record<string, unknown>
}

export interface ToolCall {
  id: string
  name: string
  arguments: Record<string, unknown>
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  images?: ChatImage[]
  /** The calls an assistant message made. */
  toolCalls?: ToolCall[]
  /** The call a tool message answers. */
  toolCallId?: string
}

export interface ChatRequest {
  purpose: AiPurpose
  modelId: string
  messages: ChatMessage[]
  tools?: ToolSpec[]
  /** Ask for a JSON object (vendors that support it); the caller still parses and validates. */
  json?: boolean
  maxTokens?: number
  temperature?: number
  /** What this call belongs to, for the usage ledger. */
  ref?: { type: string; id: string }
  signal?: AbortSignal
}

export interface ChatResult {
  text: string
  toolCalls: ToolCall[]
  tokensIn: number
  tokensOut: number
  costCny: number
  model: string
}

const TIMEOUT_MS = 120_000
const DEFAULT_MAX_TOKENS = 4096

const apiKeyFor = (spec: ModelSpec, ai: AppConfig['ai']): string | undefined => {
  switch (spec.provider) {
    case 'deepseek':
      return ai.deepseekApiKey
    case 'dashscope':
      return ai.dashscopeApiKey
    case 'anthropic':
      return ai.anthropicApiKey
    case 'local':
      return undefined
  }
}

function upstream(spec: ModelSpec, detail: string): AppError {
  return new AppError('UPSTREAM_FAILED', `模型「${spec.label}」调用失败：${detail}`)
}

/** Tool arguments arrive as text; something unparseable is kept for the record, not dropped. */
function parseArguments(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object') return raw as Record<string, unknown>
  if (typeof raw !== 'string' || !raw.trim()) return {}
  try {
    const parsed: unknown = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}
  } catch {
    return { _raw: raw }
  }
}

async function post(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  spec: ModelSpec,
  signal?: AbortSignal,
) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  signal?.addEventListener('abort', () => controller.abort(), { once: true })
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    const text = await response.text()
    if (!response.ok) {
      // Vendor error bodies can be long; keep enough to understand, not enough to leak much.
      throw upstream(spec, `HTTP ${response.status} ${text.slice(0, 300)}`)
    }
    try {
      return JSON.parse(text) as unknown
    } catch {
      throw upstream(spec, '返回的不是 JSON')
    }
  } catch (error) {
    if (error instanceof AppError) throw error
    if (controller.signal.aborted) throw upstream(spec, signal?.aborted ? '已取消' : '超时')
    throw upstream(spec, error instanceof Error ? error.message : String(error))
  } finally {
    clearTimeout(timer)
  }
}

interface RawResult {
  text: string
  toolCalls: ToolCall[]
  tokensIn: number
  tokensOut: number
}

/** DeepSeek and DashScope speak the OpenAI chat format, tool calls included. */
async function openAiCompatible(
  spec: ModelSpec,
  key: string,
  request: ChatRequest,
): Promise<RawResult> {
  const messages = request.messages.map((m) => {
    if (m.role === 'tool') return { role: 'tool', tool_call_id: m.toolCallId, content: m.content }
    if (m.role === 'assistant' && m.toolCalls?.length) {
      return {
        role: 'assistant',
        content: m.content || null,
        tool_calls: m.toolCalls.map((c) => ({
          id: c.id,
          type: 'function',
          function: { name: c.name, arguments: JSON.stringify(c.arguments) },
        })),
      }
    }
    if (!m.images?.length) return { role: m.role, content: m.content }
    return {
      role: m.role,
      content: [
        ...m.images.map((img) => ({
          type: 'image_url',
          image_url: { url: `data:${img.mediaType};base64,${img.base64}` },
        })),
        { type: 'text', text: m.content },
      ],
    }
  })
  const data = (await post(
    `${spec.baseUrl}/chat/completions`,
    { authorization: `Bearer ${key}` },
    {
      model: spec.apiModel,
      messages,
      max_tokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
      temperature: request.temperature ?? 0,
      ...(request.json ? { response_format: { type: 'json_object' } } : {}),
      ...(request.tools?.length
        ? {
            tools: request.tools.map((t) => ({
              type: 'function',
              function: { name: t.name, description: t.description, parameters: t.parameters },
            })),
          }
        : {}),
    },
    spec,
    request.signal,
  )) as {
    choices?: {
      message?: {
        content?: string | null
        tool_calls?: { id?: string; function?: { name?: string; arguments?: unknown } }[]
      }
    }[]
    usage?: { prompt_tokens?: number; completion_tokens?: number }
  }
  const message = data.choices?.[0]?.message
  const text = typeof message?.content === 'string' ? message.content : ''
  const toolCalls: ToolCall[] = (message?.tool_calls ?? []).flatMap((c, i) =>
    c.function?.name
      ? [
          {
            id: c.id ?? `call_${i}`,
            name: c.function.name,
            arguments: parseArguments(c.function.arguments),
          },
        ]
      : [],
  )
  if (!text && !toolCalls.length) throw upstream(spec, '没有返回内容')
  return {
    text,
    toolCalls,
    tokensIn: data.usage?.prompt_tokens ?? 0,
    tokensOut: data.usage?.completion_tokens ?? 0,
  }
}

async function anthropic(spec: ModelSpec, key: string, request: ChatRequest): Promise<RawResult> {
  const system = request.messages
    .filter((m) => m.role === 'system')
    .map((m) => m.content)
    .join('\n\n')
  // Anthropic alternates user and assistant; tool results go in a user turn, several at once.
  const messages: { role: 'user' | 'assistant'; content: unknown[] }[] = []
  for (const m of request.messages) {
    if (m.role === 'system') continue
    if (m.role === 'tool') {
      const block = { type: 'tool_result', tool_use_id: m.toolCallId, content: m.content }
      const last = messages[messages.length - 1]
      if (
        last?.role === 'user' &&
        last.content.every((c) => (c as { type: string }).type === 'tool_result')
      ) {
        last.content.push(block)
      } else {
        messages.push({ role: 'user', content: [block] })
      }
      continue
    }
    const content: unknown[] = [
      ...(m.images ?? []).map((img) => ({
        type: 'image',
        source: { type: 'base64', media_type: img.mediaType, data: img.base64 },
      })),
      ...(m.content ? [{ type: 'text', text: m.content }] : []),
      ...(m.toolCalls ?? []).map((c) => ({
        type: 'tool_use',
        id: c.id,
        name: c.name,
        input: c.arguments,
      })),
    ]
    messages.push({ role: m.role, content })
  }
  const data = (await post(
    'https://api.anthropic.com/v1/messages',
    { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    {
      model: spec.apiModel,
      max_tokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
      temperature: request.temperature ?? 0,
      ...(system ? { system } : {}),
      ...(request.tools?.length
        ? {
            tools: request.tools.map((t) => ({
              name: t.name,
              description: t.description,
              input_schema: t.parameters,
            })),
          }
        : {}),
      messages,
    },
    spec,
    request.signal,
  )) as {
    content?: { type: string; text?: string; id?: string; name?: string; input?: unknown }[]
    usage?: { input_tokens?: number; output_tokens?: number }
  }
  const blocks = data.content ?? []
  const text = blocks
    .filter((c) => c.type === 'text')
    .map((c) => c.text ?? '')
    .join('')
  const toolCalls: ToolCall[] = blocks
    .filter((c) => c.type === 'tool_use' && c.name)
    .map((c, i) => ({
      id: c.id ?? `call_${i}`,
      name: c.name ?? '',
      arguments: parseArguments(c.input),
    }))
  if (!text && !toolCalls.length) throw upstream(spec, '没有返回内容')
  return {
    text,
    toolCalls,
    tokensIn: data.usage?.input_tokens ?? 0,
    tokensOut: data.usage?.output_tokens ?? 0,
  }
}

/**
 * One call to a remote model: checks today's budget first, then books the actual tokens. The
 * local recogniser is not a chat model and never comes through here.
 */
export async function chat(
  db: Database,
  config: AppConfig,
  request: ChatRequest,
): Promise<ChatResult> {
  const spec = findModel(request.modelId)
  if (!spec || spec.provider === 'local') {
    throw new AppError('VALIDATION_FAILED', `没有可调用的模型（${request.modelId}）`)
  }
  if (spec.overseas && !config.ai.enableOverseasModels) {
    throw new AppError('VALIDATION_FAILED', `模型「${spec.label}」未开启（境外模型需要打开开关）`)
  }
  const key = apiKeyFor(spec, config.ai)
  if (!key) throw new AppError('VALIDATION_FAILED', `模型「${spec.label}」未配置密钥`)
  if (request.messages.some((m) => m.images?.length) && !spec.vision) {
    throw new AppError('VALIDATION_FAILED', `模型「${spec.label}」不能看图`)
  }
  await assertBudget(db, config.ai.dailyBudgetCny)

  const raw =
    spec.provider === 'anthropic'
      ? await anthropic(spec, key, request)
      : await openAiCompatible(spec, key, request)
  const cost = costCny(spec, raw.tokensIn, raw.tokensOut)
  await recordUsage(db, {
    purpose: request.purpose,
    provider: spec.provider,
    model: spec.id,
    tokensIn: raw.tokensIn,
    tokensOut: raw.tokensOut,
    costCny: cost,
    ...(request.ref ? { refType: request.ref.type, refId: request.ref.id } : {}),
  })
  return { ...raw, costCny: cost, model: spec.id }
}
