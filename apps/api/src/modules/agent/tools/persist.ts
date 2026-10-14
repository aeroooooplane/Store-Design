import { schema } from '@store/database'
import type { Database } from '@store/database'
import { MAX_NODES_PER_PROJECT, STAGE_PARENT_KINDS, freshName, stageOf } from '@store/shared'
import type { Layout, NodeKind } from '@store/shared'
import { AppError } from '../../../lib/app-error.ts'
import { findNode } from '../../nodes/repository.ts'
import { createNode } from '../../nodes/service.ts'
import { asc, eq } from 'drizzle-orm'
import type { ToolContext, ToolOutcome } from './context.ts'

const { designNodes } = schema

export const EMPTY_LAYOUT: Layout = { schemaVersion: 3, items: [], planning: null }

export async function namesUnder(db: Database, projectId: string, parentId: string | null) {
  const rows = await db
    .select({ name: designNodes.name, parentId: designNodes.parentId })
    .from(designNodes)
    .where(eq(designNodes.projectId, projectId))
    .orderBy(asc(designNodes.seq))
  return rows.filter((r) => r.parentId === parentId).map((r) => r.name)
}

/**
 * Where a copy of a step goes: the nearest ancestor of its stage's parent kind (a plan under its
 * space, a white model under its plan), the same rule as the workbench's stageParentId. Old
 * projects nested plans under plans; their copies come back up a level instead of being refused.
 */
export async function stageParentOf(
  db: Database,
  node: { parentId: string | null; kind: NodeKind },
): Promise<string> {
  const kinds = STAGE_PARENT_KINDS[stageOf(node.kind)] ?? []
  let current = node.parentId
  for (let depth = 0; current && depth <= MAX_NODES_PER_PROJECT; depth++) {
    const row = await findNode(db, current)
    if (kinds.includes(row.kind)) return row.id
    current = row.parentId
  }
  throw new AppError('INVALID_STATE', '找不到这一步所属的上一层，无法另存')
}

/** Where a changed layout goes: a plan under the space, or a copy beside the current step. */
export async function saveLayout(
  tools: ToolContext,
  layout: Layout,
  what: string,
): Promise<ToolOutcome> {
  const node = tools.node
  if (!node) throw new AppError('INVALID_STATE', '没有当前节点，无法修改布局')
  if (node.kind === 'render') {
    throw new AppError('INVALID_STATE', '渲染节点不能修改，请先回到它的白模')
  }
  let parentId: string
  let kind: 'plan' | 'white'
  let base: string
  if (node.kind === 'space') {
    parentId = node.id
    kind = 'plan'
    base = '方案 · Agent'
  } else if (node.kind === 'white') {
    parentId = await stageParentOf(tools.db, node)
    kind = 'white'
    base = `${node.name.replace(/（\d+）$/, '')} · Agent`
  } else {
    parentId = await stageParentOf(tools.db, node)
    kind = 'plan'
    base = `${node.name.replace(/（\d+）$/, '')} · Agent`
  }
  const name = freshName(base, await namesUnder(tools.db, tools.project.id, parentId))
  const created = await createNode(
    tools.db,
    tools.ctx,
    tools.project.id,
    { parentId, kind, name, layout, sourceNodeId: node.id },
    { origin: 'agent' },
  )
  const errors = created.issues.filter((i) => i.severity === 'error')
  return {
    nodeId: created.node.id,
    result: {
      done: what,
      nodeId: created.node.id,
      nodeName: name,
      items: layout.items.length,
      issues: created.issues.map((i) => i.message),
      ...(errors.length
        ? { warning: `有 ${errors.length} 个问题需要处理，进入三维效果前须解决` }
        : {}),
    },
  }
}
