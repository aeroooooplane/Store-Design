import { useEffect, useMemo, useRef, useState } from 'react'
import { validateSpace } from '@store/shared'
import type { Space, ShopType } from '@store/shared'
import outlineHtml from './outline-sketch.html?raw'
import { sketchToSpace, spaceToSketch } from './space-sketch.ts'
import type { SpaceSketch } from './space-sketch.ts'
import './space-capture.css'

interface SpaceCaptureEditorProps {
  shop: ShopType
  initial?: Space
  initialName?: string
  submitLabel?: string
  hideName?: boolean
  onSubmit: (space: Space, name: string) => Promise<void>
  onCancel?: (() => void) | undefined
}

/** The sandboxed canvas only edits geometry. Validation and persistence belong to the workbench. */
export function SpaceCaptureEditor({
  shop,
  initial,
  initialName,
  submitLabel,
  hideName = false,
  onSubmit,
  onCancel,
}: SpaceCaptureEditorProps) {
  const frame = useRef<HTMLIFrameElement>(null)
  const channel = useRef<MessagePort | null>(null)
  const [name, setName] = useState(initialName ?? (initial ? '空间 · v2' : '空间 A'))
  const [pending, setPending] = useState(false)
  const settings = useRef({ name, onSubmit })
  const source = useMemo(() => spaceToSketch(shop, initial), [shop, initial])
  useEffect(() => {
    settings.current = { name, onSubmit }
  }, [name, onSubmit])
  useEffect(
    () => () => {
      channel.current?.close()
    },
    [],
  )

  function sendResult(port: MessagePort, error?: string) {
    port.postMessage({ type: 'submission-finished', error })
  }

  function connect() {
    const targetWindow = frame.current?.contentWindow
    if (!targetWindow) return
    channel.current?.close()
    const { port1, port2 } = new MessageChannel()
    channel.current = port1
    let saving = false
    port1.onmessage = (event: MessageEvent<{ type: string; state: SpaceSketch }>) => {
      if (event.data?.type !== 'submit' || saving) return
      const { name, onSubmit } = settings.current
      if (!name.trim()) return sendResult(port1, '请填写空间名称')
      if (!event.data.state.closed) return sendResult(port1, '请先闭合轮廓')
      const parsed = sketchToSpace(event.data.state, initial)
      if (!parsed.success) {
        return sendResult(port1, '无法保存，请检查轮廓、层高或开口数量')
      }
      const issue = validateSpace(parsed.data).find((i) => i.severity === 'error')
      if (issue) return sendResult(port1, issue.message)
      saving = true
      setPending(true)
      void onSubmit(parsed.data, name.trim())
        .then(
          () => sendResult(port1),
          () => sendResult(port1, '保存失败，请检查工作台提示后重试'),
        )
        .finally(() => {
          saving = false
          setPending(false)
        })
    }
    targetWindow.postMessage(
      {
        type: 'store-space-capture',
        submitLabel,
        state: { ...source.sketch, ortho: false },
        preserveOpenings: initial !== undefined,
        fixedObstacles: source.fixedObstacles.map(({ obstacle }) =>
          obstacle.polygon.map(([x, z]) => [x * 1000, z * 1000]),
        ),
      },
      '*',
      [port2],
    )
  }

  return (
    <section className="space-capture" aria-label="空间编辑">
      <div className="row">
        {!hideName && (
          <label className="field">
            空间名称
            <input
              maxLength={100}
              value={name}
              disabled={pending}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
        )}
        {onCancel && (
          <button type="button" disabled={pending} onClick={onCancel}>
            取消
          </button>
        )}
      </div>
      <iframe
        ref={frame}
        title="空间画布"
        sandbox="allow-scripts"
        srcDoc={outlineHtml}
        onLoad={connect}
      />
    </section>
  )
}
