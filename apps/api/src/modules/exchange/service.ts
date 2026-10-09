import { asc, eq } from 'drizzle-orm'
import { schema } from '@store/database'
import type { Database } from '@store/database'
import { EXPORT_FORMAT, MAX_NODES_PER_PROJECT } from '@store/shared'
import type { ProjectExport, ProjectImported } from '@store/shared'
import type { RequestContext } from '../../context/actor.ts'
import { authorize } from '../../context/policy.ts'
import { AppError, notFound } from '../../lib/app-error.ts'
import { placeableAssets } from '../assets/service.ts'
import { recordAudit } from '../audit/record.ts'
import { checkSpace } from '../nodes/service.ts'
import { toProject } from '../projects/service.ts'
import { convertLegacy } from './legacy.ts'
import { convertNative, isNativeExport } from './native.ts'
import type { PlannedProject } from './plan.ts'

const { designNodes, projectDrafts, projects } = schema

/** Always creates a new project; existing projects are never modified by an import. */
export async function importProject(
  db: Database,
  ctx: RequestContext,
  input: { name?: string | undefined; data: unknown },
): Promise<ProjectImported> {
  authorize(ctx.actor, 'project:import')
  const assets = await placeableAssets(db)
  const native = isNativeExport(input.data)
  const planned: PlannedProject = native
    ? convertNative(input.data, assets, input.name)
    : convertLegacy(input.data, assets, input.name)
  if (planned.nodes.length > MAX_NODES_PER_PROJECT) {
    throw new AppError('VALIDATION_FAILED', `节点数超过上限 ${MAX_NODES_PER_PROJECT}`)
  }

  return db.transaction(async (tx) => {
    const [project] = await tx
      .insert(projects)
      .values({
        name: planned.name,
        shopType: planned.shopType,
        market: planned.market,
        siStyle: planned.siStyle,
      })
      .returning()
    if (!project) throw new Error('Project insert returned no row')

    const ids = new Map<string, string>()
    for (const node of planned.nodes) {
      const space = node.kind === 'space' && node.space ? checkSpace(node.space).space : null
      if (node.kind === 'space' && !space)
        throw new AppError('VALIDATION_FAILED', `节点“${node.name}”缺少空间`)
      if (node.kind !== 'space' && !node.layout)
        throw new AppError('VALIDATION_FAILED', `节点“${node.name}”缺少布局`)
      const parentId = node.parentRef === null ? null : (ids.get(node.parentRef) ?? null)
      const [row] = await tx
        .insert(designNodes)
        .values({
          projectId: project.id,
          parentId,
          kind: node.kind,
          name: node.name,
          space,
          layout: node.layout,
          strategy: node.kind === 'plan' ? node.strategy : null,
          siStyle: node.siStyle,
          origin: node.origin,
          importedFrom: node.importedFrom,
          hiddenAt: node.hidden ? new Date() : null,
        })
        .returning({ id: designNodes.id })
      if (!row) throw new Error('Node insert returned no row')
      ids.set(node.ref, row.id)
    }

    let draftImported = false
    if (planned.draft) {
      const baseNodeId = ids.get(planned.draft.baseRef)
      if (baseNodeId) {
        await tx
          .insert(projectDrafts)
          .values({ projectId: project.id, baseNodeId, layout: planned.draft.layout })
        draftImported = true
      }
    }
    await recordAudit(tx, ctx, {
      entity: 'project',
      entityId: project.id,
      action: 'import',
      detail: {
        format: native ? EXPORT_FORMAT : 'legacy',
        nodes: planned.nodes.length,
        warnings: planned.warnings.length,
      },
    })
    return {
      project: toProject(project),
      nodesImported: planned.nodes.length,
      draftImported,
      format: native ? 'store-design-project' : 'legacy',
      warnings: planned.warnings,
    } satisfies ProjectImported
  })
}

export async function exportProject(
  db: Database,
  ctx: RequestContext,
  projectId: string,
): Promise<ProjectExport> {
  authorize(ctx.actor, 'project:export', { projectId })
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId))
  if (!project) throw notFound('项目')
  const nodes = await db
    .select()
    .from(designNodes)
    .where(eq(designNodes.projectId, projectId))
    .orderBy(asc(designNodes.seq))
  if (!nodes.length) throw new AppError('INVALID_STATE', '项目还没有任何节点，无需导出')
  const [draft] = await db
    .select()
    .from(projectDrafts)
    .where(eq(projectDrafts.projectId, projectId))
  return {
    format: EXPORT_FORMAT,
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    project: {
      name: project.name,
      shopType: project.shopType,
      market: project.market,
      siStyle: project.siStyle,
    },
    nodes: nodes.map((n) => ({
      id: n.id,
      parentId: n.parentId,
      kind: n.kind,
      name: n.name,
      space: n.space ?? null,
      layout: n.layout ?? null,
      strategy: n.strategy,
      siStyle: n.siStyle,
      origin: n.origin,
      importedFrom: n.importedFrom,
      hidden: n.hiddenAt !== null,
    })),
    draft: draft ? { baseNodeId: draft.baseNodeId, layout: draft.layout } : null,
  }
}
