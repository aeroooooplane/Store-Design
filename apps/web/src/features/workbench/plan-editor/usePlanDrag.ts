import { useRef, useState } from 'react'
import type { Dispatch, PointerEvent as ReactPointerEvent } from 'react'
import { rotationTowards, scaleFromEnd, snapRotation } from '@store/shared'
import type { Asset, Fixture, FrontAxis, LayoutItem, Point, Rect, Space } from '@store/shared'
import type { EditorAction } from '../editor-state.ts'

function toWorld(
  svg: SVGSVGElement | null,
  event: { clientX: number; clientY: number },
): [number, number] | null {
  const matrix = svg?.getScreenCTM()
  if (!svg || !matrix) return null
  const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse())
  return [point.x, point.y]
}

const rectOf = (a: Point, b: Point): Rect => ({
  minX: Math.min(a[0], b[0]),
  maxX: Math.max(a[0], b[0]),
  minZ: Math.min(a[1], b[1]),
  maxZ: Math.max(a[1], b[1]),
})

/**
 * Dragging props and partitions on the plan: one undo step per drag, magnetic snapping unless
 * Alt is held. `frontOf` gives a model's front, which a wall piece turns into the shop. With
 * `drawing` on (画空心隔板), a drag draws a partition instead; `onDrawn` ends the mode. A LOGO's
 * end grip resizes it uniformly, the other end staying put (`assetOf` gives its model).
 */
export function usePlanDrag(
  space: Space,
  dispatch: Dispatch<EditorAction>,
  frontOf: (item: LayoutItem) => FrontAxis | null,
  drawing = false,
  onDrawn?: () => void,
  assetOf?: (item: LayoutItem) => Asset | undefined,
) {
  const svgRef = useRef<SVGSVGElement>(null)
  const drag = useRef<{
    kind: 'item' | 'fixture'
    id: string
    dx: number
    dz: number
    group: string
    front: FrontAxis | null
  } | null>(null)
  /** An end grip being dragged: the LOGO as it was when the drag began, so its other end stays. */
  const resize = useRef<{
    start: LayoutItem
    end: -1 | 1
    asset: Asset
    group: string
  } | null>(null)
  /** The rotation handle being dragged: the prop's centre and size, which a turn keeps. */
  const turn = useRef<{ item: LayoutItem; group: string } | null>(null)
  /** The wall a turned prop has snapped parallel or square to, shown while turning. */
  const [guide, setGuide] = useState<{ a: Point; b: Point } | null>(null)
  const drawStart = useRef<Point | null>(null)
  /** The rectangle being drawn, shown on the plan until the pointer is released. */
  const [draft, setDraft] = useState<Rect | null>(null)

  function onItemPointerDown(item: LayoutItem, event: ReactPointerEvent<SVGGElement>) {
    event.stopPropagation()
    dispatch({ type: 'select', id: item.id })
    const world = toWorld(svgRef.current, event)
    if (!world || item.locked) return
    drag.current = {
      kind: 'item',
      id: item.id,
      dx: world[0] - item.cx,
      dz: world[1] - item.cz,
      group: `drag:${item.id}:${event.timeStamp}`,
      front: frontOf(item),
    }
    svgRef.current?.setPointerCapture(event.pointerId)
  }

  function onFixturePointerDown(fixture: Fixture, event: ReactPointerEvent<SVGGElement>) {
    event.stopPropagation()
    dispatch({ type: 'select', id: fixture.id })
    const world = toWorld(svgRef.current, event)
    if (!world) return
    drag.current = {
      kind: 'fixture',
      id: fixture.id,
      dx: world[0] - fixture.cx,
      dz: world[1] - fixture.cz,
      group: `drag:${fixture.id}:${event.timeStamp}`,
      front: null,
    }
    svgRef.current?.setPointerCapture(event.pointerId)
  }

  function onResizeHandlePointerDown(
    item: LayoutItem,
    end: -1 | 1,
    event: ReactPointerEvent<SVGGElement>,
  ) {
    event.stopPropagation()
    dispatch({ type: 'select', id: item.id })
    const asset = assetOf?.(item)
    if (!asset || item.locked) return
    resize.current = { start: item, end, asset, group: `resize:${item.id}:${event.timeStamp}` }
    svgRef.current?.setPointerCapture(event.pointerId)
  }

  /** The rotation handle: the prop turns towards the pointer (see snapRotation). */
  function onRotateHandlePointerDown(item: LayoutItem, event: ReactPointerEvent<SVGGElement>) {
    event.stopPropagation()
    dispatch({ type: 'select', id: item.id })
    if (item.locked) return
    turn.current = { item, group: `turn:${item.id}:${event.timeStamp}` }
    svgRef.current?.setPointerCapture(event.pointerId)
  }

  /** In drawing mode a press anywhere on the plan (props included) starts a rectangle. */
  function onDrawPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (!drawing) return
    const world = toWorld(svgRef.current, event)
    if (!world) return
    event.stopPropagation()
    drawStart.current = world
    setDraft(rectOf(world, world))
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const world = toWorld(svgRef.current, event)
    if (!world) return
    if (drawStart.current) {
      setDraft(rectOf(drawStart.current, world))
      return
    }
    if (turn.current) {
      // Hold Alt to turn freely; otherwise it snaps to nearby walls, then to 15° steps.
      const { item, group } = turn.current
      const snapped = snapRotation(
        rotationTowards([item.cx, item.cz], world),
        item,
        space,
        event.altKey,
      )
      setGuide(snapped.wall ? { a: snapped.wall.a, b: snapped.wall.b } : null)
      dispatch({ type: 'turn', id: item.id, rotation: snapped.rotation, group })
      return
    }
    if (resize.current) {
      const { start, end, asset, group } = resize.current
      const placed = scaleFromEnd(start, asset.footprint, end, world)
      dispatch({
        type: 'scale',
        id: start.id,
        asset,
        scale: placed.scale,
        at: { cx: placed.cx, cz: placed.cz },
        space,
        front: asset.front,
        group,
      })
      return
    }
    if (!drag.current) return
    // Hold Alt to place freely without sticking to walls and neighbours.
    const snapTo = event.altKey ? null : space
    const cx = world[0] - drag.current.dx
    const cz = world[1] - drag.current.dz
    const group = drag.current.group
    if (drag.current.kind === 'fixture') {
      dispatch({ type: 'moveFixture', id: drag.current.id, cx, cz, group, snapTo })
      return
    }
    dispatch({
      type: 'move',
      id: drag.current.id,
      cx,
      cz,
      group,
      snapTo,
      front: drag.current.front,
    })
  }

  /** Pointer up on the canvas ends a drag or adds the drawn partition; cancel drops it. */
  function endDrag(event?: ReactPointerEvent<HTMLDivElement>) {
    drag.current = null
    resize.current = null
    turn.current = null
    setGuide(null)
    const start = drawStart.current
    if (!start) return
    drawStart.current = null
    setDraft(null)
    const world = event?.type === 'pointerup' ? toWorld(svgRef.current, event) : null
    if (!world) return
    dispatch({ type: 'addFixture', rect: rectOf(start, world), space, snap: !event?.altKey })
    onDrawn?.()
  }

  return {
    svgRef,
    onItemPointerDown,
    onFixturePointerDown,
    onResizeHandlePointerDown,
    onRotateHandlePointerDown,
    onDrawPointerDown,
    onPointerMove,
    endDrag,
    draft,
    guide,
  }
}
