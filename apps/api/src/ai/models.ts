import type { AiModel, AiProviderSchema, AiPurpose } from '@store/shared'
import type { z } from 'zod'
import type { AppConfig } from '../config/env.ts'

type Provider = z.infer<typeof AiProviderSchema>

export interface ModelSpec {
  id: string
  label: string
  provider: Provider
  /** Name sent to the vendor's API. */
  apiModel: string
  /** OpenAI-compatible base URL (DeepSeek, DashScope); unused for local and Anthropic. */
  baseUrl?: string
  purposes: readonly AiPurpose[]
  vision: boolean
  overseas: boolean
  /** CNY per million tokens. */
  price: { inputCny: number; outputCny: number } | null
}

/**
 * The model list and prices live here, in version control; change them when a vendor changes
 * its price list or names. The prices below are ESTIMATES rounded up (so the daily budget errs
 * on the safe side) — check them against the vendors' current price lists before relying on the
 * budget for billing.
 */
export const MODELS: readonly ModelSpec[] = [
  {
    id: 'local',
    label: '本地识别（OCR + 图像处理，不收费）',
    provider: 'local',
    apiModel: 'local',
    purposes: ['recognition'],
    vision: false,
    overseas: false,
    price: null,
  },
  {
    id: 'deepseek-flash',
    label: 'DeepSeek Flash',
    provider: 'deepseek',
    apiModel: 'deepseek-flash',
    baseUrl: 'https://api.deepseek.com',
    purposes: ['agent'],
    vision: false,
    overseas: false,
    price: { inputCny: 2, outputCny: 8 },
  },
  {
    id: 'qwen3-vl-plus',
    label: '通义千问 Qwen3-VL Plus',
    provider: 'dashscope',
    apiModel: 'qwen3-vl-plus',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    purposes: ['agent', 'recognition'],
    vision: true,
    overseas: false,
    price: { inputCny: 1.5, outputCny: 12 },
  },
  {
    id: 'qwen3-vl-flash',
    label: '通义千问 Qwen3-VL Flash',
    provider: 'dashscope',
    apiModel: 'qwen3-vl-flash',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    purposes: ['agent', 'recognition'],
    vision: true,
    overseas: false,
    price: { inputCny: 0.3, outputCny: 3 },
  },
  {
    id: 'claude-sonnet-5-5',
    label: 'Claude Sonnet 5.5（境外）',
    provider: 'anthropic',
    apiModel: 'claude-sonnet-5-5',
    purposes: ['agent', 'recognition'],
    vision: true,
    overseas: true,
    price: { inputCny: 22, outputCny: 110 },
  },
]

export const LOCAL_MODEL_ID = 'local'

export function findModel(id: string): ModelSpec | undefined {
  return MODELS.find((m) => m.id === id)
}

/** Has the key its vendor needs; overseas models also need the switch (default off). */
export function isAvailable(spec: ModelSpec, ai: AppConfig['ai']): boolean {
  if (spec.overseas && !ai.enableOverseasModels) return false
  switch (spec.provider) {
    case 'local':
      return true
    case 'deepseek':
      return Boolean(ai.deepseekApiKey)
    case 'dashscope':
      return Boolean(ai.dashscopeApiKey)
    case 'anthropic':
      return Boolean(ai.anthropicApiKey)
  }
}

export function availableModels(ai: AppConfig['ai']): ModelSpec[] {
  return MODELS.filter((spec) => isAvailable(spec, ai))
}

export function toAiModel(spec: ModelSpec): AiModel {
  return {
    id: spec.id,
    label: spec.label,
    provider: spec.provider,
    purposes: [...spec.purposes],
    vision: spec.vision,
    overseas: spec.overseas,
    price: spec.price,
  }
}

/** Cost of one call in CNY, rounded up to 0.0001. */
export function costCny(spec: ModelSpec, tokensIn: number, tokensOut: number): number {
  if (!spec.price) return 0
  const cost = (tokensIn * spec.price.inputCny + tokensOut * spec.price.outputCny) / 1_000_000
  return Math.ceil(cost * 10_000) / 10_000
}
