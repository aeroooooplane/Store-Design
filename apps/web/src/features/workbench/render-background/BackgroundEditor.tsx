import { useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import type { BackgroundPoint, RenderBackground } from '@store/shared'
import { backgroundPhotoMatrix } from '../../viewer3d/background-composite.ts'
import { ErrorMessage } from '../../../components/ErrorMessage.tsx'
import { newBackground } from './state.ts'
import type { BackgroundDraft, BackgroundDrafts } from './state.ts'
import { validMask } from './geometry.ts'
import './background-editor.css'

export type BackgroundTool = 'move' | 'mask' | 'guide' | 'vertices'
export interface BackgroundEditing {
  tool: BackgroundTool
  points: BackgroundPoint[]
  selected: { kind: 'mask' | 'guide'; id: string } | null
  error: string | null
}
export const emptyEditing = (): BackgroundEditing => ({
  tool: 'move',
  points: [],
  selected: null,
  error: null,
})

interface CommonProps {
  cameraId: string
  draft: BackgroundDraft
  drafts: BackgroundDrafts
  editing: BackgroundEditing
  setEditing: (value: BackgroundEditing) => void
  disabled: boolean
}

function Numeric({
  label,
  value,
  min,
  max,
  onChange,
  disabled,
}: {
  label: string
  value: number
  min: number
  max: number
  disabled: boolean
  onChange: (value: number) => void
}) {
  const [text, setText] = useState(String(value))
  const [active, setActive] = useState(false)
  const cancelled = useRef(false)
  const initialText = useRef(String(Math.round(value * 100) / 100))
  const displayed = active ? text : String(Math.round(value * 100) / 100)
  const commit = () => {
    const n = Number(text)
    if (
      !cancelled.current &&
      text !== initialText.current &&
      text.trim() &&
      Number.isFinite(n) &&
      n >= min &&
      n <= max
    )
      onChange(n)
    cancelled.current = false
    setActive(false)
  }
  return (
    <label className="background-number">
      {label}
      <input
        type="number"
        value={displayed}
        min={min}
        max={max}
        step="0.1"
        disabled={disabled}
        onFocus={() => {
          initialText.current = String(Math.round(value * 100) / 100)
          setText(initialText.current)
          setActive(true)
        }}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur()
          if (e.key === 'Escape') {
            cancelled.current = true
            setText(String(value))
            setActive(false)
            e.currentTarget.blur()
          }
        }}
      />
    </label>
  )
}

export function BackgroundTools({
  cameraId,
  draft,
  drafts,
  editing,
  setEditing,
  disabled,
  upload,
  uploading,
  uploadError,
  reload,
  cancelUpload,
}: CommonProps & {
  upload: (file: File) => void
  uploading: boolean
  uploadError: unknown
  reload: () => void
  cancelUpload: () => void
}) {
  const bg = draft.background
  const input = useRef<HTMLInputElement>(null)
  const adjustingOpacity = useRef(false)
  useEffect(
    () => () => {
      if (adjustingOpacity.current) drafts.end(cameraId)
    },
    [cameraId, drafts],
  )
  useEffect(() => {
    const element = input.current
    element?.addEventListener('cancel', cancelUpload)
    return () => element?.removeEventListener('cancel', cancelUpload)
  }, [cancelUpload])
  const blocked = disabled || uploading || !!draft.gesture
  function beginOpacity() {
    if (adjustingOpacity.current) return
    adjustingOpacity.current = true
    drafts.begin(cameraId)
  }
  function finishOpacity(cancel = false) {
    if (!adjustingOpacity.current) return
    adjustingOpacity.current = false
    drafts.end(cameraId, cancel)
  }
  const change = (patch: Partial<RenderBackground>) => {
    if (bg) drafts.commit(cameraId, { ...bg, ...patch })
  }
  const transform = (patch: Partial<RenderBackground['transform']>) => {
    if (bg) change({ transform: { ...bg.transform, ...patch } })
  }
  const finishMask = () => {
    if (!bg) return
    if (bg.masks.length >= 32) {
      setEditing({ ...editing, error: '最多添加 32 个遮罩' })
      return
    }
    if (!validMask(editing.points)) {
      setEditing({ ...editing, error: '遮罩至少需要 3 个点，边线不能相交或重叠' })
      return
    }
    const id = crypto.randomUUID()
    change({ masks: [...bg.masks, { id, points: editing.points }] })
    setEditing({ tool: 'vertices', points: [], selected: { kind: 'mask', id }, error: null })
  }
  return (
    <section className="background-tools" aria-label="背景编辑工具">
      <div className="background-toolbar">
        <button type="button" onClick={() => input.current?.click()} disabled={blocked}>
          {uploading ? '正在上传…' : bg ? '替换背景图片' : '添加背景图片'}
        </button>
        <input
          ref={input}
          type="file"
          accept="image/png,image/jpeg"
          aria-label="选择背景图片"
          className="background-file"
          disabled={blocked}
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) upload(file)
            e.target.value = ''
          }}
        />
        <button
          type="button"
          disabled={blocked || !bg}
          onClick={() => {
            drafts.commit(cameraId, null)
            setEditing(emptyEditing())
          }}
        >
          移除背景
        </button>
        <button
          type="button"
          disabled={blocked || (!draft.past.length && !editing.points.length)}
          onClick={() =>
            editing.points.length
              ? setEditing({ ...editing, points: editing.points.slice(0, -1), error: null })
              : drafts.undo(cameraId)
          }
        >
          撤销
        </button>
        <button
          type="button"
          disabled={blocked || !draft.future.length || !!editing.points.length}
          onClick={() => drafts.redo(cameraId)}
        >
          重做
        </button>
        <span role="status" className="hint">
          {uploading
            ? '图片上传中'
            : draft.error
              ? '保存失败，本地修改已保留'
              : draft.saving
                ? '正在保存…'
                : drafts.dirty(cameraId)
                  ? '待保存'
                  : '已保存'}
        </span>
        {!!draft.error && (
          <>
            <button type="button" disabled={disabled} onClick={() => drafts.retry(cameraId)}>
              重试保存
            </button>
            <button type="button" disabled={disabled || draft.saving} onClick={reload}>
              放弃本地修改并重载
            </button>
          </>
        )}
      </div>
      <ErrorMessage error={uploadError ?? draft.error} />
      {bg ? (
        <>
          <div className="background-transform">
            <Numeric
              label="中心 X（%）"
              value={bg.transform.x * 100}
              min={-1000}
              max={1000}
              disabled={blocked}
              onChange={(n) => transform({ x: n / 100 })}
            />
            <Numeric
              label="中心 Y（%）"
              value={bg.transform.y * 100}
              min={-1000}
              max={1000}
              disabled={blocked}
              onChange={(n) => transform({ y: n / 100 })}
            />
            <Numeric
              label="宽度（%）"
              value={bg.transform.width * 100}
              min={1}
              max={2000}
              disabled={blocked}
              onChange={(n) => transform({ width: n / 100 })}
            />
            <Numeric
              label="旋转（°）"
              value={bg.transform.rotationDeg}
              min={-360}
              max={360}
              disabled={blocked}
              onChange={(n) => transform({ rotationDeg: n })}
            />
            <span className="hint">锁定原图比例</span>
            <button
              type="button"
              disabled={blocked}
              onClick={() => transform(newBackground(bg.image).transform)}
            >
              图片归位
            </button>
          </div>
          <div className="background-toolbar" role="group" aria-label="背景绘制工具">
            {(
              [
                ['move', '移动图片'],
                ['mask', '绘制遮罩'],
                ['vertices', '编辑顶点'],
                ['guide', '绘制辅助线'],
              ] as const
            ).map(([tool, label]) => (
              <button
                type="button"
                key={tool}
                aria-pressed={editing.tool === tool}
                disabled={blocked}
                onClick={() => setEditing({ ...editing, tool, points: [], error: null })}
              >
                {label}
              </button>
            ))}
            {editing.tool === 'mask' && (
              <button
                type="button"
                onClick={finishMask}
                disabled={blocked || editing.points.length < 3}
              >
                闭合遮罩
              </button>
            )}
            {!!editing.points.length && (
              <button
                type="button"
                disabled={blocked}
                onClick={() => setEditing({ ...editing, points: [], error: null })}
              >
                取消绘制
              </button>
            )}
            <label>
              <input
                type="checkbox"
                checked={bg.guidesVisible}
                disabled={blocked}
                onChange={(e) => change({ guidesVisible: e.target.checked })}
              />
              显示辅助线
            </label>
            <label>
              <input
                type="checkbox"
                checked={bg.showTransparentWalls}
                disabled={blocked}
                onChange={(e) => change({ showTransparentWalls: e.target.checked })}
              />
              显示半透明墙
            </label>
            <label>
              <input
                type="checkbox"
                checked={bg.showFloor !== false}
                disabled={blocked}
                onChange={(e) => change({ showFloor: e.target.checked })}
              />
              显示地板
            </label>
            <label>
              模型整体不透明度 {Math.round((bg.modelOpacity ?? 1) * 100)}%
              <input
                type="range"
                aria-label="模型整体不透明度"
                min={0}
                max={100}
                step={1}
                value={Math.round((bg.modelOpacity ?? 1) * 100)}
                disabled={disabled || uploading || (!!draft.gesture && !adjustingOpacity.current)}
                onPointerDown={beginOpacity}
                onChange={(e) => {
                  beginOpacity()
                  drafts.preview(cameraId, { ...bg, modelOpacity: Number(e.target.value) / 100 })
                }}
                onPointerUp={() => finishOpacity()}
                onPointerCancel={() => finishOpacity(true)}
                onLostPointerCapture={() => finishOpacity()}
                onKeyUp={() => finishOpacity()}
                onBlur={() => finishOpacity()}
              />
            </label>
          </div>
          <div className="background-object-list" aria-label="遮罩和辅助线">
            {bg.masks.map((mask, i) => (
              <span key={mask.id}>
                <button
                  type="button"
                  disabled={blocked}
                  aria-pressed={editing.selected?.id === mask.id}
                  onClick={() =>
                    setEditing({
                      tool: 'vertices',
                      points: [],
                      selected: { kind: 'mask', id: mask.id },
                      error: null,
                    })
                  }
                >
                  遮罩 {i + 1}
                </button>
                <button
                  type="button"
                  aria-label={`删除遮罩 ${i + 1}`}
                  disabled={blocked}
                  onClick={() => {
                    change({ masks: bg.masks.filter((m) => m.id !== mask.id) })
                    setEditing({ ...editing, selected: null })
                  }}
                >
                  删除
                </button>
              </span>
            ))}
            {bg.guides.map((guide, i) => (
              <span key={guide.id}>
                <button
                  type="button"
                  disabled={blocked}
                  aria-pressed={editing.selected?.id === guide.id}
                  onClick={() =>
                    setEditing({
                      tool: 'vertices',
                      points: [],
                      selected: { kind: 'guide', id: guide.id },
                      error: null,
                    })
                  }
                >
                  辅助线 {i + 1}
                </button>
                <button
                  type="button"
                  aria-label={`删除辅助线 ${i + 1}`}
                  disabled={blocked}
                  onClick={() => {
                    change({ guides: bg.guides.filter((g) => g.id !== guide.id) })
                    setEditing({ ...editing, selected: null })
                  }}
                >
                  删除
                </button>
              </span>
            ))}
          </div>
        </>
      ) : (
        <p className="hint">拖入 PNG / JPEG，或选择图片。每个视角独立保存，单张不超过 16 MiB。</p>
      )}
      {editing.error && (
        <p className="error" role="alert">
          {editing.error}
        </p>
      )}
      <p className="hint">
        {editing.tool === 'mask'
          ? '在照片上逐点点击，点击起点或“闭合遮罩”完成；遮罩会恢复原照片、盖住三维。'
          : editing.tool === 'guide'
            ? '在照片上点击两个端点。辅助线会保留，但不会出现在最终图片。'
            : editing.tool === 'vertices'
              ? '选择遮罩或辅助线后拖动端点。'
              : '拖动照片移动，拖角点等比缩放，拖圆形手柄旋转。'}{' '}
        Ctrl+Z 撤销，Ctrl+Shift+Z 重做。
      </p>
    </section>
  )
}

export function BackgroundCanvas({
  cameraId,
  draft,
  drafts,
  editing,
  setEditing,
  disabled,
  upload,
}: CommonProps & { upload: (file: File) => void }) {
  const bg = draft.background
  const svg = useRef<SVGSVGElement>(null)
  const gesture = useRef<{
    pointerId: number
    kind: 'move' | 'scale' | 'rotate' | 'vertex'
    before: RenderBackground
    start: DOMPoint
    index: number
    selected: BackgroundEditing['selected']
  } | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [unit, setUnit] = useState(3)
  useEffect(() => {
    const element = svg.current
    if (!element || typeof ResizeObserver === 'undefined') return
    const resize = new ResizeObserver(() => {
      const width = element.getBoundingClientRect().width
      if (width > 0) setUnit(1800 / width)
    })
    resize.observe(element)
    return () => resize.disconnect()
  }, [])
  const matrix = bg ? backgroundPhotoMatrix(bg, 1800, 1200) : null
  const project = (p: BackgroundPoint) =>
    new DOMPoint(p[0], p[1]).matrixTransform(matrix ?? undefined)
  const points = (ps: BackgroundPoint[]) =>
    ps
      .map((p) => {
        const at = project(p)
        return `${at.x},${at.y}`
      })
      .join(' ')
  const position = (event: { clientX: number; clientY: number }) => {
    const ctm = svg.current?.getScreenCTM()
    return ctm
      ? new DOMPoint(event.clientX, event.clientY).matrixTransform(ctm.inverse())
      : new DOMPoint(event.clientX, event.clientY)
  }
  const photoPoint = (p: DOMPoint, clamp = false): BackgroundPoint | null => {
    if (!matrix) return null
    const q = p.matrixTransform(matrix.inverse())
    if (!clamp && (q.x < 0 || q.y < 0 || q.x > 1 || q.y > 1)) return null
    return [Math.min(1, Math.max(0, q.x)), Math.min(1, Math.max(0, q.y))]
  }
  const closeMask = () => {
    if (!bg || !validMask(editing.points) || bg.masks.length >= 32) {
      setEditing({ ...editing, error: '遮罩需至少 3 点且不能自交，最多 32 个遮罩' })
      return
    }
    const id = crypto.randomUUID()
    drafts.commit(cameraId, { ...bg, masks: [...bg.masks, { id, points: editing.points }] })
    setEditing({ tool: 'vertices', points: [], selected: { kind: 'mask', id }, error: null })
  }
  const start = (
    event: ReactPointerEvent,
    kind: 'move' | 'scale' | 'rotate' | 'vertex',
    index = 0,
  ) => {
    if (!bg || disabled || event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    gesture.current = {
      pointerId: event.pointerId,
      kind,
      before: structuredClone(bg),
      start: position(event),
      index,
      selected: editing.selected,
    }
    drafts.begin(cameraId)
    svg.current?.setPointerCapture(event.pointerId)
  }
  const move = (event: ReactPointerEvent) => {
    const g = gesture.current
    if (!g || g.pointerId !== event.pointerId) return
    const p = position(event)
    const next = structuredClone(g.before)
    const t = next.transform
    if (g.kind === 'move') {
      t.x += (p.x - g.start.x) / 1800
      t.y += (p.y - g.start.y) / 1200
    }
    if (g.kind === 'scale') {
      const cx = t.x * 1800,
        cy = t.y * 1200
      const ratio =
        Math.hypot(p.x - cx, p.y - cy) / Math.max(1, Math.hypot(g.start.x - cx, g.start.y - cy))
      t.width = Math.min(20, Math.max(0.01, t.width * ratio))
    }
    if (g.kind === 'rotate') {
      const cx = t.x * 1800,
        cy = t.y * 1200
      const angle =
        ((Math.atan2(p.y - cy, p.x - cx) - Math.atan2(g.start.y - cy, g.start.x - cx)) * 180) /
        Math.PI
      t.rotationDeg = ((t.rotationDeg + angle + 540) % 360) - 180
    }
    if (g.kind === 'vertex') {
      const point = photoPoint(p, true)
      if (!point || !g.selected) return
      if (g.selected.kind === 'mask') {
        const m = next.masks.find((m) => m.id === g.selected?.id)
        if (m) {
          m.points[g.index] = point
          if (!validMask(m.points)) {
            setEditing({ ...editing, error: '该位置会使遮罩自交或重叠' })
            return
          }
        }
      } else {
        const line = next.guides.find((line) => line.id === g.selected?.id)
        if (line) line.points[g.index] = point
      }
    }
    t.x = Math.max(-10, Math.min(10, t.x))
    t.y = Math.max(-10, Math.min(10, t.y))
    drafts.preview(cameraId, next)
  }
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const target = e.target
      if (
        target instanceof HTMLElement &&
        (target.matches('input:not([type="range"]):not([type="checkbox"]),textarea,select') ||
          target.isContentEditable)
      )
        return
      if (disabled) return
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (gesture.current) {
          gesture.current = null
          drafts.end(cameraId, true)
          return
        }
        if (editing.points.length && !e.shiftKey)
          setEditing({ ...editing, points: editing.points.slice(0, -1), error: null })
        else if (e.shiftKey) drafts.redo(cameraId)
        else drafts.undo(cameraId)
      }
      if (e.key === 'Escape') {
        if (gesture.current) {
          gesture.current = null
          drafts.end(cameraId, true)
        }
        setEditing({ ...editing, points: [], error: null })
      }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [cameraId, disabled, drafts, editing, setEditing])
  useEffect(
    () => () => {
      drafts.end(cameraId, true)
    },
    [cameraId, drafts],
  )
  const selected =
    bg && editing.selected
      ? (editing.selected.kind === 'mask' ? bg.masks : bg.guides).find(
          (item) => item.id === editing.selected?.id,
        )
      : null
  return (
    <div
      className={`background-canvas${dragOver ? ' drag-over' : ''}`}
      onDragOver={(e) => {
        e.preventDefault()
        setDragOver(true)
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        e.stopPropagation()
        setDragOver(false)
        const file = e.dataTransfer.files[0]
        if (file && !disabled) upload(file)
      }}
    >
      {!bg && <div className="background-drop-hint">将背景图片拖到这里</div>}
      <svg
        ref={svg}
        viewBox="0 0 1800 1200"
        aria-label="背景编辑画布"
        role="application"
        tabIndex={0}
        onPointerMove={move}
        onPointerUp={(e) => {
          if (gesture.current?.pointerId === e.pointerId) {
            gesture.current = null
            drafts.end(cameraId)
          }
        }}
        onPointerCancel={() => {
          gesture.current = null
          drafts.end(cameraId, true)
        }}
        onPointerDown={(e) => {
          if (disabled || !bg || e.button !== 0) return
          if (editing.tool === 'move') {
            start(e, 'move')
            return
          }
          if (editing.tool === 'vertices') return
          const point = photoPoint(position(e))
          if (!point) {
            setEditing({ ...editing, error: '请在照片范围内落点' })
            return
          }
          if (editing.tool === 'mask') {
            if (editing.points.length >= 100) {
              setEditing({ ...editing, error: '单个遮罩最多 100 个点' })
              return
            }
            setEditing({ ...editing, points: [...editing.points, point], error: null })
          } else if (!editing.points.length)
            setEditing({ ...editing, points: [point], error: null })
          else if (bg.guides.length >= 100)
            setEditing({ ...editing, error: '最多添加 100 条辅助线' })
          else {
            drafts.commit(cameraId, {
              ...bg,
              guides: [
                ...bg.guides,
                { id: crypto.randomUUID(), points: [editing.points[0]!, point] },
              ],
            })
            setEditing({ ...editing, points: [], error: null })
          }
        }}
      >
        {bg && (
          <>
            <polygon
              points={points([
                [0, 0],
                [1, 0],
                [1, 1],
                [0, 1],
              ])}
              className="background-border"
            />
            {bg.masks.map((mask, i) => (
              <polygon
                key={mask.id}
                points={points(mask.points)}
                className={`background-mask ${editing.selected?.id === mask.id ? 'selected' : ''}`}
                onPointerDown={
                  editing.tool === 'vertices'
                    ? (e) => {
                        e.stopPropagation()
                        setEditing({
                          ...editing,
                          selected: { kind: 'mask', id: mask.id },
                          error: null,
                        })
                      }
                    : undefined
                }
              >
                <title>遮罩 {i + 1}</title>
              </polygon>
            ))}
            {bg.guidesVisible &&
              bg.guides.map((guide, i) => (
                <polyline
                  key={guide.id}
                  points={points(guide.points)}
                  className="background-guide"
                  onPointerDown={
                    editing.tool === 'vertices'
                      ? (e) => {
                          e.stopPropagation()
                          setEditing({
                            ...editing,
                            selected: { kind: 'guide', id: guide.id },
                            error: null,
                          })
                        }
                      : undefined
                  }
                >
                  <title>辅助线 {i + 1}</title>
                </polyline>
              ))}
            {editing.tool === 'move' && (
              <>
                {(
                  [
                    [0, 0],
                    [1, 0],
                    [1, 1],
                    [0, 1],
                  ] as BackgroundPoint[]
                ).map((p, i) => {
                  const at = project(p)
                  return (
                    <rect
                      key={i}
                      x={at.x - 7 * unit}
                      y={at.y - 7 * unit}
                      width={14 * unit}
                      height={14 * unit}
                      className="background-handle"
                      onPointerDown={(e) => start(e, 'scale')}
                    >
                      <title>等比缩放</title>
                    </rect>
                  )
                })}
                {(() => {
                  const at = project([0.5, 0.08])
                  return (
                    <circle
                      cx={at.x}
                      cy={at.y}
                      r={8 * unit}
                      className="background-handle"
                      onPointerDown={(e) => start(e, 'rotate')}
                    >
                      <title>旋转图片</title>
                    </circle>
                  )
                })()}
              </>
            )}
            {editing.tool === 'vertices' &&
              (editing.selected?.kind !== 'guide' || bg.guidesVisible) &&
              selected?.points.map((p, i) => {
                const at = project(p)
                return (
                  <circle
                    key={i}
                    cx={at.x}
                    cy={at.y}
                    r={7 * unit}
                    className="background-handle"
                    onPointerDown={(e) => start(e, 'vertex', i)}
                  >
                    <title>顶点 {i + 1}</title>
                  </circle>
                )
              })}
            {!!editing.points.length && (
              <>
                <polyline points={points(editing.points)} className="background-drawing" />
                {editing.points.map((p, i) => {
                  const at = project(p)
                  return (
                    <circle
                      key={i}
                      cx={at.x}
                      cy={at.y}
                      r={(i === 0 ? 8 : 5) * unit}
                      className="background-handle"
                      onPointerDown={
                        i === 0 && editing.tool === 'mask'
                          ? (e) => {
                              e.stopPropagation()
                              closeMask()
                            }
                          : undefined
                      }
                    />
                  )
                })}
              </>
            )}
          </>
        )}
      </svg>
    </div>
  )
}

/** Upload validation happens before any local image is replaced. */
export function validateBackgroundFile(file: File) {
  if (!['image/png', 'image/jpeg'].includes(file.type)) throw new Error('请选择 PNG 或 JPEG 图片')
  if (file.size > 16 * 1024 * 1024) throw new Error('图片不能超过 16 MiB')
  if (!file.size) throw new Error('图片文件为空')
}
