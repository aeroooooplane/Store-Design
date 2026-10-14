import type { Issue } from '@store/shared'

interface IssuesPanelProps {
  issues: Issue[]
  /** Only errors are counted in the heading; warnings are listed too. */
  errorCount: number
}

/** Out-of-bounds, overlap and model size problems of the layout. */
export function IssuesPanel({ issues, errorCount }: IssuesPanelProps) {
  return (
    <div className="wb-card">
      <h3>检查（{errorCount} 个问题）</h3>
      <ul className="issues">
        {issues.length === 0 && <li className="hint">没有越界、重叠或模型尺寸问题</li>}
        {issues.map((issue, i) => (
          <li key={i} className={issue.severity}>
            {issue.message}
          </li>
        ))}
      </ul>
    </div>
  )
}
