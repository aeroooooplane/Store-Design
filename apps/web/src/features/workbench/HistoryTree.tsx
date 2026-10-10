import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import type { NodeSummary } from '@store/shared'
import { ErrorMessage } from '../../components/ErrorMessage.tsx'
import { useNodeVisibility, useRenameNode } from './api.ts'
import { NODE_KIND_LABELS } from './tree.ts'
import { ROOT_ID, TREE_STYLE, applyOffsets, layoutTree } from './tree-layout.ts'
import type { TreeOffsets } from './tree-layout.ts'

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
  const [showHidden, setShowHidden] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const [enlarged, setEnlarged] = useState(false)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [offsets, setOffsets] = useState<TreeOffsets>(() => loadOffsets(projectId))
  const visibility = useNodeVisibility(projectId)
  const rename = useRenameNode(projectId)
  const arrow = `tree-arrow-${useId().replace(/:/g, '')}`
  const canvas = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const drag = useRef<{
    id: string
    nodeId: string | null
    startX: number
    startY: number
    origin: readonly [number, number]
    moved: boolean
  } | null>(null)

  const base = useMemo(
    () => layoutTree(projectName, nodes, nodeLabel, showHidden),
    [projectName, nodes, showHidden],
  )
  const layout = useMemo(() => applyOffsets(base, offsets), [base, offsets])
  const selected = nodes.find((n) => n.id === selectedId) ?? null
  const { edge, levels, cornerRadius, fontSize } = TREE_STYLE

  // Keep the open step in view when the history is taller or wider than the panel.
  useEffect(() => {
    const current = canvas.current?.querySelector('[aria-current="true"]')
    current?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  }, [selectedId, collapsed, enlarged])

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
      origin: offsets[id] ?? [0, 0],
      moved: false,
    }
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }

  function onPointerMove(event: ReactPointerEvent<SVGGElement>) {
    const d = drag.current
    if (!d) return
    const [x, y] = toDrawing(event)
    const dx = x - d.startX
    const dy = y - d.startY
    if (!d.moved && Math.hypot(dx, dy) < TREE_STYLE.dragThreshold) return
    d.moved = true
    setOffsets((current) => ({ ...current, [d.id]: [d.origin[0] + dx, d.origin[1] + dy] }))
  }

  function onPointerUp() {
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
  }

  const hasOffsets = Object.keys(offsets).length > 0
  return (
    <section className={enlarged ? 'history enlarged' : 'history'} aria-label="历史树">
      <div className="toolbar history-head">
        <h2>历史</h2>
        {selected && renaming === null && (
          <>
            <span className="hint">当前：{nodeLabel(selected)}</span>
            <button type="button" onClick={() => setRenaming(selected.name)}>
              改名
            </button>
            <button
              type="button"
              disabled={visibility.isPending}
              onClick={() => visibility.mutate({ nodeId: selected.id, hidden: !selected.hidden })}
            >
              {selected.hidden ? '恢复显示' : '隐藏'}
            </button>
          </>
        )}
        {selected && renaming !== null && (
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
        )}
        <span className="history-tools">
          <label className="hint">
            <input
              type="checkbox"
              checked={showHidden}
              onChange={(e) => setShowHidden(e.target.checked)}
            />{' '}
            显示已隐藏
          </label>
          <button type="button" disabled={newSpaceDisabled} onClick={onNewSpace}>
            新建空间
          </button>
          {hasOffsets && (
            <button type="button" onClick={resetPositions} title="恢复自动排列">
              重置位置
            </button>
          )}
          <button type="button" aria-pressed={enlarged} onClick={() => setEnlarged(!enlarged)}>
            {enlarged ? '还原' : '放大'}
          </button>
          {!enlarged && (
            <button
              type="button"
              aria-expanded={!collapsed}
              onClick={() => setCollapsed(!collapsed)}
            >
              {collapsed ? '展开树图' : '收起树图'}
            </button>
          )}
        </span>
      </div>
      <ErrorMessage error={visibility.error ?? rename.error} />
      {(!collapsed || enlarged) && (
        <div className="history-canvas" ref={canvas}>
          <svg
            ref={svgRef}
            width={layout.width}
            height={layout.height}
            viewBox={`${layout.x} ${layout.y} ${layout.width} ${layout.height}`}
            style={{ minWidth: layout.width * TREE_STYLE.minScale }}
            role="group"
            aria-label="历史树图"
          >
            <defs>
              <marker
                id={arrow}
                viewBox="0 0 10 10"
                refX="1"
                refY="5"
                markerWidth={edge.arrow}
                markerHeight={edge.arrow}
                markerUnits="userSpaceOnUse"
                orient="auto"
              >
                <path d="M0 0L10 5L0 10z" fill={edge.color} />
              </marker>
            </defs>
            {layout.edges.map((e) => (
              <path
                key={`${e.from}-${e.to}`}
                d={e.d}
                fill="none"
                stroke={edge.color}
                strokeWidth={edge.width}
                markerEnd={`url(#${arrow})`}
              />
            ))}
            {layout.boxes.map((box) => {
              const colors = levels[box.level]
              const current = box.id === selectedId
              const nodeId = box.id === ROOT_ID ? null : (box.node?.id ?? null)
              return (
                <g
                  key={box.id}
                  role={nodeId ? 'button' : undefined}
                  tabIndex={nodeId ? 0 : undefined}
                  aria-label={
                    nodeId
                      ? `${box.fullLabel}${box.id === draftBaseId ? '（有草稿）' : ''}`
                      : undefined
                  }
                  aria-current={current ? 'true' : undefined}
                  className={[
                    nodeId ? 'tree-item' : 'tree-root',
                    box.hiddenBranch ? 'hidden-node' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  onPointerDown={(event) => onPointerDown(event, box.id, nodeId)}
                  onPointerMove={onPointerMove}
                  onPointerUp={onPointerUp}
                  onPointerCancel={() => (drag.current = null)}
                  onKeyDown={(event) => {
                    if (nodeId && (event.key === 'Enter' || event.key === ' ')) {
                      event.preventDefault()
                      onSelect(nodeId)
                    }
                  }}
                >
                  <title>{box.fullLabel}</title>
                  <rect
                    x={box.x - box.width / 2}
                    y={box.y - box.height / 2}
                    width={box.width}
                    height={box.height}
                    rx={cornerRadius}
                    fill={colors.fill}
                    className={current ? 'tree-node current' : 'tree-node'}
                  />
                  <text
                    x={box.x}
                    y={box.y}
                    fill={colors.text}
                    fontSize={fontSize}
                    textAnchor="middle"
                    dominantBaseline="central"
                  >
                    {box.label}
                  </text>
                  {box.id === draftBaseId && (
                    <g className="tree-draft">
                      <circle cx={box.x + box.width / 2} cy={box.y - box.height / 2} r={8} />
                      <text
                        x={box.x + box.width / 2}
                        y={box.y - box.height / 2}
                        textAnchor="middle"
                        dominantBaseline="central"
                        fontSize={10}
                      >
                        稿
                      </text>
                    </g>
                  )}
                </g>
              )
            })}
          </svg>
        </div>
      )}
    </section>
  )
}
