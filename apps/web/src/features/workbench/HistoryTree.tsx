import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { NodeSummary } from '@store/shared'
import { ErrorMessage } from '../../components/ErrorMessage.tsx'
import { useNodeVisibility, useRenameNode } from './api.ts'
import { NODE_KIND_LABELS } from './tree.ts'
import { ROOT_ID, TREE_STYLE, groupEllipse, layoutTree } from './tree-layout.ts'

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

/**
 * The project history as a tree diagram (style: TREE_STYLE in tree-layout.ts). Every step is
 * kept; hiding only folds a branch away. Click a step to open it.
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
  const [renaming, setRenaming] = useState<string | null>(null)
  const visibility = useNodeVisibility(projectId)
  const rename = useRenameNode(projectId)
  const arrow = `tree-arrow-${useId().replace(/:/g, '')}`
  const canvas = useRef<HTMLDivElement>(null)
  // Keep the open step in view when the history is taller or wider than the band.
  useEffect(() => {
    const current = canvas.current?.querySelector('[aria-current="true"]')
    current?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  }, [selectedId, collapsed])
  const layout = useMemo(
    () => layoutTree(projectName, nodes, nodeLabel, showHidden),
    [projectName, nodes, showHidden],
  )
  const selected = nodes.find((n) => n.id === selectedId) ?? null
  const ellipse = selected ? groupEllipse(layout, selected.id) : null
  const { edge, group, levels, cornerRadius, fontSize } = TREE_STYLE
  // The group ellipse may reach past the boxes; the drawing grows to keep it whole.
  const reach = group.width * 2
  const view = {
    x: Math.min(0, ellipse ? ellipse.cx - ellipse.rx - reach : 0),
    y: Math.min(0, ellipse ? ellipse.cy - ellipse.ry - reach : 0),
    right: Math.max(layout.width, ellipse ? ellipse.cx + ellipse.rx + reach : 0),
    bottom: Math.max(layout.height, ellipse ? ellipse.cy + ellipse.ry + reach : 0),
  }

  return (
    <section className="history" aria-label="历史树">
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
          <button type="button" aria-expanded={!collapsed} onClick={() => setCollapsed(!collapsed)}>
            {collapsed ? '展开树图' : '收起树图'}
          </button>
        </span>
      </div>
      <ErrorMessage error={visibility.error ?? rename.error} />
      {!collapsed && (
        <div className="history-canvas" ref={canvas}>
          <svg
            width={view.right - view.x}
            height={view.bottom - view.y}
            viewBox={`${view.x} ${view.y} ${view.right - view.x} ${view.bottom - view.y}`}
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
            {ellipse && (
              <ellipse
                className="tree-group"
                cx={ellipse.cx}
                cy={ellipse.cy}
                rx={ellipse.rx}
                ry={ellipse.ry}
                fill="none"
                stroke={group.color}
                strokeWidth={group.width}
                strokeDasharray={group.dash}
              />
            )}
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
              const isRoot = box.id === ROOT_ID
              const current = box.id === selectedId
              const shape = (
                <>
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
                </>
              )
              if (isRoot || !box.node) {
                return (
                  <g key={box.id} className="tree-root">
                    {shape}
                  </g>
                )
              }
              const nodeId = box.node.id
              return (
                <g
                  key={box.id}
                  role="button"
                  tabIndex={0}
                  aria-label={`${box.fullLabel}${box.id === draftBaseId ? '（有草稿）' : ''}`}
                  aria-current={current ? 'true' : undefined}
                  className={box.hiddenBranch ? 'tree-item hidden-node' : 'tree-item'}
                  onClick={() => onSelect(nodeId)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      onSelect(nodeId)
                    }
                  }}
                >
                  {shape}
                </g>
              )
            })}
          </svg>
        </div>
      )}
    </section>
  )
}
