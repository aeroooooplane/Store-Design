import type { Facade, FacadeSection, SiStyle, reviewFacade } from '@store/shared'

export type FacadePreview = NonNullable<ReturnType<typeof reviewFacade>>
export type FacadeFinish = 'panel' | 'screen' | 'trim' | 'light' | 'display'
export type FacadePiece = {
  x: number
  y: number
  w: number
  h: number
  front: number
  depth: number
  finish: FacadeFinish
}

/** Preview depth only. Sheet gauges and installation details belong to the SI nodes. */
export function sectionPieces(section: FacadeSection): FacadePiece[] {
  const { frame, fasciaBottom, fasciaHeight, openings, screens, screenInset, lightStrip } = section
  const pieces: FacadePiece[] = []
  function add(
    x: number,
    y: number,
    w: number,
    h: number,
    finish: FacadeFinish,
    front = 0,
    depth = 0.09,
  ) {
    if (w >= 0.001 && h >= 0.001) pieces.push({ x, y, w, h, finish, front, depth })
  }
  const jambFront = lightStrip ? -screenInset : 0
  if (!section.beamOnly) {
    let edge = 0
    for (const opening of openings) {
      const display = section.display && Math.abs(edge - section.display.start) < 0.001
      add(edge, 0, opening.start - edge, fasciaBottom, display ? 'display' : 'panel', jambFront)
      add(
        opening.start,
        opening.height,
        opening.end - opening.start,
        fasciaBottom - opening.height,
        'panel',
        jambFront,
      )
      edge = opening.end
    }
    add(edge, 0, frame.width - edge, fasciaBottom, 'panel', jambFront)
  }
  if (section.posts) {
    add(0, 0, section.posts, fasciaBottom, 'panel')
    add(frame.width - section.posts, 0, section.posts, fasciaBottom, 'panel')
  }
  if (screens.length === 0) {
    add(0, fasciaBottom, frame.width, fasciaHeight, 'panel')
    return pieces
  }
  const rail = Math.min(lightStrip ? 0.04 : 0.02, fasciaHeight / 4)
  const head = fasciaBottom + fasciaHeight
  const sideDepth = Math.max(0.09, screenInset + 0.035)
  let end = 0
  for (const { start, width } of screens) {
    add(end, fasciaBottom, start - end, fasciaHeight, 'panel', jambFront, sideDepth)
    add(start, fasciaBottom + rail, width, fasciaHeight - 2 * rail, 'screen', -screenInset, 0.03)
    add(start, fasciaBottom, width, rail, lightStrip ? 'trim' : 'panel')
    add(start, head - rail, width, rail, lightStrip ? 'trim' : 'panel')
    if (lightStrip)
      add(start, fasciaBottom + rail * 0.18, width, rail * 0.34, 'light', 0.003, 0.008)
    end = start + width
  }
  add(end, fasciaBottom, frame.width - end, fasciaHeight, 'panel', jambFront, sideDepth)
  return pieces
}

export function facadePieces(facade: Facade, reviewed: FacadePreview): FacadePiece[] {
  const { frame } = reviewed
  return sectionPieces({
    label: '正看门头',
    frame,
    fasciaBottom: facade.clearHeight,
    fasciaHeight: facade.fasciaHeight,
    openings: [{ start: frame.openingStart, end: frame.openingEnd, height: facade.clearHeight }],
    screens: reviewed.usesLed
      ? [
          {
            start: (frame.width - reviewed.previewScreenWidth) / 2,
            width: reviewed.previewScreenWidth,
          },
        ]
      : [],
    screenInset: facade.screenInset,
    lightStrip: reviewed.preset === 'led_strip',
    logos: [],
  })
}

export function facadeColors(siStyle: SiStyle) {
  return {
    panel: siStyle === 'SI1.0' ? '#999c9e' : '#42444a',
    screen: '#536d7e',
    trim: '#c0c3c5',
    light: '#fff1d3',
    display: '#bfc4c7',
  } as const
}
