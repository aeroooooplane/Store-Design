import path from 'node:path'
import { REPOSITORY_ROOT } from '@store/database'
import { z } from 'zod'

// Empty variables in .env mean "not set".
const optionalSecret = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z.string().min(1).optional(),
)

const booleanFlag = z.preprocess(
  (value) => (typeof value === 'string' ? value.trim().toLowerCase() : value),
  z
    .enum(['true', 'false', '1', '0'])
    .default('false')
    .transform((v) => v === 'true' || v === '1'),
)

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  API_HOST: z.string().min(1).default('127.0.0.1'),
  API_PORT: z.coerce.number().int().min(1).max(65_535).default(3001),
  WEB_ORIGIN: z.url().default('http://127.0.0.1:5173'),
  DATABASE_URL: z.string().min(1).default('pglite://./data/pglite'),
  RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(300),
  STORAGE_ROOT: z.string().min(1).default('./data/files'),
  RESOURCE_ROOT: z.string().min(1).default('./资源库'),
  ARCHIVE_ROOT: z.string().min(1).default('./data/archive'),
  DEEPSEEK_API_KEY: optionalSecret,
  DASHSCOPE_API_KEY: optionalSecret,
  ENABLE_OVERSEAS_MODELS: booleanFlag,
  ANTHROPIC_API_KEY: optionalSecret,
  AI_DAILY_BUDGET_CNY: z.coerce.number().min(0).default(50),
})

export interface AppConfig {
  nodeEnv: 'development' | 'test' | 'production'
  logLevel: z.infer<typeof EnvSchema>['LOG_LEVEL']
  host: string
  port: number
  webOrigin: string
  databaseUrl: string
  rateLimitMax: number
  /** Absolute paths. */
  storageRoot: string
  resourceRoot: string
  archiveRoot: string
  ai: {
    deepseekApiKey: string | undefined
    dashscopeApiKey: string | undefined
    enableOverseasModels: boolean
    anthropicApiKey: string | undefined
    dailyBudgetCny: number
  }
}

/** Reads and validates the environment once at start-up; a bad value stops the process. */
export function loadConfig(env: Record<string, string | undefined> = process.env): AppConfig {
  const parsed = EnvSchema.safeParse(env)
  if (!parsed.success) {
    // Report variable names only; values may contain secrets.
    const problems = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`)
    throw new Error(`Invalid environment configuration:\n${problems.join('\n')}`)
  }
  const e = parsed.data
  const resolve = (value: string) => path.resolve(REPOSITORY_ROOT, value)
  return {
    nodeEnv: e.NODE_ENV,
    logLevel: e.LOG_LEVEL,
    host: e.API_HOST,
    port: e.API_PORT,
    webOrigin: e.WEB_ORIGIN.replace(/\/$/, ''),
    databaseUrl: e.DATABASE_URL,
    rateLimitMax: e.RATE_LIMIT_MAX,
    storageRoot: resolve(e.STORAGE_ROOT),
    resourceRoot: resolve(e.RESOURCE_ROOT),
    archiveRoot: resolve(e.ARCHIVE_ROOT),
    ai: {
      deepseekApiKey: e.DEEPSEEK_API_KEY,
      dashscopeApiKey: e.DASHSCOPE_API_KEY,
      enableOverseasModels: e.ENABLE_OVERSEAS_MODELS,
      anthropicApiKey: e.ANTHROPIC_API_KEY,
      dailyBudgetCny: e.AI_DAILY_BUDGET_CNY,
    },
  }
}
