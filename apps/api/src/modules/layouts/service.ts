import type { Database } from '@store/database'
import { checkAssetFit, planLayout, validateLayout } from '@store/shared'
import type { Issue, Layout, LayoutCandidates, LayoutGenerate, Space } from '@store/shared'
import type { RequestContext } from '../../context/actor.ts'
import { authorize } from '../../context/policy.ts'
import { catalogAssets, placeableAssets } from '../assets/service.ts'
import { checkSpace } from '../nodes/service.ts'
import { plannerCatalog } from './selection.ts'

export async function generateLayouts(
  db: Database,
  ctx: RequestContext,
  input: LayoutGenerate,
): Promise<LayoutCandidates> {
  authorize(ctx.actor, 'layout:generate')
  const { space, warnings } = checkSpace(input.space)
  const catalog = plannerCatalog((await placeableAssets(db)).values(), input.siStyle)
  const candidates = input.strategies.map((strategy) => {
    const result = planLayout({ space, shopType: input.shopType, strategy, catalog })
    return {
      strategy,
      layout: result.layout,
      issues: [...warnings, ...result.issues],
      notes: result.notes,
    }
  })
  return { space, candidates }
}

/** Live check for the editors: every problem is returned instead of rejecting the request. */
export async function validateDraftLayout(
  db: Database,
  ctx: RequestContext,
  space: Space,
  layout: Layout,
): Promise<Issue[]> {
  authorize(ctx.actor, 'layout:validate')
  return [...checkAssetFit(layout, await catalogAssets(db)), ...validateLayout(space, layout)].map(
    (issue) => ({ ...issue }),
  )
}
