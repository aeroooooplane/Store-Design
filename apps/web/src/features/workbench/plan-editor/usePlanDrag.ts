import { useRef } from 'react'
import type { Dispatch, PointerEvent as ReactPointerEvent } from 'react'
import type { LayoutItem, Space } from '@store/shared'
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

/** Dragging props on the plan: one undo step per drag, magnetic snapping unless Alt is held. */
export function usePlanDrag(space: Space, dispatch: Dispatch<EditorAction>) {
  const svgRef = useRef<SVGSVGElement>(null)
  const drag = useRef<{ id: string; dx: number; dz: number; group: string } | null>(null)

  function onItemPointerDown(item: LayoutItem, event: ReactPointerEvent<SVGGElement>) {
    event.stopPropagation()
    dispatch({ type: 'select', id: item.id })
    const world = toWorld(svgRef.current, event)
    if (!world || item.locked) return
    drag.current = {
      id: item.id,
      dx: world[0] - item.cx,
      dz: world[1] - item.cz,
      group: `drag:${item.id}:${event.timeStamp}`,
    }
    svgRef.current?.setPointerCapture(event.pointerId)
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!drag.current) return
    const world = toWorld(svgRef.current, event)
    if (world)
      dispatch({
        type: 'move',
        id: drag.current.id,
        cx: world[0] - drag.current.dx,
        cz: world[1] - drag.current.dz,
        group: drag.current.group,
        // Hold Alt to place freely without sticking to walls and neighbours.
        snapTo: event.altKey ? null : space,
      })
  }

  /** Pointer up or cancel on the canvas ends the drag. */
  const endDrag = () => (drag.current = null)

  return { svgRef, onItemPointerDown, onPointerMove, endDrag }
}
