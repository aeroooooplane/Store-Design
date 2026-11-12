/** Full-resolution raster geometry. No PDF paths, store labels, cloud calls or model weights. */
export type FinePoint = [number, number]
export interface FineText {
  text: string
  x: number
  y: number
  w: number
  h: number
}
export interface FineCandidate {
  id: string
  kind: 'furniture' | 'column' | 'wall-display' | 'unknown'
  geometry: { type: 'polygon'; points: FinePoint[] }
  label: string
  evidence: string
  origin: 'automatic'
  confidence: number
  fillRatio: number
  angle: number
}
export interface FineLine {
  id: string
  a: FinePoint
  b: FinePoint
  width: number
}
export interface FineGeometry {
  schemaVersion: 1
  engine: 'raster-fine-v1'
  width: number
  height: number
  inverted: boolean
  candidates: FineCandidate[]
  lines: FineLine[]
  texts: FineText[]
  pending: string[]
  completeAutomatically: false
  seconds: number
}

const cross = (o: FinePoint, a: FinePoint, b: FinePoint) =>
  (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
function hull(points: FinePoint[]): FinePoint[] {
  points.sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const half = (ps: FinePoint[]) => {
    const result: FinePoint[] = []
    for (const p of ps) {
      while (
        result.length >= 2 &&
        cross(result[result.length - 2]!, result[result.length - 1]!, p) <= 0
      )
        result.pop()
      result.push(p)
    }
    return result
  }
  return [...half(points).slice(0, -1), ...half([...points].reverse()).slice(0, -1)]
}
function polygonArea(points: FinePoint[]) {
  return Math.abs(
    points.reduce((s, p, i) => {
      const q = points[(i + 1) % points.length]!
      return s + p[0] * q[1] - q[0] * p[1]
    }, 0) / 2,
  )
}

/** Minimum-area enclosing rectangle; keeps oblique furniture instead of snapping it to axes. */
function rectangle(points: FinePoint[]) {
  let best: { area: number; points: FinePoint[]; angle: number; w: number; h: number } | null = null
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!,
      b = points[(i + 1) % points.length]!,
      angle = Math.atan2(b[1] - a[1], b[0] - a[0]),
      c = Math.cos(angle),
      s = Math.sin(angle)
    let loX = Infinity,
      hiX = -Infinity,
      loY = Infinity,
      hiY = -Infinity
    for (const p of points) {
      const x = p[0] * c + p[1] * s,
        y = -p[0] * s + p[1] * c
      loX = Math.min(loX, x)
      hiX = Math.max(hiX, x)
      loY = Math.min(loY, y)
      hiY = Math.max(hiY, y)
    }
    const area = (hiX - loX) * (hiY - loY)
    if (!best || area < best.area) {
      const local: FinePoint[] = [
        [loX, loY],
        [hiX, loY],
        [hiX, hiY],
        [loX, hiY],
      ]
      best = {
        area,
        points: local.map(([x, y]) => [x * c - y * s, x * s + y * c]),
        angle: (angle * 180) / Math.PI,
        w: hiX - loX,
        h: hiY - loY,
      }
    }
  }
  return best
}

function axisLines(ink: Uint8Array, width: number, height: number): FineLine[] {
  const lines: FineLine[] = []
  for (const vertical of [false, true]) {
    const outer = vertical ? width : height,
      inner = vertical ? height : width,
      groups = new Map<string, { lo: number; hi: number; a: number; b: number }>(),
      all: { lo: number; hi: number; a: number; b: number }[] = []
    for (let at = 0; at < outer; at++) {
      let start = -1
      for (let j = 0; j <= inner; j++) {
        const hit = j < inner && ink[vertical ? j * width + at : at * width + j] === 1
        if (hit && start < 0) start = j
        if (!hit && start >= 0) {
          if (j - start >= Math.max(20, width / 110)) {
            const key = `${Math.round(start / 3)},${Math.round(j / 3)}`,
              last = groups.get(key)
            if (last && at - last.hi <= 2) last.hi = at
            else {
              const group = { lo: at, hi: at, a: start, b: j - 1 }
              groups.set(key, group)
              all.push(group)
            }
          }
          start = -1
        }
      }
    }
    for (const g of all) {
      if (g.hi - g.lo > 8) continue
      const at = (g.lo + g.hi) / 2
      lines.push({
        id: `L${lines.length + 1}`,
        a: vertical ? [at, g.a] : [g.a, at],
        b: vertical ? [at, g.b] : [g.b, at],
        width: g.hi - g.lo + 1,
      })
    }
  }
  if (lines.length > 10000) throw new Error('线段过多，请先裁取门店区域；没有截断结果')
  return lines
}

function classify(candidate: FineCandidate, texts: FineText[]) {
  const xs = candidate.geometry.points.map((p) => p[0]),
    ys = candidate.geometry.points.map((p) => p[1]),
    left = Math.min(...xs),
    right = Math.max(...xs),
    top = Math.min(...ys),
    bottom = Math.max(...ys)
  const words = texts.filter((t) =>
    /中岛|收银|开箱|配件柜|边桌|坐凳|玻璃柜|展台|island|cashier|table|cabinet|stool|广告机|灯箱|屏幕/i.test(
      t.text,
    ),
  )
  const nearby = words
    .map((t) => {
      const cx = t.x + t.w / 2,
        cy = t.y + t.h / 2
      return {
        t,
        d: Math.hypot(Math.max(left - cx, 0, cx - right), Math.max(top - cy, 0, cy - bottom)),
      }
    })
    .filter((v) => v.d <= Math.max(18, Math.min(right - left, bottom - top) * 0.28))
    .sort((a, b) => a.d - b.d)
  if (nearby.length) {
    const first = nearby[0]!
    candidate.label = first.t.text
    candidate.kind = /广告机|灯箱|屏幕/.test(first.t.text) ? 'wall-display' : 'furniture'
    candidate.confidence = 0.65
    candidate.evidence += `；邻近OCR：${first.t.text}，仍需确认对象关联`
  }
}

/** Threshold and component extraction run in original pixel coordinates, with a fixed 12MP cap. */
export function extractFineGeometry(
  gray: Uint8Array,
  width: number,
  height: number,
  texts: FineText[] = [],
): FineGeometry {
  const started = performance.now()
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width * height > 12_000_000 ||
    Math.max(width, height) > 4000 ||
    gray.length !== width * height
  )
    throw new Error('图片尺寸无效或超出4000边长/12MP限制')
  let dark = 0
  for (const v of gray) if (v < 100) dark++
  const inverted = dark > gray.length * 0.5,
    ink = new Uint8Array(gray.length)
  for (let i = 0; i < gray.length; i++)
    ink[i] = (inverted ? 255 - gray[i]! : gray[i]!) < 190 ? 1 : 0
  const lines = axisLines(ink, width, height),
    visited = new Uint8Array(gray.length),
    queue = new Int32Array(gray.length),
    candidates: FineCandidate[] = []
  const minSide = Math.max(12, width / 180),
    minArea = minSide * minSide
  // Erode thin ink strokes before finding filled blocks: a column often touches a wall line.
  const integral = new Int32Array((width + 1) * (height + 1)),
    solid = new Uint8Array(ink.length)
  for (let y = 0; y < height; y++) {
    let sum = 0
    for (let x = 0; x < width; x++) {
      sum += ink[y * width + x]!
      integral[(y + 1) * (width + 1) + x + 1] = sum + integral[y * (width + 1) + x + 1]!
    }
  }
  for (let y = 3; y < height - 3; y++)
    for (let x = 3; x < width - 3; x++) {
      const stride = width + 1,
        a = (y - 3) * stride + x - 3,
        b = (y + 4) * stride + x + 4
      solid[y * width + x] =
        integral[b]! -
          integral[(y - 3) * stride + x + 4]! -
          integral[(y + 4) * stride + x - 3]! +
          integral[a]! ===
        49
          ? 1
          : 0
    }
  for (const target of [0, 1]) {
    const mask = target === 0 ? ink : solid

    visited.fill(0)
    for (let start = 0; start < ink.length; start++) {
      if (visited[start] || mask[start] !== target) continue
      let head = 0,
        tail = 1,
        minX = width,
        maxX = 0,
        minY = height,
        maxY = 0
      queue[0] = start
      visited[start] = 1
      let touches = false
      const boundary: FinePoint[] = []
      while (head < tail) {
        const i = queue[head++]!,
          x = i % width,
          y = Math.floor(i / width)
        minX = Math.min(minX, x)
        maxX = Math.max(maxX, x)
        minY = Math.min(minY, y)
        maxY = Math.max(maxY, y)
        if (x === 0 || y === 0 || x === width - 1 || y === height - 1) touches = true
        let edge = false
        for (const n of [
          x > 0 ? i - 1 : -1,
          x + 1 < width ? i + 1 : -1,
          y > 0 ? i - width : -1,
          y + 1 < height ? i + width : -1,
        ]) {
          if (n < 0 || mask[n] !== target) {
            edge = true
            continue
          }
          if (!visited[n]) {
            visited[n] = 1
            queue[tail++] = n
          }
        }
        if (edge && (x + y) % 2 === 0) boundary.push([x, y])
      }
      if (
        touches ||
        tail < minArea ||
        maxX - minX < minSide ||
        maxY - minY < minSide ||
        tail > gray.length * 0.15 ||
        boundary.length < 4
      )
        continue
      const convex = hull(boundary),
        box = rectangle(convex)
      if (
        !box ||
        box.w < minSide ||
        box.h < minSide ||
        Math.max(box.w, box.h) / Math.min(box.w, box.h) > 16 ||
        box.area > gray.length * 0.18
      )
        continue
      const rectangularity = polygonArea(convex) / box.area,
        fillRatio = tail / box.area
      if (rectangularity < 0.94 || fillRatio < (target === 1 ? 0.9 : 0.38)) continue
      const expand = target === 0 ? 1 : 3
      const u: FinePoint = [
        (box.points[1]![0] - box.points[0]![0]) / box.w,
        (box.points[1]![1] - box.points[0]![1]) / box.w,
      ]
      const v: FinePoint = [
        (box.points[3]![0] - box.points[0]![0]) / box.h,
        (box.points[3]![1] - box.points[0]![1]) / box.h,
      ]
      const signs = [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
      ]
      const points: FinePoint[] = box.points.map(([x, y], i) => [
        Math.round(
          Math.max(
            0,
            Math.min(width - 1, x + expand * (signs[i]![0]! * u[0] + signs[i]![1]! * v[0])),
          ) * 100,
        ) / 100,
        Math.round(
          Math.max(
            0,
            Math.min(height - 1, y + expand * (signs[i]![0]! * u[1] + signs[i]![1]! * v[1])),
          ) * 100,
        ) / 100,
      ])
      const f: FineCandidate = {
        id: `R${String(candidates.length + 1).padStart(4, '0')}`,
        kind: target === 1 ? 'column' : 'unknown',
        geometry: { type: 'polygon', points },
        label: target === 1 ? '实心块候选' : '矩形对象候选',
        evidence:
          target === 1
            ? '原图连续实心矩形；类别仅为柱候选'
            : '原图闭合空白区域外框；圆角以外接矩形近似',
        origin: 'automatic',
        confidence: target === 1 ? 0.55 : 0.35,
        fillRatio: Math.round(fillRatio * 1000) / 1000,
        angle: box.angle,
      }
      classify(f, texts)
      candidates.push(f)
      if (candidates.length > 1500) throw new Error('对象候选过多，请先裁图；没有截断候选')
    }
  }
  return {
    schemaVersion: 1,
    engine: 'raster-fine-v1',
    width,
    height,
    inverted,
    candidates,
    lines,
    texts,
    pending: [
      '矩形/实心块只是几何候选，须核对所属对象',
      '范围、开口、曲线墙和不闭合对象仍需描点或确认',
      '比例和层高未经核实；未自动匹配家具模型',
    ],
    completeAutomatically: false,
    seconds: (performance.now() - started) / 1000,
  }
}
