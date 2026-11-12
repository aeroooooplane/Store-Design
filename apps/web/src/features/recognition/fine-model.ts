export type Px = [number, number]
export interface FineObject {
  id: string
  candidateId: string | null
  kind: 'unknown' | 'furniture' | 'column' | 'wall-display' | 'service' | 'sign'
  label: string
  points: Px[]
  status: 'pending' | 'keep' | 'reject'
  heightMm: number | null
}
export interface FineDraft {
  objects: FineObject[]
  boundary: Px[]
  calibration: { a: Px; b: Px; mm: number } | null
  heightMm: number | null
  openEdges: number[]
  entrances: { a: Px; b: Px; kind: 'main' | 'side' }[]
  structureReviewed: boolean
  reviewer: string
  notes: string
}
export interface FineRecord {
  revision: number
  uploadId: string
  sourceSha256: string
  raw: {
    width: number
    height: number
    candidates: { id: string; kind: string; label: string; geometry: { points: Px[] } }[]
  }
  draft: FineDraft
  elapsedSeconds: number
  confirmedNodeId: string | null
  createdAt: string
  savedAt: string
  cloudRequests: number
}
export function resizeFine(points: Px[], axis: 'w' | 'd', pixels: number): Px[] {
  if (points.length !== 4 || !Number.isFinite(pixels) || pixels <= 0)
    throw Error('请输入有效矩形尺寸')
  const a = points[0]!,
    b = points[axis === 'w' ? 1 : 3]!,
    dx = b[0] - a[0],
    dy = b[1] - a[1],
    len = Math.hypot(dx, dy)
  if (!len) throw Error('外框退化，需重新描点')
  const ux = dx / len,
    uy = dy / len,
    cx = points.reduce((s, p) => s + p[0], 0) / 4,
    cy = points.reduce((s, p) => s + p[1], 0) / 4
  return points.map((p) => {
    const t = ((p[0] - cx) * ux + (p[1] - cy) * uy) * (pixels / len - 1)
    return [p[0] + t * ux, p[1] + t * uy]
  })
}
