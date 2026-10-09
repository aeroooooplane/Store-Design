import { pgEnum } from 'drizzle-orm/pg-core'
import {
  ACTOR_KINDS,
  JOB_STATUSES,
  JOB_TYPES,
  MARKETS,
  NODE_KINDS,
  NODE_ORIGINS,
  PLAN_STRATEGIES,
  RENDER_ENGINES,
  RENDER_MODES,
  SHOP_TYPES,
  SI_STYLES,
} from '@store/shared'

// Enum values come from @store/shared so the API, the UI and the database cannot drift apart.
export const shopType = pgEnum('shop_type', SHOP_TYPES)
export const market = pgEnum('market', MARKETS)
export const siStyle = pgEnum('si_style', SI_STYLES)
export const nodeKind = pgEnum('node_kind', NODE_KINDS)
export const nodeOrigin = pgEnum('node_origin', NODE_ORIGINS)
export const planStrategy = pgEnum('plan_strategy', PLAN_STRATEGIES)
export const renderMode = pgEnum('render_mode', RENDER_MODES)
export const renderEngine = pgEnum('render_engine', RENDER_ENGINES)
export const jobType = pgEnum('job_type', JOB_TYPES)
export const jobStatus = pgEnum('job_status', JOB_STATUSES)
export const actorKind = pgEnum('actor_kind', ACTOR_KINDS)
