import type { ReactNode } from 'react'

export interface StageAction {
  label: string
  onClick: () => void
  disabled?: boolean | undefined
  primary?: boolean | undefined
  title?: string | undefined
}

interface StagePanelProps {
  title: string
  /** Two actions side by side, then (optionally) one across the full width. */
  first: readonly [StageAction, StageAction]
  second?: StageAction | undefined
  status?: ReactNode
  hint?: ReactNode
}

function ActionButton({ action }: { action: StageAction }) {
  return (
    <button
      type="button"
      className={action.primary ? 'primary' : undefined}
      disabled={action.disabled}
      title={action.title}
      onClick={action.onClick}
    >
      {action.label}
    </button>
  )
}

/** The current stage and what can be done in it (copy, discard, go to the next stage). */
export function StagePanel({ title, first, second, status, hint }: StagePanelProps) {
  return (
    <section className="stage-panel" aria-label={title}>
      <div className="stage-head">
        <h3>{title}</h3>
        {status}
      </div>
      <div className="stage-row">
        <ActionButton action={first[0]} />
        <ActionButton action={first[1]} />
      </div>
      {second && (
        <div className="stage-row single">
          <ActionButton action={second} />
        </div>
      )}
      {hint ? <p className="hint">{hint}</p> : null}
    </section>
  )
}
