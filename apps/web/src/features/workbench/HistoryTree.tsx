import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import {
  Eye,
  EyeOff,
  Maximize2,
  Minimize2,
  PanelTopClose,
  PanelTopOpen,
  Pencil,
  Plus,
  RotateCcw,
} from 'lucide-react'
import { NODE_KIND_LABELS } from '@store/shared'
import type { NodeSummary } from '@store/shared'
import { ErrorMessage } from '../../components/ErrorMessage.tsx'
import { useNodeVisibility, useRenameNode } from './api.ts'
import { ROOT_ID, TREE_STYLE, applyOffsets, layoutRadial, layoutTree } from './tree-layout.ts'
import type { PlacedTree, TreeOffsets } from './tree-layout.ts'

interface HistoryViewMemory {
  showHidden: boolean
  collapsed: boolean
  enlarged: boolean
  offsets: TreeOffsets
  frame: { topology: string; projectId: string; bounds: PlacedTree }
}

const HistoryViewContext = createContext<Map<string, HistoryViewMemory> | null>(null)

/** NodePanel is keyed by node ID; keep the history view alive across those remounts. */
export function HistoryViewProvider({ children }: { children: ReactNode }) {
  const memory = useRef(new Map<string, HistoryViewMemory>())
  return (
    <HistoryViewContext.Provider value={memory.current}>{children}</HistoryViewContext.Provider>
  )
}

/** A square icon button; the label is its accessible name and its tooltip. */
function IconButton({
  label,
  hint,
  pressed,
  expanded,
  disabled,
  onClick,
  children,
}: {
  label: string
  hint?: string
  pressed?: boolean
  expanded?: boolean
  disabled?: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      className="icon-button"
      aria-label={label}
      title={hint ?? label}
      aria-pressed={pressed}
      aria-expanded={expanded}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

interface HistoryTreeProps {
  projectId: string
  projectName: string
  nodes: NodeSummary[]
  selectedId: string | null
  draftBaseId: string | null
  onSelect: (nodeId: string) => void
  onNewSpace: () => void
  newSpaceDisabled: boolean
}

/** "方案 · 按面积推荐" stays as it is; a bare name gets its kind in front. */
export function nodeLabel(node: NodeSummary): string {
  const kind = NODE_KIND_LABELS[node.kind]
  return node.name.startsWith(kind) ? node.name : `${kind} · ${node.name}`
}

/** Dragged positions are remembered per project in this browser (用户 2026-10-10). */
const offsetsKey = (projectId: string) => `store-design:tree-offsets:${projectId}`

function loadOffsets(projectId: string): TreeOffsets {
  try {
    const raw = window.localStorage.getItem(offsetsKey(projectId))
    const parsed: unknown = raw ? JSON.parse(raw) : {}
    if (!parsed || typeof parsed !== 'object') return {}
    const offsets: Record<string, readonly [number, number]> = {}
    for (const [id, value] of Object.entries(parsed)) {
      if (Array.isArray(value) && value.length === 2 && value.every(Number.isFinite)) {
        offsets[id] = [Number(value[0]), Number(value[1])]
      }
    }
    return offsets
  } catch {
    return {}
  }
}

function saveOffsets(projectId: string, offsets: TreeOffsets) {
  try {
    window.localStorage.setItem(offsetsKey(projectId), JSON.stringify(offsets))
  } catch {
    // Private mode or a full store: positions are simply not remembered.
  }
}

/**
 * The project history as a tree diagram (style: TREE_STYLE in tree-layout.ts). Every step is
 * kept; hiding only folds a branch away. Click a step to open it; drag it to move it.
 */
export function HistoryTree({
  projectId,
  projectName,
  nodes,
  selectedId,
  draftBaseId,
  onSelect,
  onNewSpace,
  newSpaceDisabled,
}: HistoryTreeProps) {
  const memory = useContext(HistoryViewContext)
  const remembered = memory?.get(projectId)
  const [showHidden, setShowHidden] = useState(remembered?.showHidden ?? false)
  const [collapsed, setCollapsed] = useState(remembered?.collapsed ?? false)
  const [enlarged, setEnlarged] = useState(remembered?.enlarged ?? false)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [offsets, setOffsets] = useState<TreeOffsets>(
    () => remembered?.offsets ?? loadOffsets(projectId),
  )
  const visibility = useNodeVisibility(projectId)
  const rename = useRenameNode(projectId)
  const [tooltip, setTooltip] = useState<{ id: string; x: number; y: number } | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const drag = useRef<{
    id: string
    nodeId: string | null
    startX: number
    startY: number
    screenX: number
    screenY: number
    origin: readonly [number, number]
    moved: boolean
    pointerId: number
  } | null>(null)

  const base = useMemo(
    () =>
      (TREE_STYLE.layout === 'radial' ? layoutRadial : layoutTree)(
        projectName,
        nodes,
        nodeLabel,
        showHidden,
      ),
    [projectName, nodes, showHidden],
  )
  const layout = useMemo(() => applyOffsets(base, offsets), [base, offsets])
  const selected = nodes.find((n) => n.id === selectedId) ?? null
  // Selection and dragging never change the viewport; topology changes and reset may fit it.
  const topology = JSON.stringify([
    projectId,
    showHidden,
    nodes.map((n) => [n.id, n.parentId, n.hidden]),
  ])
  const [frame, setFrame] = useState(
    () => remembered?.frame ?? { topology, projectId, bounds: layout },
  )
  if (frame.topology !== topology) {
    const remembered = frame.projectId === projectId ? offsets : loadOffsets(projectId)
    if (frame.projectId !== projectId) setOffsets(remembered)
    setFrame({ topology, projectId, bounds: applyOffsets(base, remembered) })
  }
  useLayoutEffect(() => {
    memory?.set(projectId, { showHidden, collapsed, enlarged, offsets, frame })
  }, [memory, projectId, showHidden, collapsed, enlarged, offsets, frame])
  useEffect(() => {
    const ids = new Set([ROOT_ID, ...nodes.map((node) => node.id)])
    const retained = Object.fromEntries(Object.entries(offsets).filter(([id]) => ids.has(id)))
    if (Object.keys(retained).length !== Object.keys(offsets).length) {
      setOffsets(retained)
      saveOffsets(projectId, retained)
    }
  }, [nodes, offsets, projectId])
  const width = Math.max(280, frame.bounds.width)
  const height = Math.max(260, frame.bounds.height)
  const viewX = frame.bounds.x - (width - frame.bounds.width) / 2
  const viewY = frame.bounds.y - (height - frame.bounds.height) / 2
  const related = new Set<string>()
  const ancestors: NodeSummary[] = []
  let ancestor = selected
  while (ancestor && !related.has(ancestor.id)) {
    related.add(ancestor.id)
    ancestors.unshift(ancestor)
    ancestor = nodes.find((n) => n.id === ancestor?.parentId) ?? null
  }
  if (selected) related.add(ROOT_ID)
  const descendants = selectedId ? [selectedId] : []
  const visited = new Set<string>()
  while (descendants.length) {
    const id = descendants.pop()!
    if (visited.has(id)) continue
    visited.add(id)
    related.add(id)
    descendants.push(...nodes.filter((n) => n.parentId === id).map((n) => n.id))
  }
  const hovered = layout.boxes.find((box) => box.id === tooltip?.id)
  const pathLabel = [projectName, ...ancestors.map(nodeLabel)].join(' › ')

  function showTooltip(id: string, target: SVGGElement) {
    const rect = target.getBoundingClientRect()
    setTooltip({
      id,
      x: Math.max(8, Math.min(window.innerWidth - 248, rect.x + rect.width / 2 - 120)),
      y: Math.max(8, Math.min(window.innerHeight - 100, rect.bottom + 8)),
    })
  }

  useEffect(() => {
    if (!enlarged) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setEnlarged(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [enlarged])

  /** Pointer position in drawing units (the drawing may be scaled to fit the panel). */
  function toDrawing(event: { clientX: number; clientY: number }): [number, number] {
    const matrix = svgRef.current?.getScreenCTM?.()
    if (!matrix) return [event.clientX, event.clientY]
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse())
    return [point.x, point.y]
  }

  function onPointerDown(event: ReactPointerEvent<SVGGElement>, id: string, nodeId: string | null) {
    if (event.button !== 0) return
    const [x, y] = toDrawing(event)
    drag.current = {
      id,
      nodeId,
      startX: x,
      startY: y,
      screenX: event.clientX,
      screenY: event.clientY,
      origin: offsets[id] ?? [0, 0],
      moved: false,
      pointerId: event.pointerId,
    }
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }

  function onPointerMove(event: ReactPointerEvent<SVGGElement>) {
    const d = drag.current
    if (!d || d.pointerId !== event.pointerId) return
    const [x, y] = toDrawing(event)
    const dx = x - d.startX
    const dy = y - d.startY
    if (
      !d.moved &&
      Math.hypot(event.clientX - d.screenX, event.clientY - d.screenY) < TREE_STYLE.dragThreshold
    )
      return
    d.moved = true
    setTooltip(null)
    setOffsets((current) => ({ ...current, [d.id]: [d.origin[0] + dx, d.origin[1] + dy] }))
  }

  function onPointerUp(event: ReactPointerEvent<SVGGElement>) {
    if (drag.current?.pointerId !== event.pointerId) return
    const d = drag.current
    drag.current = null
    if (!d) return
    if (d.moved) {
      setOffsets((current) => {
        saveOffsets(projectId, current)
        return current
      })
    } else if (d.nodeId) {
      onSelect(d.nodeId)
    }
  }

  function resetPositions() {
    setOffsets({})
    saveOffsets(projectId, {})
    setFrame({ topology, projectId, bounds: applyOffsets(base, {}) })
  }

  const hasOffsets = Object.keys(offsets).length > 0
  return (
    <section className={enlarged ? 'history enlarged' : 'history'} aria-label="历史树">
      <div className="history-head">
        {renaming !== null && selected ? (
          <form
            className="history-rename"
            onSubmit={(event) => {
              event.preventDefault()
              const name = renaming.trim()
              if (name) {
                rename.mutate({ nodeId: selected.id, name }, { onSuccess: () => setRenaming(null) })
              }
            }}
          >
            <input
              aria-label="节点名称"
              value={renaming}
              maxLength={100}
              onChange={(e) => setRenaming(e.target.value)}
            />
            <button type="submit" disabled={rename.isPending}>
              确定
            </button>
            <button type="button" onClick={() => setRenaming(null)}>
              取消
            </button>
          </form>
        ) : (
          <div className="history-icons" role="toolbar" aria-label="历史操作">
            {selected && (
              <IconButton label="改名" onClick={() => setRenaming(selected.name)}>
                <Pencil size={15} />
              </IconButton>
            )}
            {selected && (
              <IconButton
                label={selected.hidden ? '恢复显示' : '隐藏'}
                disabled={visibility.isPending}
                onClick={() => visibility.mutate({ nodeId: selected.id, hidden: !selected.hidden })}
              >
                {selected.hidden ? <Eye size={15} /> : <EyeOff size={15} />}
              </IconButton>
            )}
            <IconButton label="新建空间" disabled={newSpaceDisabled} onClick={onNewSpace}>
              <Plus size={15} />
            </IconButton>
            <IconButton
              label="重置位置"
              hint="一键归位，恢复自动排列"
              disabled={!hasOffsets}
              onClick={resetPositions}
            >
              <RotateCcw size={15} />
            </IconButton>
            <span className="history-icons-end">
              <IconButton
                label={enlarged ? '还原' : '放大'}
                pressed={enlarged}
                onClick={() => setEnlarged(!enlarged)}
              >
                {enlarged ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
              </IconButton>
              {!enlarged && (
                <IconButton
                  label={collapsed ? '展开树图' : '收起树图'}
                  expanded={!collapsed}
                  onClick={() => setCollapsed(!collapsed)}
                >
                  {collapsed ? <PanelTopOpen size={15} /> : <PanelTopClose size={15} />}
                </IconButton>
              )}
            </span>
          </div>
        )}
        <div className="history-sub">
          <span
            className="hint history-current"
            title={selected ? nodeLabel(selected) : projectName}
          >
            {selected ? `当前：${nodeLabel(selected)}` : '还没有节点'}
          </span>
          <label className="history-switch">
            <input
              type="checkbox"
              role="switch"
              checked={showHidden}
              onChange={(e) => setShowHidden(e.target.checked)}
            />
            显示已隐藏
          </label>
        </div>
      </div>
      <ErrorMessage error={visibility.error ?? rename.error} />
      {(!collapsed || enlarged) && (
        <>
          <div className="history-legend" aria-label="节点颜色">
            {(['space', 'plan', 'white', 'render'] as const).map((kind) => (
              <span key={kind}>
                <i className={`tree-color-${kind}`} />
                {NODE_KIND_LABELS[kind]}
              </span>
            ))}
          </div>
          <div className="history-canvas">
            <svg
              ref={svgRef}
              viewBox={`${viewX} ${viewY} ${width} ${height}`}
              role="group"
              aria-label="历史树图"
            >
              {layout.edges.map((e) => (
                <path
                  key={`${e.from}-${e.to}`}
                  d={e.d}
                  fill="none"
                  className={`tree-edge ${selected && related.has(e.from) && related.has(e.to) ? 'related' : ''}`}
                  vectorEffect="non-scaling-stroke"
                />
              ))}
              {layout.boxes.map((box) => {
                const current = box.id === selectedId
                const nodeId = box.id === ROOT_ID ? null : (box.node?.id ?? null)
                const label = `${box.fullLabel}${box.id === draftBaseId ? '（有草稿）' : ''}${box.hiddenBranch ? '（已隐藏）' : ''}`
                return (
                  <g
                    key={box.id}
                    data-node-id={box.id}
                    role={nodeId ? 'button' : 'img'}
                    tabIndex={0}
                    aria-label={label}
                    aria-current={current ? 'true' : undefined}
                    className={[
                      nodeId ? 'tree-item' : 'tree-root',
                      `tree-color-${box.node?.kind ?? 'project'}`,
                      current ? 'current' : '',
                      selected && !related.has(box.id) ? 'unrelated' : '',
                      box.hiddenBranch ? 'hidden-node' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    onPointerEnter={(event) => showTooltip(box.id, event.currentTarget)}
                    onPointerLeave={() => setTooltip(null)}
                    onFocus={(event) => showTooltip(box.id, event.currentTarget)}
                    onBlur={() => setTooltip(null)}
                    onPointerDown={(event) => onPointerDown(event, box.id, nodeId)}
                    onPointerMove={onPointerMove}
                    onPointerUp={onPointerUp}
                    onPointerCancel={() => {
                      const d = drag.current
                      if (d) setOffsets((current) => ({ ...current, [d.id]: d.origin }))
                      drag.current = null
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Escape') setTooltip(null)
                      if (nodeId && (event.key === 'Enter' || event.key === ' ')) {
                        event.preventDefault()
                        onSelect(nodeId)
                      }
                    }}
                  >
                    <circle className="tree-hit" cx={box.x} cy={box.y} r={16} />
                    <circle className="tree-selection" cx={box.x} cy={box.y} r={11} />
                    <circle className="tree-node" cx={box.x} cy={box.y} r={nodeId ? 5 : 7} />
                    {box.id === draftBaseId && (
                      <circle className="tree-draft" cx={box.x + 7} cy={box.y - 7} r={3} />
                    )}
                  </g>
                )
              })}
            </svg>
          </div>
          <div className="history-caption">
            <p className="history-path" title={pathLabel}>
              {selected ? pathLabel : projectName}
            </p>
            <p>悬浮看名称 · 点击看关联 · 拖动排位置</p>
          </div>
          {tooltip &&
            hovered &&
            createPortal(
              <div
                role="tooltip"
                className="history-tooltip"
                style={{ left: tooltip.x, top: tooltip.y }}
              >
                <strong>{hovered.fullLabel}</strong>
                <span>
                  {hovered.id === ROOT_ID
                    ? '项目起点'
                    : `来源：${layout.boxes.find((box) => box.id === hovered.node?.parentId)?.fullLabel ?? projectName}`}
                </span>
                {hovered.id === draftBaseId && <span>有草稿</span>}
                {hovered.hiddenBranch && <span>已隐藏</span>}
              </div>,
              document.body,
            )}
        </>
      )}
    </section>
  )
}
