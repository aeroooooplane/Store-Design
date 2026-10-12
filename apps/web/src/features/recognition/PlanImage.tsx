import { useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import type { RecognitionDraft, RecognizeRequest } from '@store/shared'

export type ImageTool = 'none' | 'crop' | 'calibrate'

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
}

const SOURCE_COLOURS = { existing: '#36495c', requested: '#d9303a', outside: '#9aa0a6' } as const

/**
 * The uploaded picture with a drawing layer: drag a rectangle to pick the area to recognise,
 * click two points for a known length, and see the recognised boundary, entrances and props
 * laid over the picture (pixels, via the draft's scale).
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
}: PlanImageProps) {
  const svg = useRef<SVGSVGElement>(null)
  const [dragStart, setDragStart] = useState<[number, number] | null>(null)
  const [dragNow, setDragNow] = useState<[number, number] | null>(null)
  const [firstPoint, setFirstPoint] = useState<[number, number] | null>(null)

  /** Pointer position in picture pixels (the SVG is scaled to fit its column). */
  function toPicture(event: ReactPointerEvent<SVGSVGElement>): [number, number] {
    const rect = svg.current?.getBoundingClientRect()
    if (!rect || !rect.width || !rect.height) return [0, 0]
    return [
      Math.max(0, Math.min(width, ((event.clientX - rect.left) / rect.width) * width)),
      Math.max(0, Math.min(height, ((event.clientY - rect.top) / rect.height) * height)),
    ]
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
    }
  }

  function onPointerMove(event: ReactPointerEvent<SVGSVGElement>) {
    if (tool === 'crop' && dragStart) setDragNow(toPicture(event))
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

  return (
    <div className="plan-image">
      <svg
        ref={svg}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="上传的简图"
        className={`plan-image-svg tool-${tool}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
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
        {scale && draft?.space && (
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
    </div>
  )
}
