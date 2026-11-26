import { useContext, useRef, useState } from 'react'
import {
  itemFootprint,
  nextSpaceRevisionName,
  roundM,
  spaceAncestor,
  wallShift,
} from '@store/shared'
import type { DesignNode, Layout, NodeSummary, SiStyle, Space } from '@store/shared'
import type { useCreateNode } from '../api.ts'
import { ViewMemoryContext } from '../view-memory.ts'

/**
 * The layout in a changed space: a prop standing against a wall follows that wall (its back
 * stays on it), everything else stays where it was. Locked props never move. Props the new
 * walls cut through are left for the user; the checks flag them.
 */
export function followWalls(layout: Layout, before: Space, after: Space): Layout {
  return {
    ...layout,
    items: layout.items.map((item) => {
      if (item.locked) return item
      const [dx, dz] = wallShift(itemFootprint(item), before.boundary, after.boundary)
      return dx === 0 && dz === 0
        ? item
        : { ...item, cx: roundM(item.cx + dx), cz: roundM(item.cz + dz) }
    }),
  }
}

interface EditWallsOptions {
  baseNode: DesignNode
  nodes: NodeSummary[]
  space: Space
  siStyle: SiStyle
  /** The layout on screen (draft included). */
  layout: Layout
  create: ReturnType<typeof useCreateNode>
  flush: () => Promise<boolean>
  onNodeCreated: (nodeId: string) => void
}

/**
 * 修改墙体 in the plan stage. Walls belong to the space, so the change is saved as a new space
 * (a sibling of the current one, as 修改空间 does) with a plan under it carrying this layout; the
 * original space and plan and everything after them stay as they were. The 3D view of the
 * space carries over, and editing goes on in the new plan.
 */
export function useEditWalls({
  baseNode,
  nodes,
  space,
  siStyle,
  layout,
  create,
  flush,
  onNodeCreated,
}: EditWallsOptions) {
  const [editing, setEditing] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const savedSpace = useRef<{ input: string; id: string } | null>(null)
  const viewMemory = useContext(ViewMemoryContext)
  const spaceId = spaceAncestor(nodes, baseNode.id)
  const spaceNode = nodes.find((n) => n.id === spaceId)
  const spaceName = spaceNode?.name ?? '空间'
  // The new space is a sibling of the old one, under the same parent (10-16).
  const siblingParent = spaceNode?.parentId ?? null
  const spaceNames = nodes.filter((node) => node.kind === 'space').map((node) => node.name)

  async function submit(edited: Space, name: string) {
    setError(null)
    try {
      if (!spaceId) throw new Error('找不到当前方案关联的空间')
      if (!(await flush())) throw new Error('当前方案草稿尚未保存，请解决保存问题后重试')
      const input = JSON.stringify([name, edited])
      const prior = savedSpace.current
      // A failed second request can be retried without creating the same space again.
      const newSpaceId =
        prior?.input === input
          ? prior.id
          : (
              await create.mutateAsync({
                parentId: siblingParent,
                kind: 'space',
                sourceNodeId: spaceId,
                name,
                space: edited,
              })
            ).node.id
      savedSpace.current = { input, id: newSpaceId }
      const plan = await create.mutateAsync({
        parentId: newSpaceId,
        kind: 'plan',
        name: baseNode.name,
        layout: followWalls(layout, space, edited),
        siStyle,
      })
      savedSpace.current = null
      const view = viewMemory?.get(spaceId)
      if (view) viewMemory?.set(newSpaceId, view)
      setEditing(false)
      onNodeCreated(plan.node.id)
    } catch (caught) {
      setError(caught)
      throw caught
    }
  }

  return {
    editing,
    start: () => {
      setError(null)
      setEditing(true)
    },
    cancel: () => setEditing(false),
    submit,
    initialName: nextSpaceRevisionName(spaceName, spaceNames),
    error,
  }
}
