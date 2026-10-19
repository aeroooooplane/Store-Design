import { inArray } from 'drizzle-orm'
import { schema } from '@store/database'
import type { Database } from '@store/database'
import type { AiPurpose, AiSettings, AiSettingsUpdate } from '@store/shared'
import type { AppConfig } from '../config/env.ts'
import { AppError } from '../lib/app-error.ts'
import { LOCAL_MODEL_ID, availableModels, findModel } from './models.ts'
import type { ModelSpec } from './models.ts'

const { appSettings } = schema

const KEYS = {
  agentModel: 'ai.agent.model',
  recognitionModel: 'ai.recognition.model',
  recognitionFallback: 'ai.recognition.fallback',
  recognitionCloud: 'ai.recognition.cloud',
} as const

/** Preferred first when nothing is chosen yet. */
const AGENT_ORDER = ['deepseek-flash', 'qwen3-vl-plus', 'qwen3-vl-flash']
const FALLBACK_ORDER = ['qwen3-vl-plus', 'qwen3-vl-flash']

const canAct = (spec: ModelSpec, purpose: AiPurpose) => spec.purposes.includes(purpose)

/** A model that can take over when local recognition fails: remote and able to read pictures. */
const canFallBack = (spec: ModelSpec) =>
  spec.id !== LOCAL_MODEL_ID && spec.vision && canAct(spec, 'recognition')

function firstOf(order: string[], usable: ModelSpec[]): string | null {
  for (const id of order) if (usable.some((m) => m.id === id)) return id
  return usable[0]?.id ?? null
}

/**
 * What is in force: the saved choices, or the defaults for anything not saved or no longer
 * usable (its key was removed, the overseas switch turned off). Reading never fails.
 */
export async function readSettings(db: Database, ai: AppConfig['ai']): Promise<AiSettings> {
  const available = availableModels(ai)
  const rows = await db
    .select()
    .from(appSettings)
    .where(inArray(appSettings.key, Object.values(KEYS)))
  const saved = new Map(rows.map((r) => [r.key, r.value]))
  const choice = (key: string): string | null | undefined => {
    const value = saved.get(key)
    return typeof value === 'string' || value === null ? value : undefined
  }

  const agent = choice(KEYS.agentModel)
  const agentModels = available.filter((m) => canAct(m, 'agent'))
  const recognition = choice(KEYS.recognitionModel)
  const fallback = choice(KEYS.recognitionFallback)
  const recognitionModels = available.filter((m) => canAct(m, 'recognition'))
  const fallbackModels = available.filter(canFallBack)
  const recognitionModel =
    typeof recognition === 'string' && recognitionModels.some((m) => m.id === recognition)
      ? recognition
      : LOCAL_MODEL_ID
  const cloud = saved.get(KEYS.recognitionCloud)
  return {
    agentModel:
      typeof agent === 'string' && agentModels.some((m) => m.id === agent)
        ? agent
        : firstOf(AGENT_ORDER, agentModels),
    recognitionModel,
    // An explicit null means "no fallback" and is kept.
    recognitionFallback:
      fallback === null
        ? null
        : typeof fallback === 'string' &&
            fallback !== recognitionModel &&
            fallbackModels.some((m) => m.id === fallback)
          ? fallback
          : firstOf(
              FALLBACK_ORDER,
              fallbackModels.filter((m) => m.id !== recognitionModel),
            ),
    // Off until the user turns it on: plans leave this machine only by their choice.
    recognitionCloud: cloud === true,
  }
}

function requireModel(
  id: string,
  ai: AppConfig['ai'],
  what: string,
  accepts: (spec: ModelSpec) => boolean,
  reason: string,
): ModelSpec {
  const spec = findModel(id)
  if (!spec) throw new AppError('VALIDATION_FAILED', `${what}：没有这个模型（${id}）`)
  if (!availableModels(ai).some((m) => m.id === id)) {
    throw new AppError(
      'VALIDATION_FAILED',
      `${what}：「${spec.label}」未配置密钥或未开启，不能选用`,
    )
  }
  if (!accepts(spec)) throw new AppError('VALIDATION_FAILED', `${what}：「${spec.label}」${reason}`)
  return spec
}

/** Saves the given choices (each checked), then returns what is in force. */
export async function writeSettings(
  db: Database,
  ai: AppConfig['ai'],
  patch: AiSettingsUpdate,
): Promise<AiSettings> {
  const current = await readSettings(db, ai)
  const next: AiSettings = { ...current, ...patch }
  if (patch.agentModel) {
    requireModel(patch.agentModel, ai, 'Agent 模型', (m) => canAct(m, 'agent'), '不能用作 Agent')
  }
  if (patch.recognitionModel) {
    requireModel(
      patch.recognitionModel,
      ai,
      '平面识别模型',
      (m) => canAct(m, 'recognition'),
      '不能用于平面识别',
    )
  }
  if (patch.recognitionFallback) {
    requireModel(
      patch.recognitionFallback,
      ai,
      '识别失败后的模型',
      canFallBack,
      '不能作为兜底（需要联网并能看图）',
    )
  }
  if (next.recognitionFallback !== null && next.recognitionFallback === next.recognitionModel) {
    throw new AppError('VALIDATION_FAILED', '识别失败后的模型不能与平面识别模型相同')
  }
  // Only what the user changed is saved; the rest keeps following the defaults.
  const entries = (Object.keys(KEYS) as (keyof typeof KEYS)[])
    .filter((name) => patch[name] !== undefined)
    .map((name) => [KEYS[name], next[name]] as const)
  for (const [key, value] of entries) {
    await db
      .insert(appSettings)
      .values({ key, value })
      .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: new Date() } })
  }
  return readSettings(db, ai)
}
