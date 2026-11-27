import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  freshName,
  LayoutSchema,
  SpaceSchema,
  nextHistoryName,
  nextRenderName,
  nextSpaceRevisionName,
  nodeSiStyle,
  sameLayoutProps,
  siSwapName,
  stageOf,
  stageParentId,
  swapLayoutSi,
} from '@store/shared'
import type {
  Asset,
  DesignNode,
  Draft,
  Layout,
  NodeSummary,
  SiStyle,
  Space,
  Stage,
} from '@store/shared'
import { nodeQuery, workbenchKeys } from '../api.ts'
import type { useCreateNode } from '../api.ts'
import type { SiSwitch, SwitchResult } from '../si-switch.ts'
import { EMPTY_LAYOUT } from './empty-layout.ts'

function spaceLayoutSnapshot(layout: Layout): string {
  return JSON.stringify(LayoutSchema.parse({ ...layout, fixtures: layout.fixtures ?? [] }))
}

interface NodeActionsOptions {
  space: Space
  baseNode: DesignNode
  /** The project's history, to place copies next to their original. */
  nodes: NodeSummary[]
  stage: Stage
  /** The layout on screen (draft included). */
  layout: Layout
  assetMap: Map<string, Asset>
  /** The step's own SI style (see nodeSiStyle). */
  siStyle: SiStyle
  /** The project's, for steps saved before nodes kept their style. */
  projectSi: SiStyle
  create: ReturnType<typeof useCreateNode>
  flush: () => Promise<boolean>
  onNodeCreated: (nodeId: string) => void
  onSpaceCopied?: ((nodeId: string) => void) | undefined
  onSpaceSiSwitched?: ((nodeId: string) => void) | undefined
  /** Lets the SI switch on the project card swap the props of this step. */
  onRegisterSiSwitch?: ((swap: SiSwitch | null) => void) | undefined
}

/** Creates history nodes from the current layout after saving the source node. */
export function useNodeActions({
  baseNode,
  space,
  nodes,
  stage,
  layout: currentLayout,
  assetMap,
  siStyle,
  projectSi,
  create,
  flush,
  onNodeCreated,
  onSpaceCopied,
  onSpaceSiSwitched,
  onRegisterSiSwitch,
}: NodeActionsOptions) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const creating = useRef(false)

  async function createFromLayout(
    input: {
      kind: 'space' | 'plan' | 'render'
      parentId: string | null
      name: string
      sourceNodeId?: string
      space?: Space
    },
    layout: Layout = currentLayout,
    style: SiStyle = siStyle,
    onCreated = onNodeCreated,
  ): Promise<{ ok: true; nodeId: string } | { ok: false; message: string }> {
    if (creating.current) return { ok: false, message: '请等待当前操作完成' }
    creating.current = true
    setBusy(true)
    setError(null)
    try {
      if (!(await flush())) return { ok: false, message: '当前节点的修改尚未保存' }
      const created = await create.mutateAsync({ ...input, layout, siStyle: style })
      onCreated(created.node.id)
      return { ok: true, nodeId: created.node.id }
    } catch (caught) {
      setError(caught)
      return {
        ok: false,
        message: caught instanceof Error ? caught.message : '服务器没有接受这次操作',
      }
    } finally {
      creating.current = false
      setBusy(false)
    }
  }

  const namesUnder = (parentId: string | null) =>
    nodes.filter((n) => n.parentId === parentId).map((n) => n.name)

  /** 新建副本: a sibling in the same stage with the current layout; editing goes on there. */
  function copyNode() {
    const parentId = stageParentId(nodes, baseNode)
    if (stage === 'space') {
      void createFromLayout(spaceSibling(), currentLayout, siStyle, onSpaceCopied ?? onNodeCreated)
      return
    }
    if (!parentId || stage !== 'plan') return
    void createFromLayout({
      kind: 'plan',
      parentId,
      name: nextHistoryName('plan', namesUnder(parentId)),
      sourceNodeId: baseNode.id,
    })
  }

  function spaceSibling() {
    return {
      kind: 'space' as const,
      parentId: baseNode.parentId,
      name: nextSpaceRevisionName(
        baseNode.name,
        nodes.filter((node) => node.kind === 'space').map((node) => node.name),
      ),
      sourceNodeId: baseNode.id,
      space,
    }
  }

  const client = useQueryClient()

  async function switchSpaceSi(style: SiStyle): Promise<SwitchResult> {
    if (!(await flush())) return { ok: false, message: '当前节点的修改尚未保存' }
    const open = onSpaceSiSwitched ?? onNodeCreated
    const related = nodes.filter(
      (node) =>
        node.kind === 'space' &&
        !node.hidden &&
        node.parentId === baseNode.parentId &&
        (node.id === baseNode.sourceNodeId || node.sourceNodeId === baseNode.id),
    )
    const candidates = await Promise.all(
      related.map(({ id }) => client.fetchQuery({ ...nodeQuery(id), staleTime: 0 })),
    )
    if (candidates.length)
      await client.refetchQueries({ queryKey: workbenchKeys.drafts(baseNode.projectId) })
    const drafts = client.getQueryData<Draft[]>(workbenchKeys.drafts(baseNode.projectId)) ?? []
    const outline = JSON.stringify(SpaceSchema.parse(space))
    const layout = spaceLayoutSnapshot(currentLayout)
    const match = candidates.find((node) => {
      const current = drafts.find(({ baseNodeId }) => baseNodeId === node.id)?.layout
      return (
        nodeSiStyle(node, projectSi) === style &&
        node.space !== null &&
        JSON.stringify(SpaceSchema.parse(node.space)) === outline &&
        spaceLayoutSnapshot(current ?? node.layout ?? EMPTY_LAYOUT) === layout
      )
    })
    if (match) {
      open(match.id)
      return { ok: true, message: `已回到 ${style} 的“${match.name}”。` }
    }
    const input = spaceSibling()
    const created = await createFromLayout(input, currentLayout, style, open)
    return created.ok
      ? { ok: true, message: `已切换为 ${style}，另存空间“${input.name}”。` }
      : { ok: false, message: `切换失败：${created.message}。` }
  }

  /**
   * The SI switch on a plan (每个节点各自对应一个 SI):
   * - this step untouched since it was switched from a sibling of that style: back to the
   *   sibling (this one stays in the history);
   * - an untouched switched copy of this step in that style already there: on to it;
   * - otherwise a new sibling with every prop swapped to its counterpart (SI_SWAP), made from the
   *   layout on screen; overlaps from the new sizes are only reported. The original stays.
   */
  async function switchSi(style: SiStyle): Promise<SwitchResult> {
    if (stage === 'space') return switchSpaceSi(style)
    const parentId = stageParentId(nodes, baseNode)
    if (!parentId || stage !== 'plan') {
      return { ok: true, message: null }
    }
    if (!(await flush())) return { ok: false, message: '当前节点的修改尚未保存' }
    const siblings = await Promise.all(
      nodes
        .filter(
          (n) => stageOf(n.kind) === 'plan' && !n.hidden && stageParentId(nodes, n) === parentId,
        )
        .filter((n) => n.id !== baseNode.id)
        .map((n) => client.fetchQuery(nodeQuery(n.id))),
    )
    const drafts = client.getQueryData<Draft[]>(workbenchKeys.drafts(baseNode.projectId)) ?? []
    const buildingChoices = (value: Space | null) => {
      const saved = value ? SpaceSchema.parse(value) : null
      return JSON.stringify([saved?.facade, saved?.ceiling])
    }
    const originalBuilding = buildingChoices(space)
    const ofStyle = siblings
      .filter(
        (n) => nodeSiStyle(n, projectSi) === style && buildingChoices(n.space) === originalBuilding,
      )
      .map((n) => ({
        ...n,
        layout: drafts.find((draft) => draft.baseNodeId === n.id)?.layout ?? n.layout,
      }))
      .filter((n) => n.layout)
    const untouched = baseNode.layout ? sameLayoutProps(currentLayout, baseNode.layout) : false
    if (untouched && baseNode.layout) {
      const own = baseNode.layout
      const origin = ofStyle.find(
        (n) => n.layout && sameLayoutProps(swapLayoutSi(n.layout, siStyle, assetMap).layout, own),
      )
      if (origin) {
        onNodeCreated(origin.id)
        return {
          ok: true,
          message: `已回到 ${style} 的“${origin.name}”：“${baseNode.name}”换款后没有修改，保留在历史中。`,
        }
      }
    }
    const result = swapLayoutSi(currentLayout, style, assetMap)
    const twin = ofStyle.find((n) => n.layout && sameLayoutProps(n.layout, result.layout))
    if (twin) {
      onNodeCreated(twin.id)
      return {
        ok: true,
        message: `已切到 ${style} 的“${twin.name}”：它就是当前方案换款后的样子，没有另存。`,
      }
    }
    const kept = result.kept.length
      ? `${[...new Set(result.kept)].join('、')} 没有 ${style} 对应款，保留原样。`
      : ''
    const name = freshName(siSwapName(baseNode.name, style), namesUnder(parentId))
    const created = await createFromLayout(
      {
        kind: 'plan',
        parentId,
        name,
        sourceNodeId: baseNode.id,
      },
      result.layout,
      style,
    )
    if (!created.ok) {
      return { ok: false, message: `切换失败：${created.message}，没有新建节点。` }
    }
    return {
      ok: true,
      message: result.swapped
        ? `已切换为 ${style}：另存为“${name}”，换了 ${result.swapped} 件道具，原节点保留。${kept}尺寸变化造成的越界或重叠见检查。`
        : `已切换为 ${style}：另存为“${name}”，没有需要更换的软装道具，原节点保留。${kept}`,
    }
  }
  const switchRef = useRef(switchSi)
  switchRef.current = switchSi
  useEffect(() => {
    onRegisterSiSwitch?.((style) => switchRef.current(style))
    return () => onRegisterSiSwitch?.(null)
  }, [onRegisterSiSwitch])

  function advance() {
    if (stage === 'plan') {
      void createFromLayout({
        kind: 'render',
        parentId: baseNode.id,
        name: nextRenderName(namesUnder(baseNode.id)),
      })
    } else if (stage === 'space') {
      void createFromLayout({
        kind: 'plan',
        parentId: baseNode.id,
        name: nextHistoryName('plan', namesUnder(baseNode.id)),
      })
    }
  }

  return { copyNode, advance, busy, error }
}
