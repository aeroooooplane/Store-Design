/** How the design assistant looks: waiting, thinking (busy) or after something went wrong. */
export type FaceMood = 'idle' | 'think' | 'error'

/**
 * The brand mark as the design assistant's face (user, 2026-11-12): the two yellow tables are its
 * eyes, the doorway is its mouth. Same drawing as public/favicon.svg; colours and the blinking /
 * hopping eyes are in workbench.css. Without `plate` it sits directly on a dark button.
 */
export function BrandFace({
  mood = 'idle',
  size = 28,
  plate = true,
}: {
  mood?: FaceMood
  size?: number
  plate?: boolean
}) {
  const tall = mood === 'idle'
  return (
    <svg
      className={`brand-face ${mood}`}
      viewBox="0 0 64 64"
      width={size}
      height={size}
      aria-hidden="true"
    >
      {plate ? <rect className="brand-face-plate" width="64" height="64" rx="14" /> : null}
      <path className="brand-face-walls" d="M26.5 50H14V14H50V50H37.5" />
      {mood === 'error' ? (
        <path
          className="brand-face-eyes"
          d="M21.5 24.5l7 8M28.5 24.5l-7 8M35.5 24.5l7 8M42.5 24.5l-7 8"
        />
      ) : (
        <g className="brand-face-eyes">
          <rect x="21" y={tall ? 21 : 23} width="8" height={tall ? 17 : 13} rx="1.5" />
          <rect x="35" y={tall ? 21 : 23} width="8" height={tall ? 17 : 13} rx="1.5" />
        </g>
      )}
    </svg>
  )
}
