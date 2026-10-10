import { useState } from 'react'
import type { NodeSummary } from '@store/shared'
import { PLAN_STRATEGY_LABELS } from '@store/shared'
import { ErrorMessage } from '../../components/ErrorMessage.tsx'
import { useNodeVisibility, useRenameNode } from './api.ts'
import { NODE_KIND_LABELS, flattenTree } from './tree.ts'

interface HistoryTreeProps {
  projectId: string
  nodes: NodeSummary[]
  selectedId: string | null
  draftBaseId: string | null
  onSelect: (nodeId: string) => void
}

/** The project history: every step is kept; hiding only folds it away. */
export function HistoryTree({
  projectId,
  nodes,
  selectedId,
  draftBaseId,
  onSelect,
}: HistoryTreeProps) {
  const [showHidden, setShowHidden] = useState(false)
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null)
  const visibility = useNodeVisibility(projectId)
  const rename = useRenameNode(projectId)
  const entries = flattenTree(nodes).filter((e) => showHidden || !e.hiddenBranch)

  return (
    <nav className="history" aria-label="历史树">
      <div className="history-head">
        <h2>历史</h2>
        <label className="hint">
          <input
            type="checkbox"
            checked={showHidden}
            onChange={(e) => setShowHidden(e.target.checked)}
          />{' '}
          显示已隐藏
        </label>
      </div>
      <ErrorMessage error={visibility.error ?? rename.error} />
      <ol>
        {entries.map(({ node, depth, hiddenBranch }) => (
          <li
            key={node.id}
            className={[node.id === selectedId ? 'selected' : '', hiddenBranch ? 'hidden-node' : '']
              .filter(Boolean)
              .join(' ')}
            style={{ paddingLeft: `${depth * 12}px` }}
          >
            {renaming?.id === node.id ? (
              <form
                onSubmit={(event) => {
                  event.preventDefault()
                  if (renaming.name.trim())
                    rename.mutate(
                      { nodeId: node.id, name: renaming.name.trim() },
                      { onSuccess: () => setRenaming(null) },
                    )
                }}
              >
                <input
                  aria-label="节点名称"
                  value={renaming.name}
                  maxLength={100}
                  onChange={(e) => setRenaming({ id: node.id, name: e.target.value })}
                />
                <button type="submit">确定</button>
                <button type="button" onClick={() => setRenaming(null)}>
                  取消
                </button>
              </form>
            ) : (
              <>
                <button
                  type="button"
                  className="history-node"
                  aria-current={node.id === selectedId}
                  onClick={() => onSelect(node.id)}
                >
                  <span className="badge">{NODE_KIND_LABELS[node.kind]}</span> {node.name}
                  {node.strategy && !node.name.includes(PLAN_STRATEGY_LABELS[node.strategy]) ? (
                    <span className="hint"> · {PLAN_STRATEGY_LABELS[node.strategy]}</span>
                  ) : null}
                  {node.id === draftBaseId ? <span className="hint"> · 有草稿</span> : null}
                </button>
                <span className="history-actions">
                  <button
                    type="button"
                    onClick={() => setRenaming({ id: node.id, name: node.name })}
                  >
                    改名
                  </button>
                  <button
                    type="button"
                    onClick={() => visibility.mutate({ nodeId: node.id, hidden: !node.hidden })}
                  >
                    {node.hidden ? '恢复' : '隐藏'}
                  </button>
                </span>
              </>
            )}
          </li>
        ))}
      </ol>
    </nav>
  )
}
