import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import type { DisplayTable } from '@store/shared'
import { buildTableScene } from './scene.ts'
import { shotAspect, slotContents, snapshotTable, viewKey } from './shots.ts'
import type { TableSnapshot, TableViewContext } from './shots.ts'

const cache = new Map<string, Promise<TableSnapshot>>()

function snapshot(table: DisplayTable, ctx: TableViewContext) {
  const key = viewKey(table, ctx, true)
  let shot = cache.get(key)
  if (!shot) {
    const aspect = shotAspect(table)
    shot = snapshotTable(table, ctx, {
      width: Math.round(aspect >= 1 ? 1200 : 1000 * aspect),
      height: Math.round(aspect >= 1 ? 1200 / aspect : 1000),
      names: true,
    })
    shot.catch(() => cache.delete(key))
    // Keep the latest few views; older contents are rarely shown again.
    if (cache.size > 60) cache.delete(cache.keys().next().value ?? '')
    cache.set(key, shot)
  }
  return shot
}

interface Table3DCardProps {
  table: DisplayTable
  ctx: TableViewContext
  units: { id: string; label: string }[]
  onPick: (slot: string, unit: string | null) => void
  disabled?: boolean
}

/**
 * A table in 3D, still: one picture from the entrance side with every slot's card. A click on a
 * card picks another unit (a transparent list over it); 旋转查看 opens a view to turn round.
 */
export function Table3DCard({ table, ctx, units, onPick, disabled }: Table3DCardProps) {
  const [shot, setShot] = useState<TableSnapshot | null>(null)
  const [failed, setFailed] = useState(false)
  const [open, setOpen] = useState(false)
  useEffect(() => {
    let live = true
    snapshot(table, ctx).then(
      (s) => {
        if (live) {
          setShot(s)
          setFailed(false)
        }
      },
      () => {
        if (live) setFailed(true)
      },
    )
    return () => {
      live = false
    }
  }, [table, ctx])

  if (failed) return <p className="notice">这台电脑的浏览器无法显示三维，请切换到“平面”。</p>
  return (
    <div className="table3d">
      <div className="table3d-picture" style={{ aspectRatio: String(shotAspect(table)) }}>
        {shot ? (
          <img src={shot.url} alt={`${table.label}桌三维示意`} />
        ) : (
          <span className="table3d-wait">正在生成三维…</span>
        )}
        {shot &&
          table.slots.map((s) => {
            const r = shot.slots[s.slot]
            if (!r) return null
            return (
              <select
                key={s.slot}
                className="table3d-pick"
                style={{
                  left: `${r.card.x * 100}%`,
                  top: `${r.card.y * 100}%`,
                  width: `${r.card.w * 100}%`,
                  height: `${r.card.h * 100}%`,
                }}
                value={s.unit ?? ''}
                disabled={disabled}
                aria-label={`${table.label}桌 ${s.slot}`}
                title={`${s.slot}：点击更换`}
                onChange={(event) => onPick(s.slot, event.target.value || null)}
              >
                <option value="">待定</option>
                {units.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.label}
                  </option>
                ))}
              </select>
            )
          })}
        <button type="button" className="table3d-turn" onClick={() => setOpen(true)}>
          旋转查看
        </button>
      </div>
      {open && <Table3DViewer table={table} ctx={ctx} onClose={() => setOpen(false)} />}
    </div>
  )
}

/** The table in a large live view: drag to turn, wheel to zoom. */
function Table3DViewer({
  table,
  ctx,
  onClose,
}: {
  table: DisplayTable
  ctx: TableViewContext
  onClose: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const [error, setError] = useState(false)
  useEffect(() => {
    const box = dialog.current
    if (box && !box.open) box.showModal?.()
  }, [])
  useEffect(() => {
    const element = canvas.current
    if (!element) return
    let disposed = false
    let cleanup = () => undefined as void
    void (async () => {
      const built = await buildTableScene({
        table,
        end: ctx.end,
        contents: slotContents(table, ctx),
        names: true,
      })
      if (disposed) {
        built.dispose()
        return
      }
      let renderer: THREE.WebGLRenderer
      try {
        renderer = new THREE.WebGLRenderer({ canvas: element, antialias: true })
      } catch {
        built.dispose()
        setError(true)
        return
      }
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
      renderer.toneMapping = THREE.ACESFilmicToneMapping
      renderer.toneMappingExposure = 0.95
      const camera = new THREE.PerspectiveCamera(30, 1, 0.05, 50)
      const resize = () => {
        const { clientWidth: w, clientHeight: h } = element
        renderer.setSize(w, h, false)
        camera.aspect = w / Math.max(h, 1)
        camera.updateProjectionMatrix()
      }
      resize()
      const aim = built.frame(camera)
      const controls = new OrbitControls(camera, element)
      controls.target.copy(aim)
      controls.enableDamping = true
      controls.maxPolarAngle = Math.PI / 2 - 0.05
      controls.update()
      let frame = 0
      const loop = () => {
        controls.update()
        renderer.render(built.scene, camera)
        frame = requestAnimationFrame(loop)
      }
      loop()
      const observer = new ResizeObserver(resize)
      observer.observe(element)
      cleanup = () => {
        cancelAnimationFrame(frame)
        observer.disconnect()
        controls.dispose()
        built.dispose()
        renderer.dispose()
        renderer.forceContextLoss()
      }
    })()
    return () => {
      disposed = true
      cleanup()
    }
  }, [table, ctx])

  return (
    <dialog
      ref={dialog}
      className="table3d-dialog"
      onClose={onClose}
      aria-label={`${table.label}桌三维`}
    >
      <header>
        <strong>{table.label}桌 · 拖动旋转，滚轮缩放</strong>
        <button
          type="button"
          onClick={() => {
            dialog.current?.close()
            onClose()
          }}
        >
          关闭
        </button>
      </header>
      {error ? (
        <p className="notice">这台电脑的浏览器无法显示三维。</p>
      ) : (
        <canvas ref={canvas} className="table3d-live" />
      )}
    </dialog>
  )
}
