import { useMemo } from 'react'
import type { PointerEvent as ReactPointerEvent, Ref } from 'react'
import { facingAfter, mToMm } from '@store/shared'
import type { Asset, Issue, ItemFunction, Layout, LayoutItem, Space } from '@store/shared'

/** Fills per function, in the greys of the design tokens; issues override with the danger colour. */
const FILLS: Partial<Record<ItemFunction, string>> = {
  island_table: '#d9d9d9',
  unboxing_table: '#d9d9d9',
  cashier: '#888888',
  accessory_cabinet: '#bdbdbd',
  side_cabinet: '#bdbdbd',
  storage: '#bdbdbd',
}

export interface PlanViewProps {
  space: Space
  layout?: Layout | null | undefined
  issues?: Issue[] | undefined
  /** Catalogue entries, used to mark each model's front edge. */
  assets?: ReadonlyMap<string, Asset> | undefined
  selectedId?: string | null | undefined
  onItemPointerDown?:
    ((item: LayoutItem, event: ReactPointerEvent<SVGGElement>) => void) | undefined
  onBackgroundPointerDown?: (() => void) | undefined
  svgRef?: Ref<SVGSVGElement> | undefined
  /** Compact thumbnails hide labels and dimensions. */
  compact?: boolean | undefined
  title: string
}

/** Short edge marker on the side the model faces. */
function frontMarker(item: LayoutItem, asset: Asset | undefined) {
  if (!asset?.front || asset.front === 'any') return null
  const [fx, fz] = facingAfter(asset.front, item.rotation)
  const hx = item.w / 2
  const hz = item.d / 2
  const x1 = item.cx + fx * hx - Math.abs(fz) * hx * 0.6
  const x2 = item.cx + fx * hx + Math.abs(fz) * hx * 0.6
  const z1 = item.cz + fz * hz - Math.abs(fx) * hz * 0.6
  const z2 = item.cz + fz * hz + Math.abs(fx) * hz * 0.6
  return <line className="plan-front" x1={x1} y1={z1} x2={x2} y2={z2} />
}

/**
 * Plan in metres with SVG y = plan z (both point down), so no flipping is needed. Stroke widths
 * do not scale with zoom.
 */
export function PlanView({
  space,
  layout,
  issues = [],
  assets,
  selectedId,
  onItemPointerDown,
  onBackgroundPointerDown,
  svgRef,
  compact = false,
  title,
}: PlanViewProps) {
  const bounds = useMemo(() => {
    const xs = space.boundary.map((p) => p[0])
    const zs = space.boundary.map((p) => p[1])
    return {
      minX: Math.min(...xs),
      minZ: Math.min(...zs),
      maxX: Math.max(...xs),
      maxZ: Math.max(...zs),
    }
  }, [space])
  const pad = compact ? 0.3 : 0.9
  const width = bounds.maxX - bounds.minX
  const depth = bounds.maxZ - bounds.minZ
  const viewBox = `${bounds.minX - pad} ${bounds.minZ - pad} ${width + pad * 2} ${depth + pad * 2}`
  const flagged = new Set(
    issues.filter((i) => i.severity === 'error').flatMap((i) => i.itemIds ?? []),
  )
  const fontSize = Math.max(0.12, Math.min(width, depth) / 40)

  return (
    <svg
      ref={svgRef}
      className={compact ? 'plan plan-compact' : 'plan'}
      viewBox={viewBox}
      role="img"
      aria-label={title}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onBackgroundPointerDown?.()
      }}
    >
      <title>{title}</title>
      <polygon
        className="plan-boundary"
        points={space.boundary.map((p) => p.join(',')).join(' ')}
      />
      {space.obstacles.map((o, i) => (
        <polygon
          key={`o${i}`}
          className="plan-obstacle"
          points={o.polygon.map((p) => p.join(',')).join(' ')}
        >
          <title>{o.label ?? '障碍物'}</title>
        </polygon>
      ))}
      {space.openEdges.map((e, i) => (
        <line
          key={`open${i}`}
          className="plan-open-edge"
          x1={e.a[0]}
          y1={e.a[1]}
          x2={e.b[0]}
          y2={e.b[1]}
        />
      ))}
      {space.entrances.map((e, i) => (
        <line
          key={`e${i}`}
          className="plan-entrance"
          x1={e.a[0]}
          y1={e.a[1]}
          x2={e.b[0]}
          y2={e.b[1]}
        >
          <title>{e.kind === 'main' ? '主入口' : '入口'}</title>
        </line>
      ))}
      {layout?.items.map((item) => {
        const selected = item.id === selectedId
        const classes = [
          'plan-item',
          flagged.has(item.id) ? 'has-issue' : '',
          selected ? 'selected' : '',
          item.placeholder ? 'placeholder' : '',
        ]
        return (
          <g
            key={item.id}
            className={classes.filter(Boolean).join(' ')}
            data-item-id={item.id}
            onPointerDown={
              onItemPointerDown ? (event) => onItemPointerDown(item, event) : undefined
            }
          >
            <title>{`${item.name}（${mToMm(item.w)} × ${mToMm(item.d)} mm）`}</title>
            <rect
              x={item.cx - item.w / 2}
              y={item.cz - item.d / 2}
              width={item.w}
              height={item.d}
              fill={FILLS[item.function] ?? '#e8e8e8'}
            />
            {frontMarker(item, item.assetId ? assets?.get(item.assetId) : undefined)}
            {!compact && (
              <text
                x={item.cx}
                y={item.cz}
                fontSize={fontSize}
                textAnchor="middle"
                dominantBaseline="middle"
              >
                {item.id.split('-').pop()}
              </text>
            )}
          </g>
        )
      })}
      {!compact && (
        <g className="plan-dimensions" fontSize={fontSize * 1.1}>
          <text x={bounds.minX + width / 2} y={bounds.minZ - pad / 2} textAnchor="middle">
            {mToMm(width)} mm
          </text>
          <text
            x={bounds.minX - pad / 2}
            y={bounds.minZ + depth / 2}
            textAnchor="middle"
            transform={`rotate(-90 ${bounds.minX - pad / 2} ${bounds.minZ + depth / 2})`}
          >
            {mToMm(depth)} mm
          </text>
        </g>
      )}
    </svg>
  )
}
