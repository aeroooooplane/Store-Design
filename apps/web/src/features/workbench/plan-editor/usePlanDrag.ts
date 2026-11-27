import { useRef, useState } from 'react'
import type { Dispatch, PointerEvent as ReactPointerEvent } from 'react'
import {
  isWallArt,
  wallArtFromEnd,
  rotationTowards,
  scaleFromEnd,
  isCustomLogo,
  customLogoFootprint,
  DEFAULT_LOGO_TEXT,
  snapRotation,
  fixtureRect,
  fixtureSnapTargets,
  previewDrawnFixture,
  previewFixtureEdgeResize,
} from '@store/shared'
import type {
  Asset,
  Fixture,
  FixtureDragPreview,
  FixtureEdge,
  FrontAxis,
  Layout,
  LayoutItem,
  Point,
  ShopType,
  Space,
} from '@store/shared'
import type { EditorAction } from '../editor-state.ts'

export function toWorld(
  svg: SVGSVGElement | null,
  event: { clientX: number; clientY: number },
): [number, number] | null {
  const matrix = svg?.getScreenCTM()
  if (!svg || !matrix) return null
  const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse())
  return [point.x, point.y]
}

type FixtureGesture = {
  point: Point
  pointer: number
  capture: Element
  targets: ReturnType<typeof fixtureSnapTargets>
} & (
  | { kind: 'draw' }
  | { kind: 'resize'; fixture: Fixture; edge: FixtureEdge }
  | { kind: 'rotate'; fixture: Fixture }
)

/**
 * Dragging props and partitions on the plan: one undo step per drag, magnetic snapping unless
 * Alt is held. `frontOf` gives a model's front, which turns away from the chosen wall face. With
 * `drawing` on (画空心隔板), a drag draws a partition instead; `onDrawn` ends the mode. A LOGO's
 * end grip resizes it uniformly, the other end staying put (`assetOf` gives its model).
 */
export function usePlanDrag(
  space: Space,
  shopType: ShopType,
  layout: Layout,
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
    asset: Asset | undefined
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
  const fixtureGesture = useRef<FixtureGesture | null>(null)
  const [fixturePreview, setFixturePreview] = useState<
    (FixtureDragPreview & { fixtureId?: string; turning?: boolean }) | null
  >(null)

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
      asset: assetOf?.(item),
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
      asset: undefined,
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

  function onFixtureResize(
    fixture: Fixture,
    edge: FixtureEdge,
    event: ReactPointerEvent<SVGLineElement>,
  ) {
    if (event.button !== 0 || fixtureGesture.current) return
    const point = toWorld(svgRef.current, event)
    if (!point) return
    event.stopPropagation()
    dispatch({ type: 'select', id: fixture.id })
    const capture = svgRef.current ?? event.currentTarget
    fixtureGesture.current = {
      kind: 'resize',
      fixture,
      edge,
      point,
      capture,
      pointer: event.pointerId,
      targets: fixtureSnapTargets(
        space,
        shopType,
        layout.items,
        (layout.fixtures ?? []).filter((item) => item.id !== fixture.id),
        true,
      ),
    }
    capture.setPointerCapture(event.pointerId)
  }

  function onFixtureRotate(fixture: Fixture, event: ReactPointerEvent<SVGGElement>) {
    if (event.button !== 0 || fixtureGesture.current) return
    const capture = svgRef.current
    const point = toWorld(capture, event)
    if (!capture || !point) return
    event.stopPropagation()
    fixtureGesture.current = {
      kind: 'rotate',
      fixture,
      point,
      capture,
      pointer: event.pointerId,
      targets: [],
    }
    capture.setPointerCapture(event.pointerId)
    setFixturePreview({
      ...getFixturePreview(fixtureGesture.current, point, false),
      fixtureId: fixture.id,
      turning: true,
    })
  }

  function getFixturePreview(
    gesture: FixtureGesture,
    point: Point,
    alt: boolean,
  ): FixtureDragPreview {
    const targets = alt ? [] : gesture.targets
    if (gesture.kind === 'draw') return previewDrawnFixture(gesture.point, point, targets)
    const { fixture } = gesture
    if (gesture.kind === 'resize')
      return previewFixtureEdgeResize(fixture, gesture.edge, gesture.point, point, targets)

    const centre: Point = [fixture.cx, fixture.cz]
    const initial = fixture.rotation ?? 0
    const rect = fixtureRect(fixture)
    if (
      (gesture.point[0] === point[0] && gesture.point[1] === point[1]) ||
      Math.hypot(point[0] - fixture.cx, point[1] - fixture.cz) < 0.01
    )
      return { rect, rotation: initial, guides: [], valid: true }
    const angle = initial + rotationTowards(centre, point) - rotationTowards(centre, gesture.point)
    const snapped = snapRotation(angle, fixture, space, alt)
    return {
      rect,
      rotation: snapped.rotation,
      guides: snapped.wall ? [snapped.wall] : [],
      valid: true,
    }
  }

  /** In drawing mode a press anywhere on the plan (props included) starts a rectangle. */
  function onDrawPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (!drawing || event.button !== 0 || fixtureGesture.current) return
    const point = toWorld(svgRef.current, event)
    if (!point) return
    event.stopPropagation()
    event.preventDefault()
    const capture = event.currentTarget
    fixtureGesture.current = {
      kind: 'draw',
      point,
      capture,
      pointer: event.pointerId,
      targets: fixtureSnapTargets(space, shopType, layout.items, layout.fixtures ?? []),
    }
    capture.setPointerCapture(event.pointerId)
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const world = toWorld(svgRef.current, event)
    if (!world) return
    const currentFixture = fixtureGesture.current
    if (currentFixture) {
      if (currentFixture.pointer === event.pointerId) {
        const preview = getFixturePreview(currentFixture, world, event.altKey)
        setFixturePreview(
          currentFixture.kind === 'draw'
            ? preview
            : {
                ...preview,
                fixtureId: currentFixture.fixture.id,
                turning: currentFixture.kind === 'rotate',
              },
        )
      }
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
      if (isWallArt(start)) {
        const placed = wallArtFromEnd(start, end, world)
        dispatch({
          type: 'resizeWallArt',
          id: start.id,
          width: placed.w,
          height: placed.h,
          at: placed,
          space,
          group,
        })
        return
      }
      const placed = scaleFromEnd(
        start,
        isCustomLogo(start)
          ? customLogoFootprint(start.logoText ?? DEFAULT_LOGO_TEXT)
          : asset.footprint,
        end,
        world,
      )
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
      dragBoundary: space.boundary,
      front: drag.current.front,
      asset: drag.current.asset,
    })
  }

  /** Pointer up on the canvas ends a drag or adds the drawn partition; cancel drops it. */
  function endDrag(event?: ReactPointerEvent<HTMLDivElement>) {
    drag.current = null
    resize.current = null
    turn.current = null
    setGuide(null)
    const current = fixtureGesture.current
    if (!current || (event && current.pointer !== event.pointerId)) return
    fixtureGesture.current = null
    setFixturePreview(null)
    if (current.capture.hasPointerCapture(current.pointer))
      current.capture.releasePointerCapture(current.pointer)
    const world = event?.type === 'pointerup' ? toWorld(svgRef.current, event) : null
    if (!world) return
    const preview = getFixturePreview(current, world, event?.altKey ?? false)
    if (!preview.valid) return
    if (current.kind === 'draw') {
      dispatch({ type: 'addFixture', rect: preview.rect, space, snap: false })
      onDrawn?.()
    } else if (current.kind === 'resize') {
      dispatch({ type: 'resizeFixture', id: current.fixture.id, rect: preview.rect })
    } else if (preview.rotation !== undefined) {
      dispatch({ type: 'turnFixture', id: current.fixture.id, rotation: preview.rotation })
    }
  }

  return {
    svgRef,
    onItemPointerDown,
    onFixturePointerDown,
    onFixtureResize,
    onFixtureRotate,
    onResizeHandlePointerDown,
    onRotateHandlePointerDown,
    onDrawPointerDown,
    onPointerMove,
    endDrag,
    fixturePreview,
    guide,
  }
}
