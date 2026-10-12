import { eq, sql } from 'drizzle-orm'
import { schema } from '@store/database'
import type { Database } from '@store/database'
import type { AiBudget, AiPurpose } from '@store/shared'
import { AppError } from '../lib/app-error.ts'

const { aiUsage } = schema

const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000

/** The calendar day in Beijing (UTC+8, no daylight saving), as YYYY-MM-DD. */
export function beijingDay(now: Date = new Date()): string {
  return new Date(now.getTime() + BEIJING_OFFSET_MS).toISOString().slice(0, 10)
}

const round4 = (value: number) => Math.round(value * 10_000) / 10_000

/** Today's spending against the daily limit (shared by the agent and plan recognition). */
export async function budgetStatus(
  db: Database,
  limitCny: number,
  now: Date = new Date(),
): Promise<AiBudget> {
  const day = beijingDay(now)
  const [row] = await db
    .select({ spent: sql<string>`coalesce(sum(${aiUsage.costCny}), 0)` })
    .from(aiUsage)
    .where(eq(aiUsage.day, day))
  const spentCny = round4(Number(row?.spent ?? 0))
  const remainingCny = Math.max(0, round4(limitCny - spentCny))
  return { day, limitCny, spentCny, remainingCny, exceeded: spentCny >= limitCny }
}

/** Refuses a call once today's budget is used up; local recognition never goes through here. */
export async function assertBudget(
  db: Database,
  limitCny: number,
  now: Date = new Date(),
): Promise<void> {
  const status = await budgetStatus(db, limitCny, now)
  if (status.exceeded) {
    throw new AppError(
      'BUDGET_EXCEEDED',
      `今日 AI 额度（${limitCny} 元）已用完，北京时间 0 点重置；本地识别与规则排布不受影响`,
      { day: status.day, limitCny, spentCny: status.spentCny },
    )
  }
}

export interface UsageRecord {
  purpose: AiPurpose
  provider: string
  model: string
  tokensIn: number
  tokensOut: number
  costCny: number
  refType?: string
  refId?: string
}

/** Books one finished call; the cost is the vendor-reported token count times the price. */
export async function recordUsage(
  db: Database,
  usage: UsageRecord,
  now: Date = new Date(),
): Promise<void> {
  await db.insert(aiUsage).values({
    day: beijingDay(now),
    purpose: usage.purpose,
    provider: usage.provider,
    model: usage.model,
    tokensIn: usage.tokensIn,
    tokensOut: usage.tokensOut,
    costCny: usage.costCny,
    refType: usage.refType ?? null,
    refId: usage.refId ?? null,
  })
}
