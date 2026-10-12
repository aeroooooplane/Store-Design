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

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
  images?: ChatImage[]
}

export interface ChatRequest {
  purpose: AiPurpose
  modelId: string
  messages: ChatMessage[]
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
  tokensIn: number
  tokensOut: number
}

/** DeepSeek and DashScope speak the OpenAI chat format. */
async function openAiCompatible(
  spec: ModelSpec,
  key: string,
  request: ChatRequest,
): Promise<RawResult> {
  const messages = request.messages.map((m) => {
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
    },
    spec,
    request.signal,
  )) as {
    choices?: { message?: { content?: string | null } }[]
    usage?: { prompt_tokens?: number; completion_tokens?: number }
  }
  const text = data.choices?.[0]?.message?.content
  if (typeof text !== 'string') throw upstream(spec, '没有返回内容')
  return {
    text,
    tokensIn: data.usage?.prompt_tokens ?? 0,
    tokensOut: data.usage?.completion_tokens ?? 0,
  }
}

async function anthropic(spec: ModelSpec, key: string, request: ChatRequest): Promise<RawResult> {
  const system = request.messages
    .filter((m) => m.role === 'system')
    .map((m) => m.content)
    .join('\n\n')
  const messages = request.messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({
      role: m.role,
      content: [
        ...(m.images ?? []).map((img) => ({
          type: 'image',
          source: { type: 'base64', media_type: img.mediaType, data: img.base64 },
        })),
        { type: 'text', text: m.content },
      ],
    }))
  const data = (await post(
    'https://api.anthropic.com/v1/messages',
    { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    {
      model: spec.apiModel,
      max_tokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
      temperature: request.temperature ?? 0,
      ...(system ? { system } : {}),
      messages,
    },
    spec,
    request.signal,
  )) as {
    content?: { type: string; text?: string }[]
    usage?: { input_tokens?: number; output_tokens?: number }
  }
  const text = (data.content ?? [])
    .filter((c) => c.type === 'text')
    .map((c) => c.text ?? '')
    .join('')
  if (!text) throw upstream(spec, '没有返回内容')
  return {
    text,
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
