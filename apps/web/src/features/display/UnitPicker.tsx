import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { DisplayRules, DisplayRulesView, SiStyle } from '@store/shared'
import { photoOf } from './photos.ts'

export interface PickerTarget {
  /** e.g. "A桌 L1". */
  title: string
  slot: string
  current: string | null
  /** Where it opens, in page (client) pixels. */
  at: { x: number; y: number }
}

interface UnitPickerProps {
  target: PickerTarget
  rules: DisplayRules
  photos: DisplayRulesView['photos']
  si: SiStyle
  onPick: (unit: string | null) => void
  onClose: () => void
}

/**
 * Chooses what a slot holds: every display unit with its tray picture and name (and 待定).
 * Opens next to the click, closes on a choice, Esc or a click elsewhere.
 */
export function UnitPicker({ target, rules, photos, si, onPick, onClose }: UnitPickerProps) {
  const box = useRef<HTMLDivElement>(null)
  const [place, setPlace] = useState({ left: target.at.x, top: target.at.y })

  // Keep the panel inside the window.
  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    setPlace({
      left: Math.max(8, Math.min(target.at.x, window.innerWidth - width - 8)),
      top: Math.max(8, Math.min(target.at.y, window.innerHeight - height - 8)),
    })
  }, [target.at.x, target.at.y])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    const onDown = (event: PointerEvent) => {
      if (box.current && !box.current.contains(event.target as Node)) onClose()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('pointerdown', onDown, true)
    box.current?.querySelector<HTMLButtonElement>('[aria-pressed="true"]')?.focus()
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pointerdown', onDown, true)
    }
  }, [onClose])

  const choices = [
    { id: null, label: '待定', url: null as string | null },
    ...rules.units.map((u) => ({
      id: u.id,
      label: u.label,
      url: photoOf(photos, u.id, si)?.url ?? null,
    })),
  ]
  return (
    <div
      ref={box}
      className="unit-picker"
      role="dialog"
      aria-label={`${target.title} 选择陈列内容`}
      style={{ left: place.left, top: place.top }}
    >
      <header>
        <strong>{target.title}</strong>
        <span className="hint">选择陈列内容</span>
        <button type="button" className="link-button" onClick={onClose}>
          关闭
        </button>
      </header>
      <div className="unit-picker-grid">
        {choices.map((c) => (
          <button
            key={c.id ?? ''}
            type="button"
            aria-pressed={c.id === target.current}
            onClick={() => onPick(c.id)}
          >
            <span className="unit-picker-photo">
              {c.url ? (
                <img src={c.url} alt="" loading="lazy" />
              ) : (
                <span>{c.id ? '暂无图片' : '—'}</span>
              )}
            </span>
            <span className="unit-picker-name">{c.label}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
