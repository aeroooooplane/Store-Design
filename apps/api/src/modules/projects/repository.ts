import { and, count, desc, eq, ilike, isNotNull, isNull, sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import { schema } from '@store/database'
import type { Database } from '@store/database'
import type { ProjectCreate, ProjectListQuery, ProjectUpdate } from '@store/shared'

const { projects } = schema

export type ProjectRow = typeof projects.$inferSelect

/** Escapes LIKE wildcards so a search for "100%" matches literally. */
function likePattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
}

export async function listProjects(
  db: Database,
  query: ProjectListQuery,
): Promise<{ rows: ProjectRow[]; total: number }> {
  const filters: SQL[] = []
  if (query.status === 'active') filters.push(isNull(projects.deletedAt))
  if (query.status === 'deleted') filters.push(isNotNull(projects.deletedAt))
  if (query.q) filters.push(ilike(projects.name, likePattern(query.q)))
  const where = filters.length ? and(...filters) : undefined

  const [rows, totals] = await Promise.all([
    db
      .select()
      .from(projects)
      .where(where)
      .orderBy(desc(projects.updatedAt), desc(projects.id))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize),
    db.select({ total: count() }).from(projects).where(where),
  ])
  return { rows, total: totals[0]?.total ?? 0 }
}

export async function findProject(db: Database, id: string): Promise<ProjectRow | undefined> {
  const [row] = await db.select().from(projects).where(eq(projects.id, id))
  return row
}

export async function insertProject(db: Database, values: ProjectCreate): Promise<ProjectRow> {
  const [row] = await db.insert(projects).values(values).returning()
  if (!row) throw new Error('Project insert returned no row')
  return row
}

const bump = { revision: sql`${projects.revision} + 1`, updatedAt: sql`now()` }

/** Applies the change only if the stored revision still matches; returns undefined otherwise. */
export async function updateActiveProject(
  db: Database,
  id: string,
  expectedRevision: number,
  patch: ProjectUpdate,
): Promise<ProjectRow | undefined> {
  const [row] = await db
    .update(projects)
    .set({ ...patch, ...bump })
    .where(
      and(eq(projects.id, id), eq(projects.revision, expectedRevision), isNull(projects.deletedAt)),
    )
    .returning()
  return row
}

export async function setDeleted(
  db: Database,
  id: string,
  expectedRevision: number,
  deleted: boolean,
): Promise<ProjectRow | undefined> {
  const [row] = await db
    .update(projects)
    .set({ deletedAt: deleted ? sql`now()` : null, ...bump })
    .where(
      and(
        eq(projects.id, id),
        eq(projects.revision, expectedRevision),
        deleted ? isNull(projects.deletedAt) : isNotNull(projects.deletedAt),
      ),
    )
    .returning()
  return row
}
