import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useSearchParams } from 'react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { Asset, DesignNode, Draft, NodeSummary, Project, ShopType, Space } from '@store/shared'
import { ErrorMessage } from '../../components/ErrorMessage.tsx'
import {
  deleteDraft,
  useCreateNode,
  useDraft,
  useNode,
  useCatalog,
  useTree,
  workbenchKeys,
} from './api.ts'
import { CandidateGallery, usePlanGeneration } from './CandidateGallery.tsx'
import { HistoryTree } from './HistoryTree.tsx'
import { PlanEditor } from './PlanEditor.tsx'
import { PlanView } from './PlanView.tsx'
import { ProjectCard } from './ProjectCard.tsx'
import { SpaceEditor } from './SpaceEditor.tsx'
import { StagePanel } from './StagePanel.tsx'
import { flattenTree, spaceAncestor } from './tree.ts'
import { WorkbenchLayout } from './WorkbenchLayout.tsx'

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
 * The project workbench in three columns: project, history and model list on the left, the
 * selected step in the middle, its stage actions and details on the right. The selected node
 * lives in the URL (`?node=`) so a reload or a shared link opens the same step.
 */
export function Workbench({ project }: { project: Project }) {
  const tree = useTree(project.id)
  const draft = useDraft(project.id)
  const assets = useCatalog()
  const [params, setParams] = useSearchParams()
  const [panel, setPanel] = useState<{ nodeId: string | null; kind: Panel }>({
    nodeId: null,
    kind: 'view',
  })

  const nodes = useMemo(() => tree.data?.nodes ?? [], [tree.data])
  const requested = params.get('node')
  // The automatic choice is made once, from the first loaded history, so nodes created later
  // (e.g. three generated plans) never move the selection away from what is on screen.
  const firstChoice = useRef<string | null>(null)
  if (firstChoice.current === null && nodes.length > 0 && draft.data !== undefined) {
    firstChoice.current = defaultNodeId(nodes, draft.data)
  }
  const fallback =
    firstChoice.current && nodes.some((n) => n.id === firstChoice.current)
      ? firstChoice.current
      : defaultNodeId(nodes, draft.data ?? null)
  const selectedId = requested && nodes.some((n) => n.id === requested) ? requested : fallback
  // Also pin it in the URL, so a reload or a shared link opens the same step.
  useEffect(() => {
    if (!requested && selectedId) setParams({ node: selectedId }, { replace: true })
  }, [requested, selectedId, setParams])

  // A panel opened for one node closes when another node is selected.
  const activePanel = panel.nodeId === selectedId ? panel.kind : 'view'
  const cardSpace = useNode(selectedId ? spaceAncestor(nodes, selectedId) : null)

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
  const left = (
    <>
      <ProjectCard project={project} space={cardSpace.data?.space ?? null} />
      <HistoryTree
        projectId={project.id}
        projectName={project.name}
        nodes={nodes}
        selectedId={selectedId}
        draftBaseId={draft.data?.baseNodeId ?? null}
        onSelect={select}
        onNewSpace={() => setPanel({ nodeId: selectedId, kind: 'new-space' })}
        newSpaceDisabled={creatingSpace}
      />
    </>
  )

  if (creatingSpace) {
    return (
      <WorkbenchLayout
        left={left}
        center={
          <div className="wb-card">
            <NewSpace
              projectId={project.id}
              first={nodes.length === 0}
              onCreated={select}
              onCancel={nodes.length ? () => setPanel({ nodeId: null, kind: 'view' }) : undefined}
            />
          </div>
        }
      />
    )
  }
  return selectedId ? (
    <NodePanel
      key={selectedId}
      left={left}
      project={project}
      nodeId={selectedId}
      nodes={nodes}
      draft={draft.data ?? null}
      assets={assets.data}
      panel={activePanel}
      setPanel={(kind) => setPanel({ nodeId: selectedId, kind })}
      onSelect={select}
    />
  ) : null
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
  left: ReactNode
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
  left,
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
  const space = spaceNode.data?.space
  if (error || !node.data || !space) {
    return (
      <WorkbenchLayout
        left={left}
        center={error ? <ErrorMessage error={error} /> : <p className="notice">正在加载节点…</p>}
      />
    )
  }
  const current = node.data

  if (current.kind === 'render') {
    const later = '渲染图与交付文件将在下一步接入'
    return (
      <WorkbenchLayout
        left={left}
        center={
          <ReadOnly node={current} space={space} shopType={project.shopType} assets={assetMap} />
        }
        right={
          <div className="wb-card">
            <StagePanel
              title="渲染阶段"
              first={[
                { label: '重新渲染', onClick: () => undefined, disabled: true, title: later },
                { label: '下载图片', onClick: () => undefined, disabled: true, title: later },
              ]}
              second={{
                label: '生成交付文件',
                onClick: () => undefined,
                disabled: true,
                primary: true,
                title: later,
              }}
              hint={`${later}。渲染节点保存了确认时的布局与视角，不能直接编辑；如需修改，请回到它的白模。`}
            />
          </div>
        }
      />
    )
  }

  // One shared draft per project: editing another step first needs the draft resolved.
  if (draft && draft.baseNodeId !== current.id) {
    return (
      <WorkbenchLayout
        left={left}
        center={
          <ReadOnly node={current} space={space} shopType={project.shopType} assets={assetMap} />
        }
        right={
          <div className="wb-card">
            <DraftElsewhere
              projectId={project.id}
              draft={draft}
              nodes={nodes}
              onSelect={onSelect}
            />
          </div>
        }
      />
    )
  }

  const editor = (
    <PlanEditor
      left={left}
      projectId={project.id}
      baseNode={current}
      space={space}
      shopType={project.shopType}
      nodes={nodes}
      siStyle={project.siStyle}
      draft={draft}
      assets={assets}
      onNodeCreated={onSelect}
    />
  )

  if (current.kind !== 'space') return editor

  if (panel === 'edit-space') {
    return (
      <WorkbenchLayout
        left={left}
        center={
          <div className="wb-card">
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
          </div>
        }
      />
    )
  }

  if (panel === 'manual' || draft) return editor

  return (
    <SpaceStage
      left={left}
      project={project}
      spaceNode={{ ...current, space }}
      assets={assetMap}
      existingNames={nodes.filter((n) => n.parentId === current.id).map((n) => n.name)}
      setPanel={setPanel}
      onSelect={onSelect}
    />
  )
}

/** A space: its plan in the middle; edit it, lay out by hand or generate three plans. */
function SpaceStage({
  left,
  project,
  spaceNode,
  assets,
  existingNames,
  setPanel,
  onSelect,
}: {
  left: ReactNode
  project: Project
  spaceNode: DesignNode & { space: Space }
  assets: ReadonlyMap<string, Asset>
  existingNames: readonly string[]
  setPanel: (panel: Panel) => void
  onSelect: (nodeId: string) => void
}) {
  const generation = usePlanGeneration({
    projectId: project.id,
    spaceNode,
    shopType: project.shopType,
    siStyle: project.siStyle,
    existingNames,
  })
  return (
    <WorkbenchLayout
      left={left}
      center={
        <div className="wb-card">
          <NodeHeading node={spaceNode} />
          <div className="space-summary">
            <PlanView
              space={spaceNode.space}
              shopType={project.shopType}
              layout={spaceNode.layout}
              assets={assets}
              title={`${spaceNode.name} 平面`}
            />
          </div>
          <CandidateGallery
            generation={generation}
            shopType={project.shopType}
            siStyle={project.siStyle}
            assets={assets}
            onChosen={onSelect}
          />
        </div>
      }
      right={
        <div className="wb-card">
          <StagePanel
            title="空间阶段"
            first={[
              { label: '修改空间', onClick: () => setPanel('edit-space') },
              { label: '手动排布', onClick: () => setPanel('manual') },
            ]}
            second={{
              label: generation.busy ? '正在生成…' : generation.label,
              onClick: generation.run,
              disabled: generation.busy,
              primary: true,
            }}
            hint="三个方案（尽量多放、按面积推荐、尽量少放）都会保存到方案层。"
          />
        </div>
      }
    />
  )
}

function NodeHeading({ node }: { node: DesignNode }) {
  return <h2 className="node-heading">{node.name}</h2>
}

function ReadOnly({
  node,
  space,
  shopType,
  assets,
}: {
  node: DesignNode
  space: Space
  shopType: ShopType
  assets: ReadonlyMap<string, Asset>
}) {
  return (
    <div className="wb-card">
      <NodeHeading node={node} />
      <div className="space-summary">
        <PlanView
          space={space}
          shopType={shopType}
          layout={node.layout}
          assets={assets}
          title={`${node.name} 平面`}
        />
      </div>
    </div>
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
      <h3>当前节点只读</h3>
      <p>
        项目里有一份基于「{base?.name ?? '未知节点'}」的草稿还没保存为版本。每个项目只保留一份草稿，
        处理后才能编辑当前节点。
      </p>
      <div className="stage-row">
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
