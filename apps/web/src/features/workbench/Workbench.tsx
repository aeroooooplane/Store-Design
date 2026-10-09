import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { useSearchParams } from 'react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { Asset, DesignNode, Draft, NodeSummary, Project, Space } from '@store/shared'
import { ErrorMessage } from '../../components/ErrorMessage.tsx'
import {
  deleteDraft,
  useCreateNode,
  useDraft,
  useNode,
  usePlaceableAssets,
  useTree,
  workbenchKeys,
} from './api.ts'
import { CandidateGallery } from './CandidateGallery.tsx'
import { HistoryTree } from './HistoryTree.tsx'
import { PlanEditor } from './PlanEditor.tsx'
import { PlanView } from './PlanView.tsx'
import { SpaceEditor } from './SpaceEditor.tsx'
import { flattenTree, spaceAncestor } from './tree.ts'

type Panel = 'view' | 'new-space' | 'edit-space' | 'manual'

/** Where to land without an explicit choice: the draft's base, else the newest visible step. */
export function defaultNodeId(nodes: NodeSummary[], draft: Draft | null): string | null {
  if (draft && nodes.some((n) => n.id === draft.baseNodeId)) return draft.baseNodeId
  // Nodes arrive in creation order; skip anything folded away in the tree.
  const shown = new Set(
    flattenTree(nodes)
      .filter((e) => !e.hiddenBranch)
      .map((e) => e.node.id),
  )
  const visible = nodes.filter((n) => shown.has(n.id))
  return (visible[visible.length - 1] ?? nodes[nodes.length - 1])?.id ?? null
}

/**
 * The project workbench: history tree on the left, the selected step on the right. The
 * selected node lives in the URL (`?node=`) so a reload or a shared link opens the same step.
 */
export function Workbench({ project }: { project: Project }) {
  const tree = useTree(project.id)
  const draft = useDraft(project.id)
  const assets = usePlaceableAssets()
  const [params, setParams] = useSearchParams()
  const [panel, setPanel] = useState<{ nodeId: string | null; kind: Panel }>({
    nodeId: null,
    kind: 'view',
  })

  const nodes = useMemo(() => tree.data?.nodes ?? [], [tree.data])
  const requested = params.get('node')
  const selectedId =
    requested && nodes.some((n) => n.id === requested)
      ? requested
      : defaultNodeId(nodes, draft.data ?? null)
  // A panel opened for one node closes when another node is selected.
  const activePanel = panel.nodeId === selectedId ? panel.kind : 'view'

  function select(nodeId: string) {
    setParams({ node: nodeId })
    setPanel({ nodeId, kind: 'view' })
  }

  const loadError = tree.error ?? draft.error ?? assets.error
  if (loadError) return <ErrorMessage error={loadError} />
  if (!tree.data || draft.data === undefined || !assets.data) {
    return <p className="notice">正在加载工作台…</p>
  }

  const creatingSpace = nodes.length === 0 || activePanel === 'new-space'

  return (
    <div className="workbench">
      <aside className="workbench-side">
        <HistoryTree
          projectId={project.id}
          nodes={nodes}
          selectedId={selectedId}
          draftBaseId={draft.data?.baseNodeId ?? null}
          onSelect={select}
        />
        <button
          type="button"
          disabled={creatingSpace}
          onClick={() => setPanel({ nodeId: selectedId, kind: 'new-space' })}
        >
          新建空间
        </button>
      </aside>
      <section className="workbench-main">
        {creatingSpace ? (
          <NewSpace
            projectId={project.id}
            first={nodes.length === 0}
            onCreated={select}
            onCancel={nodes.length ? () => setPanel({ nodeId: null, kind: 'view' }) : undefined}
          />
        ) : selectedId ? (
          <NodePanel
            key={selectedId}
            project={project}
            nodeId={selectedId}
            nodes={nodes}
            draft={draft.data ?? null}
            assets={assets.data}
            panel={activePanel}
            setPanel={(kind) => setPanel({ nodeId: selectedId, kind })}
            onSelect={select}
          />
        ) : null}
      </section>
    </div>
  )
}

function NewSpace({
  projectId,
  first,
  onCreated,
  onCancel,
}: {
  projectId: string
  first: boolean
  onCreated: (nodeId: string) => void
  onCancel?: (() => void) | undefined
}) {
  const create = useCreateNode(projectId)
  return (
    <>
      <h2>{first ? '第一步：录入空间' : '新建空间'}</h2>
      <p className="hint">按平面图录入尺寸（毫米）。保存后可以自动生成排布方案，也可以手动摆放。</p>
      <ErrorMessage error={create.error} />
      <SpaceEditor
        submitting={create.isPending}
        onCancel={onCancel}
        onSubmit={(space, name) =>
          create.mutate(
            { parentId: null, kind: 'space', name, space },
            { onSuccess: (created) => onCreated(created.node.id) },
          )
        }
      />
    </>
  )
}

interface NodePanelProps {
  project: Project
  nodeId: string
  nodes: NodeSummary[]
  draft: Draft | null
  assets: Asset[]
  panel: Panel
  setPanel: (panel: Panel) => void
  onSelect: (nodeId: string) => void
}

function NodePanel({
  project,
  nodeId,
  nodes,
  draft,
  assets,
  panel,
  setPanel,
  onSelect,
}: NodePanelProps) {
  const node = useNode(nodeId)
  const spaceNode = useNode(spaceAncestor(nodes, nodeId))
  const create = useCreateNode(project.id)
  const assetMap = useMemo(() => new Map(assets.map((a) => [a.id, a])), [assets])

  const error = node.error ?? spaceNode.error
  if (error) return <ErrorMessage error={error} />
  const space = spaceNode.data?.space
  if (!node.data || !space) return <p className="notice">正在加载节点…</p>
  const current = node.data

  if (current.kind === 'render') {
    return (
      <ReadOnly node={current} space={space} assets={assetMap}>
        渲染节点是输出结果；如需修改，请选择它的上一步继续编辑。
      </ReadOnly>
    )
  }

  // One shared draft per project: editing another step first needs the draft resolved.
  if (draft && draft.baseNodeId !== current.id) {
    return (
      <ReadOnly node={current} space={space} assets={assetMap}>
        <DraftElsewhere projectId={project.id} draft={draft} nodes={nodes} onSelect={onSelect} />
      </ReadOnly>
    )
  }

  const editor = (
    <PlanEditor
      projectId={project.id}
      baseNode={current}
      space={space}
      draft={draft}
      assets={assets}
      onNodeCreated={onSelect}
    />
  )

  if (current.kind !== 'space') {
    return (
      <>
        <NodeHeading node={current} />
        {editor}
      </>
    )
  }

  if (panel === 'edit-space') {
    return (
      <>
        <h2>修改空间</h2>
        <p className="hint">修改会保存为新的空间节点，原空间及其方案保持不变。</p>
        <ErrorMessage error={create.error} />
        <SpaceEditor
          initial={space}
          submitting={create.isPending}
          onCancel={() => setPanel('view')}
          onSubmit={(edited, name) =>
            create.mutate(
              { parentId: current.id, kind: 'space', name, space: edited },
              { onSuccess: (created) => onSelect(created.node.id) },
            )
          }
        />
      </>
    )
  }

  if (panel === 'manual' || draft) {
    return (
      <>
        <NodeHeading node={current} />
        {editor}
      </>
    )
  }

  return (
    <>
      <NodeHeading node={current} />
      <div className="toolbar">
        <button type="button" onClick={() => setPanel('edit-space')}>
          修改空间
        </button>
        <button type="button" onClick={() => setPanel('manual')}>
          手动排布
        </button>
      </div>
      <div className="space-summary">
        <PlanView
          space={space}
          layout={current.layout}
          assets={assetMap}
          title={`${current.name} 平面`}
        />
      </div>
      <CandidateGallery
        projectId={project.id}
        spaceNode={{ ...current, space }}
        shopType={project.shopType}
        siStyle={project.siStyle}
        assets={assetMap}
        onChosen={onSelect}
      />
    </>
  )
}

function NodeHeading({ node }: { node: DesignNode }) {
  return <h2 className="node-heading">{node.name}</h2>
}

function ReadOnly({
  node,
  space,
  assets,
  children,
}: {
  node: DesignNode
  space: Space
  assets: ReadonlyMap<string, Asset>
  children: ReactNode
}) {
  return (
    <>
      <NodeHeading node={node} />
      <div className="notice">{children}</div>
      <div className="space-summary">
        <PlanView space={space} layout={node.layout} assets={assets} title={`${node.name} 平面`} />
      </div>
    </>
  )
}

function DraftElsewhere({
  projectId,
  draft,
  nodes,
  onSelect,
}: {
  projectId: string
  draft: Draft
  nodes: NodeSummary[]
  onSelect: (nodeId: string) => void
}) {
  const client = useQueryClient()
  const discard = useMutation({
    mutationFn: () => deleteDraft(projectId, draft.revision),
    onSuccess: () => client.setQueryData(workbenchKeys.draft(projectId), null),
    // A stale revision means someone else changed the draft: show them the latest one.
    onError: () => client.invalidateQueries({ queryKey: workbenchKeys.draft(projectId) }),
  })
  const base = nodes.find((n) => n.id === draft.baseNodeId)

  return (
    <div className="draft-elsewhere">
      <p>
        项目里有一份基于「{base?.name ?? '未知节点'}」的草稿还没保存为版本。每个项目只保留一份草稿，
        处理后才能编辑当前节点。
      </p>
      <div className="toolbar">
        <button type="button" className="primary" onClick={() => onSelect(draft.baseNodeId)}>
          转到草稿
        </button>
        <button
          type="button"
          disabled={discard.isPending}
          onClick={() => {
            if (window.confirm('丢弃后草稿中的修改无法恢复，确定丢弃吗？')) discard.mutate()
          }}
        >
          丢弃草稿
        </button>
      </div>
      <ErrorMessage error={discard.error} />
    </div>
  )
}
