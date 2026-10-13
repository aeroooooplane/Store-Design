import { eq } from 'drizzle-orm'
import { schema } from '@store/database'
import type { Database } from '@store/database'
import { AppError, notFound } from '../../lib/app-error.ts'

/**
 * Plain lookups of history nodes and their project, shared by the modules that work on nodes
 * (nodes, cameras, renders). They import nothing from those modules, so none of them import
 * each other just for this.
 */
const { designNodes, projects } = schema
export type NodeRow = typeof designNodes.$inferSelect

export async function findNode(db: Database, nodeId: string): Promise<NodeRow> {
  const [row] = await db.select().from(designNodes).where(eq(designNodes.id, nodeId))
  if (!row) throw notFound('节点')
  return row
}

/** Projects in the recycle bin are read-only. */
export async function requireActiveProject(db: Database, projectId: string): Promise<void> {
  const [project] = await db
    .select({ deletedAt: projects.deletedAt })
    .from(projects)
    .where(eq(projects.id, projectId))
  if (!project) throw notFound('项目')
  if (project.deletedAt) throw new AppError('INVALID_STATE', '项目在回收站中，请先恢复')
}
