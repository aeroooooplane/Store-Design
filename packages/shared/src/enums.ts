import { z } from 'zod'

// Values are stored in the database; labels are what the Chinese UI shows.

export const SHOP_TYPES = ['side_hall', 'island', 'zone'] as const
export const ShopTypeSchema = z.enum(SHOP_TYPES)
export type ShopType = z.infer<typeof ShopTypeSchema>
export const SHOP_TYPE_LABELS: Record<ShopType, string> = {
  side_hall: '边厅店',
  island: '中岛店',
  zone: '专区',
}

export const MARKETS = ['domestic', 'overseas'] as const
export const MarketSchema = z.enum(MARKETS)
export type Market = z.infer<typeof MarketSchema>
export const MARKET_LABELS: Record<Market, string> = {
  domestic: '国内',
  overseas: '海外',
}

export const SI_STYLES = ['SI1.0', 'SI2.0'] as const
export const SiStyleSchema = z.enum(SI_STYLES)
export type SiStyle = z.infer<typeof SiStyleSchema>
export const DEFAULT_SI_STYLE: SiStyle = 'SI1.0'

export const NODE_KINDS = ['space', 'plan', 'edit', 'white', 'render'] as const
export const NodeKindSchema = z.enum(NODE_KINDS)
export type NodeKind = z.infer<typeof NodeKindSchema>

export const NODE_ORIGINS = ['user', 'generator', 'agent', 'import', 'recognition'] as const
export const NodeOriginSchema = z.enum(NODE_ORIGINS)
export type NodeOrigin = z.infer<typeof NodeOriginSchema>

export const PLAN_STRATEGIES = ['max', 'area', 'min', 'case'] as const
export const PlanStrategySchema = z.enum(PLAN_STRATEGIES)
export type PlanStrategy = z.infer<typeof PlanStrategySchema>
export const PLAN_STRATEGY_LABELS: Record<PlanStrategy, string> = {
  max: '尽量多放',
  area: '按面积推荐',
  min: '尽量少放',
  case: '参照相似门店',
}

export const ITEM_FUNCTIONS = [
  'island_table',
  'unboxing_table',
  'cashier',
  'accessory_cabinet',
  'side_cabinet',
  'display_stand',
  'screen',
  'signage',
  'seating',
  'storage',
  'other',
] as const
export const ItemFunctionSchema = z.enum(ITEM_FUNCTIONS)
export type ItemFunction = z.infer<typeof ItemFunctionSchema>

export const RENDER_MODES = ['white', 'material'] as const
export const RenderModeSchema = z.enum(RENDER_MODES)
export type RenderMode = z.infer<typeof RenderModeSchema>

export const RENDER_ENGINES = ['three', 'blender'] as const
export const RenderEngineSchema = z.enum(RENDER_ENGINES)
export type RenderEngine = z.infer<typeof RenderEngineSchema>

export const JOB_TYPES = ['delivery', 'recognition', 'render_blender', 'ai_enhance'] as const
export const JobTypeSchema = z.enum(JOB_TYPES)
export type JobType = z.infer<typeof JobTypeSchema>

export const JOB_STATUSES = ['queued', 'running', 'succeeded', 'failed', 'canceled'] as const
export const JobStatusSchema = z.enum(JOB_STATUSES)
export type JobStatus = z.infer<typeof JobStatusSchema>

/** Who performed an action. `user` is reserved for the future account system. */
export const ACTOR_KINDS = ['visitor', 'user', 'agent', 'system'] as const
export const ActorKindSchema = z.enum(ACTOR_KINDS)
export type ActorKind = z.infer<typeof ActorKindSchema>
