/** Curved arrow for undo (left) and redo (right). */
export function ArcArrow({ direction }: { direction: 'left' | 'right' }) {
  return (
    <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
      <g transform={direction === 'right' ? 'translate(20 0) scale(-1 1)' : undefined}>
        <path
          d="M5 8h7a4 4 0 0 1 0 8H9"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
        <path
          d="M8 4.5 4.5 8 8 11.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>
    </svg>
  )
}
