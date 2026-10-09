import type { Database } from '@store/database'
import type {
  Project,
  ProjectCreate,
  ProjectList,
  ProjectListQuery,
  ProjectUpdate,
} from '@store/shared'
import type { RequestContext } from '../../context/actor.ts'
import { authorize } from '../../context/policy.ts'
import { AppError, notFound } from '../../lib/app-error.ts'
import { recordAudit } from '../audit/record.ts'
import * as repository from './repository.ts'
import type { ProjectRow } from './repository.ts'

export function toProject(row: ProjectRow): Project {
  return {
    id: row.id,
    name: row.name,
    shopType: row.shopType,
    market: row.market,
    siStyle: row.siStyle,
    revision: row.revision,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    deletedAt: row.deletedAt?.toISOString() ?? null,
  }
}

/**
 * A guarded write matched no row. Re-read to tell the caller why: missing, wrong state
 * (in or out of the bin) or edited by someone else in the meantime.
 */
async function explainRejectedWrite(
  db: Database,
  id: string,
  expectedRevision: number,
  needsDeleted: boolean,
): Promise<AppError> {
  const current = await repository.findProject(db, id)
  if (!current) return notFound('项目')
  if (current.revision !== expectedRevision) {
    return new AppError('REVISION_CONFLICT', '项目已被其他人修改，请刷新后再操作', {
      currentRevision: current.revision,
    })
  }
  return needsDeleted
    ? new AppError('INVALID_STATE', '项目不在回收站中')
    : new AppError('INVALID_STATE', '项目在回收站中，请先恢复')
}

export async function listProjects(
  db: Database,
  ctx: RequestContext,
  query: ProjectListQuery,
): Promise<ProjectList> {
  authorize(ctx.actor, 'project:list')
  const { rows, total } = await repository.listProjects(db, query)
  return { items: rows.map(toProject), total, page: query.page, pageSize: query.pageSize }
}

export async function getProject(db: Database, ctx: RequestContext, id: string): Promise<Project> {
  authorize(ctx.actor, 'project:read', { projectId: id })
  const row = await repository.findProject(db, id)
  if (!row) throw notFound('项目')
  return toProject(row)
}

export async function createProject(
  db: Database,
  ctx: RequestContext,
  input: ProjectCreate,
): Promise<Project> {
  authorize(ctx.actor, 'project:create')
  return db.transaction(async (tx) => {
    const row = await repository.insertProject(tx, input)
    await recordAudit(tx, ctx, { entity: 'project', entityId: row.id, action: 'create' })
    return toProject(row)
  })
}

export async function updateProject(
  db: Database,
  ctx: RequestContext,
  id: string,
  expectedRevision: number,
  patch: ProjectUpdate,
): Promise<Project> {
  authorize(ctx.actor, 'project:update', { projectId: id })
  const row = await repository.updateActiveProject(db, id, expectedRevision, patch)
  if (!row) throw await explainRejectedWrite(db, id, expectedRevision, false)
  return toProject(row)
}

export async function deleteProject(
  db: Database,
  ctx: RequestContext,
  id: string,
  expectedRevision: number,
): Promise<Project> {
  authorize(ctx.actor, 'project:delete', { projectId: id })
  const row = await db.transaction(async (tx) => {
    const deleted = await repository.setDeleted(tx, id, expectedRevision, true)
    if (deleted) await recordAudit(tx, ctx, { entity: 'project', entityId: id, action: 'delete' })
    return deleted
  })
  if (!row) throw await explainRejectedWrite(db, id, expectedRevision, false)
  return toProject(row)
}

export async function restoreProject(
  db: Database,
  ctx: RequestContext,
  id: string,
  expectedRevision: number,
): Promise<Project> {
  authorize(ctx.actor, 'project:restore', { projectId: id })
  const row = await db.transaction(async (tx) => {
    const restored = await repository.setDeleted(tx, id, expectedRevision, false)
    if (restored) await recordAudit(tx, ctx, { entity: 'project', entityId: id, action: 'restore' })
    return restored
  })
  if (!row) throw await explainRejectedWrite(db, id, expectedRevision, true)
  return toProject(row)
}
