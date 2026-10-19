import { useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'
import type { RecognitionDraft, RecognizeRequest, VectorContent } from '@store/shared'
import { EDGE_KINDS, EDGE_KIND_LABELS, arcPoints, snapPoint, straighten } from './trace.ts'
import type { EdgeKind, Px } from './trace.ts'

export type ImageTool = 'none' | 'crop' | 'calibrate' | 'trace'

/** A boundary being traced on the picture, in picture pixels (see trace.ts). */
export interface Trace {
  points: Px[]
  /** Closed once the last point joins the first; edges can then be edited. */
  closed: boolean
  /** Kind of each edge (from point i to i + 1) once closed. */
  kinds: EdgeKind[]
  /** The next two clicks draw an arc from the last point: a point on it, then its end. */
  arc: boolean
}

export const EMPTY_TRACE: Trace = { points: [], closed: false, kinds: [], arc: false }

export interface PlanImageProps {
  url: string
  width: number
  height: number
  tool: ImageTool
  crop: RecognizeRequest['crop'] | null
  onCrop: (crop: RecognizeRequest['crop'] | null) => void
  /** Two picked points of the known length, in picture pixels. */
  calibration: { a: [number, number]; b: [number, number] } | null
  onCalibrate: (points: { a: [number, number]; b: [number, number] } | null) => void
  /** What was recognised, drawn over the picture in its own pixels. */
  draft: RecognitionDraft | null
  /** The boundary traced by hand, and its changes. */
  trace?: Trace | undefined
  onTrace?: ((trace: Trace) => void) | undefined
  /** Lines of a vector PDF the traced points snap to; null for a picture. */
  vector?: VectorContent | null | undefined
}

const SOURCE_COLOURS = { existing: '#36495c', requested: '#d9303a', outside: '#9aa0a6' } as const
const EDGE_COLOURS: Record<EdgeKind, string> = {
  wall: '#1f6feb',
  entrance: '#2f8f3a',
  open: '#b26a00',
}
/** Screen pixels within which a click snaps to a line, a corner or the first point. */
const SNAP_SCREEN_PX = 12

/**
 * The uploaded picture with a drawing layer: drag a rectangle to pick the area to recognise,
 * click two points for a known length, trace the shop's boundary by hand, and see the
 * recognised boundary, entrances and props laid over the picture (pixels, via the draft's scale).
 */
export function PlanImage({
  url,
  width,
  height,
  tool,
  crop,
  onCrop,
  calibration,
  onCalibrate,
  draft,
  trace = EMPTY_TRACE,
  onTrace,
  vector = null,
}: PlanImageProps) {
  const svg = useRef<SVGSVGElement>(null)
  const [dragStart, setDragStart] = useState<[number, number] | null>(null)
  const [dragNow, setDragNow] = useState<[number, number] | null>(null)
  const [firstPoint, setFirstPoint] = useState<[number, number] | null>(null)
  /** Tracing: the vertex being dragged, the arc's middle point, and the pointer. */
  const [dragVertex, setDragVertex] = useState<number | null>(null)
  const [arcMid, setArcMid] = useState<Px | null>(null)
  const [hover, setHover] = useState<Px | null>(null)

  /** Picture pixels per screen pixel (the SVG is scaled to fit its column). */
  function pixelsPerScreen(): number {
    const rect = svg.current?.getBoundingClientRect()
    return rect && rect.width ? width / rect.width : 1
  }

  /** Pointer position in picture pixels. */
  function toPicture(event: { clientX: number; clientY: number }): [number, number] {
    const rect = svg.current?.getBoundingClientRect()
    if (!rect || !rect.width || !rect.height) return [0, 0]
    return [
      Math.max(0, Math.min(width, ((event.clientX - rect.left) / rect.width) * width)),
      Math.max(0, Math.min(height, ((event.clientY - rect.top) / rect.height) * height)),
    ]
  }

  /** A traced point: snapped to the drawing (Alt: not), straight from the last (Shift). */
  function tracePoint(event: ReactPointerEvent<SVGElement>, from: Px | null): Px {
    let p = toPicture(event)
    if (event.shiftKey && from) p = straighten(from, p)
    if (!event.altKey) p = snapPoint(p, vector, SNAP_SCREEN_PX * pixelsPerScreen()).point
    return [Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10]
  }

  const closeTrace = () =>
    onTrace?.({ ...trace, closed: true, arc: false, kinds: trace.points.map(() => 'wall') })

  function addTracePoint(event: ReactPointerEvent<SVGSVGElement>) {
    if (!onTrace || trace.closed) return
    const last = trace.points.at(-1) ?? null
    const first = trace.points[0]
    // A click on the first point closes the outline.
    const raw = toPicture(event)
    if (
      first &&
      trace.points.length >= 3 &&
      !trace.arc &&
      Math.hypot(raw[0] - first[0], raw[1] - first[1]) <= SNAP_SCREEN_PX * pixelsPerScreen()
    ) {
      closeTrace()
      return
    }
    const p = tracePoint(event, last)
    if (trace.arc && last) {
      if (!arcMid) {
        setArcMid(p)
        return
      }
      setArcMid(null)
      onTrace({ ...trace, points: [...trace.points, ...arcPoints(last, arcMid, p)], arc: false })
      return
    }
    onTrace({ ...trace, points: [...trace.points, p] })
  }

  function onPointerDown(event: ReactPointerEvent<SVGSVGElement>) {
    if (event.button !== 0) return
    const point = toPicture(event)
    if (tool === 'crop') {
      setDragStart(point)
      setDragNow(point)
      svg.current?.setPointerCapture(event.pointerId)
    } else if (tool === 'calibrate') {
      if (!firstPoint) {
        setFirstPoint(point)
        onCalibrate(null)
      } else {
        onCalibrate({ a: firstPoint, b: point })
        setFirstPoint(null)
      }
    } else if (tool === 'trace') {
      addTracePoint(event)
    }
  }

  function onPointerMove(event: ReactPointerEvent<SVGSVGElement>) {
    if (tool === 'crop' && dragStart) setDragNow(toPicture(event))
    if (tool !== 'trace') return
    if (dragVertex !== null && onTrace) {
      const n = trace.points.length
      const prev = trace.points[(dragVertex - 1 + n) % n] ?? null
      const p = tracePoint(event, prev)
      onTrace({ ...trace, points: trace.points.map((q, i) => (i === dragVertex ? p : q)) })
      return
    }
    setHover(toPicture(event))
  }

  function onPointerUp() {
    if (tool === 'crop' && dragStart && dragNow) {
      const x = Math.min(dragStart[0], dragNow[0])
      const y = Math.min(dragStart[1], dragNow[1])
      const w = Math.abs(dragNow[0] - dragStart[0])
      const h = Math.abs(dragNow[1] - dragStart[1])
      onCrop(w > 10 && h > 10 ? { x, y, w, h } : null)
    }
    setDragStart(null)
    setDragNow(null)
    setDragVertex(null)
  }

  /** Backspace takes the last point back; Escape drops a half-drawn arc. */
  function onKeyDown(event: ReactKeyboardEvent<SVGSVGElement>) {
    if (tool !== 'trace' || !onTrace) return
    if (event.key === 'Escape' && arcMid) {
      setArcMid(null)
      event.preventDefault()
    } else if (event.key === 'Backspace' && !trace.closed && trace.points.length) {
      onTrace({ ...trace, points: trace.points.slice(0, -1) })
      event.preventDefault()
    }
  }

  function startVertexDrag(index: number, event: ReactPointerEvent<SVGElement>) {
    if (event.button !== 0 || !onTrace) return
    event.stopPropagation()
    // A click on the first point of an open outline closes it.
    if (!trace.closed && index === 0 && trace.points.length >= 3 && !trace.arc) {
      closeTrace()
      return
    }
    setDragVertex(index)
    svg.current?.setPointerCapture(event.pointerId)
  }

  /** Double-click a corner of a closed outline to take it out (three are kept at least). */
  function removeVertex(index: number) {
    if (!onTrace || !trace.closed || trace.points.length <= 3) return
    // The edges either side of the corner become one, of the earlier edge's kind.
    onTrace({
      ...trace,
      points: trace.points.filter((_, i) => i !== index),
      kinds: trace.kinds.filter((_, i) => i !== index),
    })
  }

  /** A click on an edge puts a corner there (on the edge), splitting it into two of its kind. */
  function insertVertex(edge: number, event: ReactPointerEvent<SVGElement>) {
    event.stopPropagation()
    if (event.button !== 0 || !onTrace) return
    const a = trace.points[edge]
    const b = trace.points[(edge + 1) % trace.points.length]
    if (!a || !b) return
    const p = toPicture(event)
    const dx = b[0] - a[0]
    const dy = b[1] - a[1]
    const len = dx * dx + dy * dy || 1
    const t = Math.max(0.05, Math.min(0.95, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len))
    const mid: Px = [Math.round((a[0] + dx * t) * 10) / 10, Math.round((a[1] + dy * t) * 10) / 10]
    const kind = trace.kinds[edge] ?? 'wall'
    onTrace({
      ...trace,
      points: [...trace.points.slice(0, edge + 1), mid, ...trace.points.slice(edge + 1)],
      kinds: [...trace.kinds.slice(0, edge + 1), kind, ...trace.kinds.slice(edge + 1)],
    })
  }

  /** A click on an edge's label: wall → entrance → open side → wall. */
  function cycleEdge(edge: number, event: ReactPointerEvent<SVGElement>) {
    event.stopPropagation()
    if (event.button !== 0 || !onTrace) return
    const current = trace.kinds[edge] ?? 'wall'
    const next = EDGE_KINDS[(EDGE_KINDS.indexOf(current) + 1) % EDGE_KINDS.length] ?? 'wall'
    onTrace({ ...trace, kinds: trace.kinds.map((k, i) => (i === edge ? next : k)) })
  }

  const dragging =
    dragStart && dragNow
      ? {
          x: Math.min(dragStart[0], dragNow[0]),
          y: Math.min(dragStart[1], dragNow[1]),
          w: Math.abs(dragNow[0] - dragStart[0]),
          h: Math.abs(dragNow[1] - dragStart[1]),
        }
      : null
  const shownCrop = dragging ?? crop
  const scale = draft?.scale ?? null
  // Metres of the draft back to picture pixels.
  const px = (m: number, axis: 0 | 1) =>
    scale ? scale.originPx[axis] + (m * 1000) / scale.mmPerPixel : 0
  const stroke = Math.max(1.5, width / 800)
  const fontSize = Math.max(10, width / 90)
  const tracing = tool === 'trace'
  const traced = trace.points.length > 0
  const edges = trace.points.map((a, i) => ({
    a,
    b: trace.points[(i + 1) % trace.points.length] as Px,
    i,
  }))
  const drawnEdges = trace.closed ? edges : edges.slice(0, -1)
  const last = trace.points.at(-1)
  const guideTo = arcMid ?? hover

  return (
    <div className="plan-image">
      <svg
        ref={svg}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="上传的简图"
        className={`plan-image-svg tool-${tool}`}
        tabIndex={tracing ? 0 : -1}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={() => setHover(null)}
        onKeyDown={onKeyDown}
      >
        <image href={url} width={width} height={height} />
        {shownCrop && (
          <>
            <path
              d={`M0 0H${width}V${height}H0Z M${shownCrop.x} ${shownCrop.y}h${shownCrop.w}v${shownCrop.h}h${-shownCrop.w}Z`}
              fill="rgb(0 0 0 / 35%)"
              fillRule="evenodd"
            />
            <rect
              x={shownCrop.x}
              y={shownCrop.y}
              width={shownCrop.w}
              height={shownCrop.h}
              fill="none"
              stroke="#36495c"
              strokeWidth={stroke}
              strokeDasharray={`${stroke * 4} ${stroke * 3}`}
            />
          </>
        )}
        {scale && draft?.space && !traced && (
          <g className="plan-image-draft">
            <polygon
              points={draft.space.boundary.map((p) => `${px(p[0], 0)},${px(p[1], 1)}`).join(' ')}
              fill="rgb(54 73 92 / 6%)"
              stroke="#36495c"
              strokeWidth={stroke * 1.5}
            />
            {draft.space.entrances.map((e, i) => (
              <line
                key={i}
                x1={px(e.a[0], 0)}
                y1={px(e.a[1], 1)}
                x2={px(e.b[0], 0)}
                y2={px(e.b[1], 1)}
                stroke="#2f8f3a"
                strokeWidth={stroke * 3}
              />
            ))}
            {draft.space.obstacles.map((o, i) => (
              <polygon
                key={i}
                points={o.polygon.map((p) => `${px(p[0], 0)},${px(p[1], 1)}`).join(' ')}
                fill="rgb(120 120 120 / 25%)"
                stroke="#666"
                strokeWidth={stroke}
              />
            ))}
          </g>
        )}
        {scale &&
          draft?.items.map((item) => {
            const w = (item.w * 1000) / scale.mmPerPixel
            const d = (item.d * 1000) / scale.mmPerPixel
            const cx = px(item.cx, 0)
            const cy = px(item.cz, 1)
            const colour = SOURCE_COLOURS[item.source]
            return (
              <g key={item.ref}>
                <rect
                  x={cx - w / 2}
                  y={cy - d / 2}
                  width={w}
                  height={d}
                  fill={`${colour}22`}
                  stroke={colour}
                  strokeWidth={stroke}
                />
                <text x={cx} y={cy} fontSize={fontSize} fill={colour} textAnchor="middle">
                  {item.label}
                </text>
              </g>
            )
          })}
        {traced && (
          <g className="plan-image-trace">
            {trace.closed && (
              <polygon
                points={trace.points.map((p) => p.join(',')).join(' ')}
                fill="rgb(31 111 235 / 8%)"
                stroke="none"
              />
            )}
            {drawnEdges.map(({ a, b, i }) => {
              const kind = trace.closed ? (trace.kinds[i] ?? 'wall') : 'wall'
              return (
                <g key={`e${i}`} data-trace-edge={i} data-edge-kind={kind}>
                  <line
                    x1={a[0]}
                    y1={a[1]}
                    x2={b[0]}
                    y2={b[1]}
                    stroke={EDGE_COLOURS[kind]}
                    strokeWidth={stroke * (kind === 'wall' ? 2 : 4)}
                    strokeDasharray={kind === 'open' ? `${stroke * 4} ${stroke * 3}` : undefined}
                  />
                  {tracing && trace.closed && (
                    <line
                      className="trace-edge-hit"
                      x1={a[0]}
                      y1={a[1]}
                      x2={b[0]}
                      y2={b[1]}
                      stroke="transparent"
                      strokeWidth={stroke * 10}
                      onPointerDown={(event) => insertVertex(i, event)}
                    />
                  )}
                </g>
              )
            })}
            {tracing && !trace.closed && last && guideTo && (
              <line
                x1={last[0]}
                y1={last[1]}
                x2={guideTo[0]}
                y2={guideTo[1]}
                stroke={EDGE_COLOURS.wall}
                strokeWidth={stroke}
                strokeDasharray={`${stroke * 3} ${stroke * 3}`}
                pointerEvents="none"
              />
            )}
            {arcMid && (
              <circle
                cx={arcMid[0]}
                cy={arcMid[1]}
                r={stroke * 2.5}
                fill="#b26a00"
                pointerEvents="none"
              />
            )}
            {tracing &&
              trace.closed &&
              edges.map(({ a, b, i }) => {
                const kind = trace.kinds[i] ?? 'wall'
                const label = EDGE_KIND_LABELS[kind]
                const w = fontSize * (label.length * 0.95 + 0.8)
                const h = fontSize * 1.4
                const cx = (a[0] + b[0]) / 2
                const cy = (a[1] + b[1]) / 2
                return (
                  <g
                    key={`k${i}`}
                    className="trace-kind"
                    data-trace-kind={i}
                    onPointerDown={(event) => cycleEdge(i, event)}
                  >
                    <rect
                      x={cx - w / 2}
                      y={cy - h / 2}
                      width={w}
                      height={h}
                      rx={h / 2}
                      fill="#fff"
                      stroke={EDGE_COLOURS[kind]}
                      strokeWidth={stroke}
                    />
                    <text
                      x={cx}
                      y={cy}
                      fontSize={fontSize}
                      textAnchor="middle"
                      dominantBaseline="central"
                      fill={EDGE_COLOURS[kind]}
                      pointerEvents="none"
                    >
                      {label}
                    </text>
                  </g>
                )
              })}
            {tracing &&
              trace.points.map((p, i) => (
                <circle
                  key={`v${i}`}
                  className="trace-vertex"
                  data-trace-vertex={i}
                  cx={p[0]}
                  cy={p[1]}
                  r={stroke * (i === 0 && !trace.closed ? 4 : 3)}
                  fill={i === 0 && !trace.closed ? '#d9303a' : '#1f6feb'}
                  stroke="#fff"
                  strokeWidth={stroke}
                  onPointerDown={(event) => startVertexDrag(i, event)}
                  onDoubleClick={() => removeVertex(i)}
                />
              ))}
          </g>
        )}
        {(firstPoint || calibration) && (
          <g>
            {[firstPoint, calibration?.a, calibration?.b].map((p, i) =>
              p ? <circle key={i} cx={p[0]} cy={p[1]} r={stroke * 3} fill="#d9303a" /> : null,
            )}
            {calibration && (
              <line
                x1={calibration.a[0]}
                y1={calibration.a[1]}
                x2={calibration.b[0]}
                y2={calibration.b[1]}
                stroke="#d9303a"
                strokeWidth={stroke * 1.5}
              />
            )}
          </g>
        )}
      </svg>
      {tool === 'calibrate' && (
        <p className="hint">
          {firstPoint ? '再点一下已知长度的另一端。' : '在图上点已知长度的一端。'}
        </p>
      )}
      {tool === 'crop' && <p className="hint">在图上拖出要识别的区域（一张图上有多个空间时）。</p>}
      {tracing && (
        <p className="hint">
          {trace.closed
            ? '拖动圆点调整顶点，双击圆点删除，点边线加一个顶点；点边中间的标签在“墙 → 入口 → 开放边”之间切换。'
            : trace.arc
              ? arcMid
                ? '再点圆弧的终点。'
                : '点圆弧上的一点（弧的中间附近）。'
              : '依次点店铺边界的顶点，点回红色起点闭合。矢量图纸会吸附到墙线（按住 Alt 不吸附），按住 Shift 画横平竖直的边，退格键撤销上一点。'}
        </p>
      )}
    </div>
  )
}
