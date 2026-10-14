import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { distance, openingPieces, signedArea } from '@store/shared'
import type { Point, Space } from '@store/shared'
import { PlanView } from './PlanView.tsx'

/**
 * The space with each entrance and open edge split into one piece per edge, for drawing only:
 * PlanView draws an opening as the straight line between its ends, which for one along several
 * edges (an arc storefront) would cut across the shop. The piece of the main entrance at the
 * middle of the storefront goes first, so that PlanView's 主入口 label sits there.
 */
function piecewise(space: Space): Space {
  const split = <T extends { a: Point; b: Point }>(opening: T, middleFirst: boolean): T[] => {
    const pieces = openingPieces(space, opening)
    if (!pieces || pieces.length < 2) return [opening]
    const parts = pieces.map((piece) => ({ ...opening, a: piece.a, b: piece.b }))
    if (!middleFirst) return parts
    const total = pieces.reduce((sum, piece) => sum + distance(piece.a, piece.b), 0)
    let walked = 0
    const middle = pieces.findIndex((piece) => {
      walked += distance(piece.a, piece.b)
      return walked >= total / 2 - 1e-9
    })
    const head = parts[middle]
    return head ? [head, ...parts.filter((_, i) => i !== middle)] : parts
  }
  // The entrance PlanView labels: the first main one, else the first one (see mainEntrance).
  const main = Math.max(
    0,
    space.entrances.findIndex((e) => e.kind === 'main'),
  )
  return {
    ...space,
    entrances: space.entrances.flatMap((e, i) => split(e, i === main)),
    openEdges: space.openEdges.flatMap((e) => split(e, false)),
  }
}

/**
 * The space editor's plan preview: the usual plan with edge numbers on top, the selected edges
 * highlighted, and edges clickable (Shift extends the selection). The overlay is portalled into
 * the plan's own SVG so it shares its coordinates without changing PlanView.
 */
export function SpacePreview({
  space,
  selected,
  onEdgeClick,
}: {
  space: Space
  selected: readonly number[]
  onEdgeClick?: ((edge: number, extend: boolean) => void) | undefined
}) {
  const [svg, setSvg] = useState<SVGSVGElement | null>(null)
  const { boundary } = space
  const xs = boundary.map((p) => p[0])
  const zs = boundary.map((p) => p[1])
  const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs), 1)
  // Same text size as PlanView's labels.
  const fontSize = Math.min(0.24, Math.max(0.11, span / 60))
  const clockwise = signedArea(boundary) >= 0 ? 1 : -1
  const marked = new Set(selected)
  const drawn = useMemo(() => piecewise(space), [space])

  const overlay = (
    <g className="space-edges">
      {boundary.map((a, i) => {
        const b = boundary[(i + 1) % boundary.length] ?? a
        const length = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1
        // Into the shop: the opposite of (dz, -dx) on a clockwise ring.
        const inX = (-(b[1] - a[1]) / length) * clockwise
        const inZ = ((b[0] - a[0]) / length) * clockwise
        const x = (a[0] + b[0]) / 2 + inX * fontSize * 1.1
        const y = (a[1] + b[1]) / 2 + inZ * fontSize * 1.1
        return (
          <g key={i} className={marked.has(i) ? 'space-edge selected' : 'space-edge'} data-edge={i}>
            {marked.has(i) && (
              <line className="space-edge-mark" x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} />
            )}
            {onEdgeClick && (
              <line
                className="space-edge-hit"
                x1={a[0]}
                y1={a[1]}
                x2={b[0]}
                y2={b[1]}
                onClick={(event) => onEdgeClick(i, event.shiftKey)}
              >
                <title>{`边 ${i + 1}`}</title>
              </line>
            )}
            <text
              className="space-edge-label"
              x={x}
              y={y}
              fontSize={fontSize * 0.8}
              textAnchor="middle"
              dominantBaseline="middle"
            >
              {i + 1}
            </text>
          </g>
        )
      })}
    </g>
  )

  return (
    <>
      <PlanView space={drawn} title="空间预览" svgRef={setSvg} />
      {svg && createPortal(overlay, svg)}
    </>
  )
}
