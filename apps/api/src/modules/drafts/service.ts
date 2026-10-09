import { and, eq, sql } from 'drizzle-orm'
import { schema } from '@store/database'
import type { Database } from '@store/database'
import type { Draft, DraftPut, DraftSaved } from '@store/shared'
import type { RequestContext } from '../../context/actor.ts'
import { authorize } from '../../context/policy.ts'
import { AppError, notFound } from '../../lib/app-error.ts'
import { checkLayout, requireActiveProject, resolveSpace } from '../nodes/service.ts'

const { designNodes, projectDrafts } = schema
type DraftRow = typeof projectDrafts.$inferSelect

/** A draft continues an existing design step; render nodes are outputs, not edit bases. */
const DRAFT_BASE_KINDS = new Set(['space', 'plan', 'edit', 'white'])

function toDraft(row: DraftRow): Draft {
  return {
    projectId: row.projectId,
    baseNodeId: row.baseNodeId,
    layout: row.layout,
    revision: row.revision,
    updatedAt: row.updatedAt.toISOString(),
  }
}

async function currentDraft(db: Database, projectId: string): Promise<DraftRow | undefined> {
  const [row] = await db.select().from(projectDrafts).where(eq(projectDrafts.projectId, projectId))
  return row
}

function conflict(row: DraftRow | undefined): AppError {
  return row
    ? new AppError('REVISION_CONFLICT', '草稿已被其他窗口修改，请刷新后再保存', {
        currentRevision: row.revision,
      })
    : new AppError('REVISION_CONFLICT', '草稿已不存在，请刷新后再保存', { currentRevision: null })
}

export async function getDraft(
  db: Database,
  ctx: RequestContext,
  projectId: string,
): Promise<Draft> {
  authorize(ctx.actor, 'draft:read', { projectId })
  const row = await currentDraft(db, projectId)
  if (!row) throw notFound('草稿')
  return toDraft(row)
}

/**
 * Saves the shared working draft. The first save needs no revision; later saves must name the
 * revision they started from, so a stale window cannot overwrite newer work.
 */
export async function saveDraft(
  db: Database,
  ctx: RequestContext,
  projectId: string,
  expectedRevision: number | null,
  input: DraftPut,
): Promise<DraftSaved> {
  authorize(ctx.actor, 'draft:write', { projectId })
  await requireActiveProject(db, projectId)
  const [base] = await db.select().from(designNodes).where(eq(designNodes.id, input.baseNodeId))
  if (!base || base.projectId !== projectId) throw notFound('草稿所基于的节点')
  if (!DRAFT_BASE_KINDS.has(base.kind))
    throw new AppError('INVALID_STATE', '渲染节点不能作为编辑起点')
  const issues = await checkLayout(db, await resolveSpace(db, base.id), input.layout, 'draft')

  const values = { baseNodeId: input.baseNodeId, layout: input.layout }
  let row: DraftRow | undefined
  if (expectedRevision === null) {
    ;[row] = await db
      .insert(projectDrafts)
      .values({ projectId, ...values })
      .onConflictDoNothing({ target: projectDrafts.projectId })
      .returning()
    if (!row) {
      const existing = await currentDraft(db, projectId)
      throw new AppError('REVISION_REQUIRED', '已有草稿，请带上 If-Match 版本号保存', {
        currentRevision: existing?.revision ?? null,
      })
    }
  } else {
    ;[row] = await db
      .update(projectDrafts)
      .set({ ...values, revision: sql`${projectDrafts.revision} + 1`, updatedAt: sql`now()` })
      .where(
        and(eq(projectDrafts.projectId, projectId), eq(projectDrafts.revision, expectedRevision)),
      )
      .returning()
    if (!row) throw conflict(await currentDraft(db, projectId))
  }
  return { draft: toDraft(row), issues }
}

export async function discardDraft(
  db: Database,
  ctx: RequestContext,
  projectId: string,
  expectedRevision: number,
): Promise<void> {
  authorize(ctx.actor, 'draft:write', { projectId })
  await requireActiveProject(db, projectId)
  const deleted = await db
    .delete(projectDrafts)
    .where(
      and(eq(projectDrafts.projectId, projectId), eq(projectDrafts.revision, expectedRevision)),
    )
    .returning({ projectId: projectDrafts.projectId })
  if (!deleted.length) throw conflict(await currentDraft(db, projectId))
}
