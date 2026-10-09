import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { LayoutSchema, rectangleSpace } from '@store/shared'
import { createDatabase, schema } from './index.ts'
import type { DatabaseHandle } from './index.ts'

const { designNodes, projects } = schema

let handle: DatabaseHandle

beforeAll(async () => {
  handle = createDatabase('pglite://memory')
  await handle.migrate()
})

afterAll(async () => {
  await handle.close()
})

async function newProject(name: string) {
  const [project] = await handle.db
    .insert(projects)
    .values({ name, shopType: 'island' })
    .returning()
  if (!project) throw new Error('insert failed')
  return project
}

async function spaceNode(projectId: string) {
  const [node] = await handle.db
    .insert(designNodes)
    .values({
      projectId,
      kind: 'space',
      name: '空间',
      space: rectangleSpace(6, 4, 3),
      origin: 'user',
    })
    .returning()
  if (!node) throw new Error('insert failed')
  return node
}

const emptyLayout = LayoutSchema.parse({ schemaVersion: 3, items: [] })

/** Drizzle wraps driver errors; the PostgreSQL message is on the cause. */
async function failure(promise: Promise<unknown>): Promise<string> {
  try {
    await promise
  } catch (error) {
    const cause = (error as { cause?: { message?: string } }).cause
    return cause?.message ?? String(error)
  }
  throw new Error('expected the statement to fail')
}

describe('migrations', () => {
  it('apply cleanly and are idempotent', async () => {
    await expect(handle.migrate()).resolves.toBeUndefined()
  })
})

describe('projects', () => {
  it('fill defaults for market, SI style and revision', async () => {
    const project = await newProject('默认值')
    expect(project).toMatchObject({
      market: 'domestic',
      siStyle: 'SI1.0',
      revision: 1,
      deletedAt: null,
    })
  })

  it('reject blank names and unknown enum values', async () => {
    expect(
      await failure(handle.db.insert(projects).values({ name: '  ', shopType: 'zone' })),
    ).toMatch(/projects_name_not_blank/)
    const bogus = { name: 'x', shopType: 'flagship' } as unknown as typeof projects.$inferInsert
    expect(await failure(handle.db.insert(projects).values(bogus))).toMatch(
      /invalid input value for enum/,
    )
  })
})

describe('design_nodes', () => {
  it('round-trip space and layout JSON', async () => {
    const project = await newProject('往返')
    const root = await spaceNode(project.id)
    await handle.db.insert(designNodes).values({
      projectId: project.id,
      parentId: root.id,
      kind: 'plan',
      name: '方案 A',
      layout: emptyLayout,
      strategy: 'max',
      origin: 'generator',
    })
    const rows = await handle.db
      .select()
      .from(designNodes)
      .where(eq(designNodes.projectId, project.id))
    expect(rows).toHaveLength(2)
    expect(rows.find((row) => row.kind === 'space')?.space?.boundary).toHaveLength(4)
  })

  it('require a parent and a layout for non-space nodes', async () => {
    const project = await newProject('缺父节点')
    const message = await failure(
      handle.db.insert(designNodes).values({
        projectId: project.id,
        kind: 'edit',
        name: '编辑',
        layout: emptyLayout,
        origin: 'user',
      }),
    )
    expect(message).toMatch(/design_nodes_payload_matches_kind/)
  })

  it('reject a parent from another project', async () => {
    const first = await newProject('项目一')
    const second = await newProject('项目二')
    const foreignRoot = await spaceNode(first.id)
    const message = await failure(
      handle.db.insert(designNodes).values({
        projectId: second.id,
        parentId: foreignRoot.id,
        kind: 'edit',
        name: '跨项目',
        layout: emptyLayout,
        origin: 'user',
      }),
    )
    expect(message).toMatch(/design_nodes_parent_same_project_fk/)
  })

  it('only allow a strategy on plan nodes', async () => {
    const project = await newProject('策略')
    const root = await spaceNode(project.id)
    const message = await failure(
      handle.db.insert(designNodes).values({
        projectId: project.id,
        parentId: root.id,
        kind: 'edit',
        name: '编辑',
        layout: emptyLayout,
        strategy: 'min',
        origin: 'user',
      }),
    )
    expect(message).toMatch(/design_nodes_strategy_only_on_plan/)
  })
})
