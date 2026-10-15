import { useContext, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import { freshName, itemFootprint, roundM, spaceAncestor, wallShift } from '@store/shared'
import type { DesignNode, Layout, NodeSummary, Space } from '@store/shared'
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
  /** The layout on screen (draft included). */
  layout: Layout
  create: ReturnType<typeof useCreateNode>
  setPaused: Dispatch<SetStateAction<boolean>>
  finishDraft: () => Promise<void>
  onNodeCreated: (nodeId: string) => void
}

/**
 * 修改墙体 in the plan stage. Walls belong to the space, so the change is saved as a new space
 * (under the current one, as 修改空间 does) with a plan under it carrying this layout; the
 * original space and plan and everything after them stay as they were. The 3D view of the
 * space carries over, and editing goes on in the new plan.
 */
export function useEditWalls({
  baseNode,
  nodes,
  space,
  layout,
  create,
  setPaused,
  finishDraft,
  onNodeCreated,
}: EditWallsOptions) {
  const [editing, setEditing] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const viewMemory = useContext(ViewMemoryContext)
  const spaceId = spaceAncestor(nodes, baseNode.id)
  const spaceName = nodes.find((n) => n.id === spaceId)?.name ?? '空间'
  const namesUnder = (parentId: string | null) =>
    nodes.filter((n) => n.parentId === parentId).map((n) => n.name)

  async function submit(edited: Space, name: string) {
    if (!spaceId) return
    setError(null)
    setPaused(true)
    try {
      const newSpace = await create.mutateAsync({
        parentId: spaceId,
        kind: 'space',
        name,
        space: edited,
      })
      const plan = await create.mutateAsync({
        parentId: newSpace.node.id,
        kind: 'plan',
        name: baseNode.name,
        layout: followWalls(layout, space, edited),
      })
      const view = viewMemory?.get(spaceId)
      if (view) viewMemory?.set(newSpace.node.id, view)
      await finishDraft()
      setEditing(false)
      onNodeCreated(plan.node.id)
    } catch (caught) {
      setError(caught)
      setPaused(false)
    }
  }

  return {
    editing,
    start: () => setEditing(true),
    cancel: () => setEditing(false),
    submit: (edited: Space, name: string) => void submit(edited, name),
    initialName: freshName(`${spaceName} · 改墙`, namesUnder(spaceId)),
    submitting: create.isPending,
    error,
  }
}
