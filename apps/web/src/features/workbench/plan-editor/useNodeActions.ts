import { useEffect, useRef } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import { copyName, freshName, siSwapName, stageParentId, swapLayoutSi } from '@store/shared'
import type { Asset, DesignNode, Layout, NodeSummary, SiStyle, Stage } from '@store/shared'
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
  siStyle: SiStyle
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
  ) {
    setPaused(true)
    create.mutate(
      { ...input, layout, ...(input.kind === 'render' ? { siStyle } : {}) },
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

  /**
   * The SI style changed: a plan or white model is copied beside itself with every prop swapped
   * to its counterpart (SI_SWAP); the original stays as it was.
   */
  function switchSi(style: SiStyle): string | null {
    const parentId = stageParentId(nodes, baseNode)
    if (!parentId || (stage !== 'plan' && stage !== 'white')) return null
    const result = swapLayoutSi(currentLayout, style, assetMap)
    const kept = result.kept.length
      ? `${[...new Set(result.kept)].join('、')} 没有 ${style} 对应款，保留原样。`
      : ''
    if (!result.swapped) {
      return `已切换为 ${style}：当前${stage === 'plan' ? '方案' : '白模'}没有需要更换的软装道具。${kept}`
    }
    const name = freshName(siSwapName(baseNode.name, style), namesUnder(parentId))
    createFromLayout({ kind: stage, parentId, name, sourceNodeId: baseNode.id }, result.layout)
    return `已切换为 ${style}：另存为“${name}”，换了 ${result.swapped} 件道具，原节点保留。${kept}尺寸变化造成的越界或重叠见检查。`
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
