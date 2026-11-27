import type { Facade, SiStyle, reviewFacade } from '@store/shared'

export type FacadePreview = NonNullable<ReturnType<typeof reviewFacade>>
export type FacadeFinish = 'panel' | 'screen' | 'trim' | 'light'
export type FacadePiece = {
  x: number
  y: number
  w: number
  h: number
  front: number
  depth: number
  finish: FacadeFinish
}

/** Preview setback/box depth only. Sheet gauges and installation details belong to the SI nodes. */
export function facadePieces(facade: Facade, reviewed: FacadePreview): FacadePiece[] {
  const { width, openingStart, openingEnd } = reviewed.frame
  const { clearHeight, fasciaHeight, screenInset } = facade
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
  const hasLight = reviewed.preset === 'led_strip'
  const jambFront = hasLight ? -screenInset : 0
  add(0, 0, openingStart, clearHeight, 'panel', jambFront)
  add(openingEnd, 0, width - openingEnd, clearHeight, 'panel', jambFront)
  if (!reviewed.usesLed) {
    add(0, clearHeight, width, fasciaHeight, 'panel')
    return pieces
  }

  const screenWidth = reviewed.previewScreenWidth
  const screenStart = (width - screenWidth) / 2
  const rail = Math.min(hasLight ? 0.04 : 0.02, fasciaHeight / 4)
  const head = clearHeight + fasciaHeight
  const sideDepth = Math.max(0.09, screenInset + 0.035)
  add(0, clearHeight, screenStart, fasciaHeight, 'panel', jambFront, sideDepth)
  add(
    screenStart + screenWidth,
    clearHeight,
    screenStart,
    fasciaHeight,
    'panel',
    jambFront,
    sideDepth,
  )
  add(
    screenStart,
    clearHeight + rail,
    screenWidth,
    fasciaHeight - 2 * rail,
    'screen',
    -screenInset,
    0.03,
  )
  add(screenStart, clearHeight, screenWidth, rail, hasLight ? 'trim' : 'panel')
  add(screenStart, head - rail, screenWidth, rail, hasLight ? 'trim' : 'panel')
  if (hasLight)
    add(screenStart, clearHeight + rail * 0.18, screenWidth, rail * 0.34, 'light', 0.003, 0.008)
  return pieces
}

export function facadeColors(siStyle: SiStyle) {
  return {
    panel: siStyle === 'SI1.0' ? '#999c9e' : '#42444a',
    screen: '#536d7e',
    trim: '#c0c3c5',
    light: '#fff1d3',
  } as const
}
