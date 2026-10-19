import { useEffect, useRef } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  copyName,
  freshName,
  nodeSiStyle,
  sameLayoutProps,
  siSwapName,
  stageParentId,
  swapLayoutSi,
} from '@store/shared'
import type { Asset, DesignNode, Layout, NodeSummary, SiStyle, Stage } from '@store/shared'
import { nodeQuery } from '../api.ts'
import type { useCreateNode } from '../api.ts'
import type { SiSwitch } from '../si-switch.ts'

interface NodeActionsOptions {
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
  setPaused: Dispatch<SetStateAction<boolean>>
  finishDraft: () => Promise<void>
  onNodeCreated: (nodeId: string) => void
  /** Lets the SI switch on the project card swap the props of this step. */
  onRegisterSiSwitch?: ((swap: SiSwitch | null) => void) | undefined
}

/**
 * New history nodes made from the editor: 新建副本, the SI switch, and the next stage
 * (保存为方案, 进入三维效果, 开始渲染).
 */
export function useNodeActions({
  baseNode,
  nodes,
  stage,
  layout: currentLayout,
  assetMap,
  siStyle,
  projectSi,
  create,
  setPaused,
  finishDraft,
  onNodeCreated,
  onRegisterSiSwitch,
}: NodeActionsOptions) {
  /**
   * Creates a history node from the layout on screen (draft included), or from the layout
   * given, then drops the draft.
   */
  function createFromLayout(
    input: {
      kind: 'plan' | 'white' | 'render'
      parentId: string
      name: string
      sourceNodeId?: string
    },
    layout: Layout = currentLayout,
    style: SiStyle = siStyle,
  ) {
    setPaused(true)
    // Every step keeps its own SI style: switching on one never changes another.
    create.mutate(
      { ...input, layout, siStyle: style },
      {
        onSuccess: (created) => void finishDraft().then(() => onNodeCreated(created.node.id)),
        onError: () => setPaused(false),
      },
    )
  }

  const namesUnder = (parentId: string | null) =>
    nodes.filter((n) => n.parentId === parentId).map((n) => n.name)

  /** 新建副本: a sibling in the same stage with the current layout; editing goes on there. */
  function copyNode() {
    const parentId = stageParentId(nodes, baseNode)
    if (!parentId || (stage !== 'plan' && stage !== 'white')) return
    createFromLayout({
      kind: stage,
      parentId,
      name: copyName(baseNode.name, namesUnder(parentId)),
      sourceNodeId: baseNode.id,
    })
  }

  const client = useQueryClient()

  /**
   * The SI switch on a plan or white model (每个节点各自对应一个 SI):
   * - this step untouched since it was switched from a sibling of that style: back to the
   *   sibling (this one stays in the history);
   * - an untouched switched copy of this step in that style already there: on to it;
   * - otherwise a new sibling with every prop swapped to its counterpart (SI_SWAP), made from the
   *   layout on screen; overlaps from the new sizes are only reported. The original stays.
   */
  async function switchSi(style: SiStyle): Promise<string | null> {
    const parentId = stageParentId(nodes, baseNode)
    if (!parentId || (stage !== 'plan' && stage !== 'white')) return null
    const siblings = await Promise.all(
      nodes
        .filter((n) => n.parentId === parentId && n.kind === stage && !n.hidden)
        .filter((n) => n.id !== baseNode.id)
        .map((n) => client.fetchQuery(nodeQuery(n.id))),
    )
    const ofStyle = siblings.filter((n) => n.layout && nodeSiStyle(n, projectSi) === style)
    const untouched = baseNode.layout ? sameLayoutProps(currentLayout, baseNode.layout) : false
    if (untouched && baseNode.layout) {
      const own = baseNode.layout
      const origin = ofStyle.find(
        (n) => n.layout && sameLayoutProps(swapLayoutSi(n.layout, siStyle, assetMap).layout, own),
      )
      if (origin) {
        onNodeCreated(origin.id)
        return `已回到 ${style} 的“${origin.name}”：“${baseNode.name}”换款后没有修改，保留在历史中。`
      }
    }
    const result = swapLayoutSi(currentLayout, style, assetMap)
    const twin = ofStyle.find((n) => n.layout && sameLayoutProps(n.layout, result.layout))
    if (twin) {
      onNodeCreated(twin.id)
      return `已切到 ${style} 的“${twin.name}”：它就是当前${stage === 'plan' ? '方案' : '白模'}换款后的样子，没有另存。`
    }
    const kept = result.kept.length
      ? `${[...new Set(result.kept)].join('、')} 没有 ${style} 对应款，保留原样。`
      : ''
    const name = freshName(siSwapName(baseNode.name, style), namesUnder(parentId))
    createFromLayout(
      { kind: stage, parentId, name, sourceNodeId: baseNode.id },
      result.layout,
      style,
    )
    return result.swapped
      ? `已切换为 ${style}：另存为“${name}”，换了 ${result.swapped} 件道具，原节点保留。${kept}尺寸变化造成的越界或重叠见检查。`
      : `已切换为 ${style}：另存为“${name}”，没有需要更换的软装道具，原节点保留。${kept}`
  }
  const switchRef = useRef(switchSi)
  switchRef.current = switchSi
  useEffect(() => {
    onRegisterSiSwitch?.((style) => switchRef.current(style))
    return () => onRegisterSiSwitch?.(null)
  }, [onRegisterSiSwitch])

  /** The next stage, one level down: plan → white model → render. */
  function advance() {
    if (stage === 'plan') {
      createFromLayout({
        kind: 'white',
        parentId: baseNode.id,
        name: freshName('三维效果', namesUnder(baseNode.id)),
      })
    } else if (stage === 'white') {
      createFromLayout({
        kind: 'render',
        parentId: baseNode.id,
        name: freshName('渲染', namesUnder(baseNode.id)),
      })
    } else if (stage === 'space') {
      createFromLayout({
        kind: 'plan',
        parentId: baseNode.id,
        name: freshName('方案 · 手动排布', namesUnder(baseNode.id)),
      })
    }
  }

  return { copyNode, advance }
}
