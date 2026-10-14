import { useRef, useState } from 'react'

export interface PictureMark {
  id: string
  label: string
  /** 0–1 across and down the picture. */
  x: number
  y: number
  /** Side tables are drawn in a different colour. */
  tone?: 'island' | 'side'
}

interface MarkedPictureProps {
  src: string
  alt: string
  marks: PictureMark[]
  selectedId?: string | null
  /** Moving a label; omitted: the labels stay where they are. */
  onMove?: ((id: string, x: number, y: number) => void) | undefined
  onSelect?: ((id: string) => void) | undefined
  /** A click on the picture away from the labels (e.g. to place a new table). */
  onPick?: ((x: number, y: number) => void) | undefined
  className?: string
}

const clamp = (v: number) => Math.min(1, Math.max(0, v))

/**
 * A picture with round table labels (A, B, C …) that can be dragged where the tables are. The
 * positions are kept as fractions of the picture, so they do not depend on the shown size.
 */
export function MarkedPicture({
  src,
  alt,
  marks,
  selectedId,
  onMove,
  onSelect,
  onPick,
  className,
}: MarkedPictureProps) {
  const box = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState<string | null>(null)

  const at = (event: { clientX: number; clientY: number }) => {
    const rect = box.current?.getBoundingClientRect()
    if (!rect || !rect.width || !rect.height) return null
    return {
      x: clamp((event.clientX - rect.left) / rect.width),
      y: clamp((event.clientY - rect.top) / rect.height),
    }
  }

  return (
    <div
      ref={box}
      className={`marked-picture${className ? ` ${className}` : ''}`}
      onPointerMove={(event) => {
        if (!dragging || !onMove) return
        const p = at(event)
        if (p) onMove(dragging, p.x, p.y)
      }}
      onPointerUp={() => setDragging(null)}
      onPointerLeave={() => setDragging(null)}
      onClick={(event) => {
        if (event.target !== event.currentTarget && !(event.target instanceof HTMLImageElement))
          return
        const p = at(event)
        if (p && onPick) onPick(p.x, p.y)
      }}
    >
      <img src={src} alt={alt} draggable={false} />
      {marks.map((m) => (
        <button
          key={m.id}
          type="button"
          className={`picture-mark${m.tone === 'side' ? ' side' : ''}${m.id === selectedId ? ' selected' : ''}`}
          style={{ left: `${m.x * 100}%`, top: `${m.y * 100}%` }}
          aria-label={`${m.label}桌`}
          title={onMove ? `${m.label}桌：拖动到桌子上` : `${m.label}桌`}
          onPointerDown={(event) => {
            event.preventDefault()
            onSelect?.(m.id)
            if (onMove) {
              ;(event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId)
              setDragging(m.id)
            }
          }}
          onPointerMove={(event) => {
            if (dragging !== m.id || !onMove) return
            const p = at(event)
            if (p) onMove(m.id, p.x, p.y)
          }}
          onPointerUp={() => setDragging(null)}
        >
          {m.label}
        </button>
      ))}
    </div>
  )
}
