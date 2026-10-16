import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import type { DisplayTable } from '@store/shared'
import { buildTableScene } from './scene.ts'
import type { TableScene } from './scene.ts'
import { drawInto, shotAspect, slotContents, viewKey } from './shots.ts'
import type { TableViewContext } from './shots.ts'

interface Table3DCardProps {
  table: DisplayTable
  ctx: TableViewContext
  /** A click on a card (not a drag): which slot, and where on the page. */
  onSlotClick: (slot: string, at: { x: number; y: number }) => void
}

/** Pointer travel (px) that turns a press into a drag rather than a click. */
const DRAG = 5

/**
 * A table in 3D that turns with the mouse: drag to look round it, click a card to change what
 * the slot holds. Every card faces the viewer. The pictures come from one shared renderer and are
 * copied onto this card's own 2D canvas, so a page of tables uses a single WebGL context.
 */
export function Table3DCard({ table, ctx, onSlotClick }: Table3DCardProps) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const camera = useRef<THREE.PerspectiveCamera | null>(null)
  const aim = useRef<THREE.Vector3 | null>(null)
  const built = useRef<TableScene | null>(null)
  const controls = useRef<OrbitControls | null>(null)
  const draw = useRef<() => void>(() => undefined)
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading')
  const [hover, setHover] = useState(false)
  const clickRef = useRef(onSlotClick)
  useEffect(() => {
    clickRef.current = onSlotClick
  })
  const key = viewKey(table, ctx, true)
  const aspect = shotAspect(table)

  // Camera, controls and drawing live as long as the card; the view survives content changes.
  useEffect(() => {
    const element = canvas.current
    if (!element) return
    const cam = new THREE.PerspectiveCamera(30, aspect, 0.05, 50)
    camera.current = cam
    const orbit = new OrbitControls(cam, element)
    orbit.enableZoom = false
    orbit.enablePan = false
    orbit.maxPolarAngle = Math.PI / 2 - 0.05
    controls.current = orbit
    let frame = 0
    draw.current = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const scene = built.current
        if (!scene) return
        scene.fit(cam, orbit.target)
        try {
          drawInto(element, scene.scene, cam)
        } catch {
          setState('failed')
        }
      })
    }
    orbit.addEventListener('change', () => draw.current())
    const resize = () => {
      const ratio = Math.min(window.devicePixelRatio || 1, 2)
      const width = Math.round(element.clientWidth * ratio)
      const height = Math.round(element.clientHeight * ratio)
      if (!width || !height) return
      if (element.width !== width || element.height !== height) {
        element.width = width
        element.height = height
      }
      cam.aspect = width / height
      cam.updateProjectionMatrix()
      draw.current()
    }
    const observer = new ResizeObserver(resize)
    observer.observe(element)
    resize()
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      orbit.dispose()
      built.current?.dispose()
      built.current = null
      aim.current = null
    }
  }, [aspect])

  // Rebuild the table whenever what stands on it changes; keep the current view.
  useEffect(() => {
    let live = true
    buildTableScene({
      table,
      end: ctx.end,
      contents: slotContents(table, ctx),
      names: true,
    }).then(
      (next) => {
        if (!live) {
          next.dispose()
          return
        }
        const cam = camera.current
        const orbit = controls.current
        built.current?.dispose()
        built.current = next
        if (cam && orbit && !aim.current) {
          aim.current = next.frame(cam)
          orbit.target.copy(aim.current)
          orbit.update()
        }
        setState('ready')
        draw.current()
      },
      () => {
        if (live) setState('failed')
      },
    )
    return () => {
      live = false
    }
    // `key` stands for the table's contents and look.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  const slotUnder = (event: { clientX: number; clientY: number }) => {
    const rect = canvas.current?.getBoundingClientRect()
    const scene = built.current
    const cam = camera.current
    if (!rect || !scene || !cam) return null
    return scene.slotAt(cam, {
      x: ((event.clientX - rect.left) / rect.width) * 2 - 1,
      y: -((event.clientY - rect.top) / rect.height) * 2 + 1,
    })
  }
  const pressed = useRef<{ x: number; y: number } | null>(null)

  function resetView() {
    const cam = camera.current
    const orbit = controls.current
    const scene = built.current
    if (!cam || !orbit || !scene) return
    aim.current = scene.frame(cam)
    orbit.target.copy(aim.current)
    orbit.update()
    draw.current()
  }

  if (state === 'failed')
    return <p className="notice">这台电脑的浏览器无法显示三维，请切换到“平面”。</p>
  return (
    <div className="table3d-picture" style={{ aspectRatio: String(aspect) }}>
      <canvas
        ref={canvas}
        className="table3d-canvas"
        style={{ cursor: hover ? 'pointer' : 'grab' }}
        aria-label={`${table.label}桌三维：拖动旋转，点立牌更换产品`}
        onPointerDown={(event) => {
          pressed.current = { x: event.clientX, y: event.clientY }
        }}
        onPointerUp={(event) => {
          const from = pressed.current
          pressed.current = null
          if (!from || Math.hypot(event.clientX - from.x, event.clientY - from.y) > DRAG) return
          const slot = slotUnder(event)
          if (slot) clickRef.current(slot, { x: event.clientX + 8, y: event.clientY + 8 })
        }}
        onPointerMove={(event) => {
          if (event.buttons) return
          setHover(slotUnder(event) !== null)
        }}
        onPointerLeave={() => setHover(false)}
      />
      {state === 'loading' && <span className="table3d-wait">正在生成三维…</span>}
      <button type="button" className="table3d-reset" onClick={resetView}>
        复位视角
      </button>
    </div>
  )
}
