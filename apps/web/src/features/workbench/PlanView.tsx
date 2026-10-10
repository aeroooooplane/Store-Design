import { useId, useMemo } from 'react'
import type { PointerEvent as ReactPointerEvent, Ref } from 'react'
import {
  WALL_THICKNESS_M,
  facingAfter,
  mToMm,
  mainEntrance,
  polygonArea,
  sceneFrame,
} from '@store/shared'
import type { Asset, Issue, Layout, LayoutItem, Point, ShopType, Space } from '@store/shared'
import { dimensionChains, symbolBaseRotation, wallBands } from './plan-drawing.ts'
import { renderShapes, usePlanSymbols } from './plan-symbols.ts'
import type { PlanSymbol } from './plan-symbols.ts'

export interface PlanViewProps {
  space: Space
  /** Island shops have no walls; the others are drawn with hatched walls. */
  shopType?: ShopType | undefined
  layout?: Layout | null | undefined
  issues?: Issue[] | undefined
  /** Catalogue entries: plan symbols, names and front directions. */
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

const points = (polygon: readonly Point[]) => polygon.map((p) => p.join(',')).join(' ')

/** Short edge marker on the side the model faces (blocks only; symbols show it themselves). */
function frontMarker(item: LayoutItem, asset: Asset | undefined) {
  if (!asset?.front || asset.front === 'any') return null
  const [fx, fz] = facingAfter(asset.front, item.rotation)
  const hx = item.w / 2
  const hz = item.d / 2
  return (
    <line
      className="plan-front"
      x1={item.cx + fx * hx - Math.abs(fz) * hx * 0.6}
      y1={item.cz + fz * hz - Math.abs(fx) * hz * 0.6}
      x2={item.cx + fx * hx + Math.abs(fz) * hx * 0.6}
      y2={item.cz + fz * hz + Math.abs(fx) * hz * 0.6}
    />
  )
}

/** A prop without a plan symbol: an outlined block; placeholders are dashed and crossed. */
function block(item: LayoutItem) {
  const x = item.cx - item.w / 2
  const y = item.cz - item.d / 2
  const inset = Math.min(0.03, item.w / 6, item.d / 6)
  return (
    <g className={item.placeholder ? 'plan-block placeholder' : 'plan-block'}>
      <rect x={x} y={y} width={item.w} height={item.d} />
      {item.placeholder ? (
        <path d={`M${x} ${y}L${x + item.w} ${y + item.d}M${x + item.w} ${y}L${x} ${y + item.d}`} />
      ) : (
        <rect x={x + inset} y={y + inset} width={item.w - inset * 2} height={item.d - inset * 2} />
      )}
    </g>
  )
}

function symbolFor(item: LayoutItem, asset: Asset | undefined, symbol: PlanSymbol | undefined) {
  if (!asset || !symbol || item.placeholder) return null
  const rotation = item.rotation + symbolBaseRotation(asset.front, asset.footprint, symbol.size)
  return (
    <g
      className="plan-symbol"
      transform={`translate(${item.cx} ${item.cz}) rotate(${rotation}) scale(0.001) translate(${-symbol.center[0]} ${-symbol.center[1]})`}
    >
      {renderShapes(symbol.shapes)}
    </g>
  )
}

/**
 * The plan as a store drawing: hatched walls outside the boundary (none for island shops), a
 * red lease line, columns, the entrance, every prop as its true-size plan symbol (or a block),
 * names with heights, dimension chains along every edge and the area. Units are metres with
 * SVG y = plan z (both point down); line widths do not scale with zoom.
 */
export function PlanView({
  space,
  shopType = 'side_hall',
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
  const hatch = `hatch-${useId().replace(/:/g, '')}`
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
  const walls = useMemo(() => wallBands(space, shopType), [space, shopType])
  const width = bounds.maxX - bounds.minX
  const depth = bounds.maxZ - bounds.minZ
  const span = Math.max(width, depth, 1)
  const fontSize = Math.min(0.24, Math.max(0.11, span / 60))
  const dimOffset = WALL_THICKNESS_M + fontSize * 2.4
  const dims = useMemo(
    () => (compact ? [] : dimensionChains(space, dimOffset)),
    [compact, space, dimOffset],
  )
  const pad = compact ? WALL_THICKNESS_M + 0.15 : dimOffset + fontSize * 2.2
  const bottomPad = compact ? pad : pad + fontSize * 2
  const viewBox = `${bounds.minX - pad} ${bounds.minZ - pad} ${width + pad * 2} ${depth + pad + bottomPad}`

  const flagged = new Set(
    issues.filter((i) => i.severity === 'error').flatMap((i) => i.itemIds ?? []),
  )
  const assetOf = (item: LayoutItem) => (item.assetId ? assets?.get(item.assetId) : undefined)
  const symbolUrls = (layout?.items ?? []).flatMap((item) => {
    const url = assetOf(item)?.planSymbol?.url
    return url && !item.placeholder ? [url] : []
  })
  const symbols = usePlanSymbols(symbolUrls)
  const entrance = mainEntrance(space)
  // The label sits just outside the opening, between the wall and the dimension chain.
  const front = sceneFrame(space).front
  const entranceLabel: Point | null = entrance
    ? [
        (entrance.a[0] + entrance.b[0]) / 2 + front[0] * (WALL_THICKNESS_M + fontSize * 0.9),
        (entrance.a[1] + entrance.b[1]) / 2 + front[1] * (WALL_THICKNESS_M + fontSize * 0.9),
      ]
    : null
  const area = polygonArea(space.boundary)

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
      <defs>
        <pattern
          id={hatch}
          patternUnits="userSpaceOnUse"
          width={0.08}
          height={0.08}
          patternTransform="rotate(45)"
        >
          <path d="M0 0V0.08M0 0H0.08" className="plan-hatch-line" />
        </pattern>
      </defs>

      <polygon
        className="plan-floor"
        points={points(space.boundary)}
        onPointerDown={() => onBackgroundPointerDown?.()}
      />
      {walls.map((wall, i) => (
        <polygon
          key={`wf${i}`}
          className="plan-wall"
          fill={`url(#${hatch})`}
          points={points(wall.polygon)}
        />
      ))}
      {walls.flatMap((wall, i) =>
        wall.outline.map(([a, b], k) => (
          <line
            key={`wl${i}-${k}`}
            className="plan-wall-line"
            x1={a[0]}
            y1={a[1]}
            x2={b[0]}
            y2={b[1]}
          />
        )),
      )}
      <polygon className="plan-lease" points={points(space.boundary)}>
        <title>租赁线</title>
      </polygon>
      {space.obstacles.map((o, i) => (
        <polygon
          key={`o${i}`}
          className="plan-obstacle"
          fill={`url(#${hatch})`}
          points={points(o.polygon)}
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
        const asset = assetOf(item)
        const symbol = asset?.planSymbol ? symbols.get(asset.planSymbol.url) : undefined
        const drawing = symbolFor(item, asset, symbol)
        const classes = [
          'plan-item',
          flagged.has(item.id) ? 'has-issue' : '',
          item.id === selectedId ? 'selected' : '',
        ]
        // The catalogue name (模型选用表) wins over the name saved with older layouts.
        const name = (asset?.name ?? item.name).split(' · ')[0] ?? item.name
        return (
          <g
            key={item.id}
            className={classes.filter(Boolean).join(' ')}
            data-item-id={item.id}
            onPointerDown={
              onItemPointerDown ? (event) => onItemPointerDown(item, event) : undefined
            }
          >
            <title>{`${item.name}（${mToMm(item.w)} × ${mToMm(item.d)} × ${mToMm(item.h)} mm）`}</title>
            {drawing ?? block(item)}
            {!drawing && frontMarker(item, asset)}
            <rect
              className="plan-item-frame"
              x={item.cx - item.w / 2}
              y={item.cz - item.d / 2}
              width={item.w}
              height={item.d}
            />
            {!compact && (
              <text
                className="plan-label"
                x={item.cx}
                y={item.cz}
                fontSize={fontSize * 0.8}
                textAnchor="middle"
              >
                <tspan x={item.cx} dy={-fontSize * 0.15}>
                  {name}
                </tspan>
                <tspan x={item.cx} dy={fontSize * 0.95}>
                  H:{mToMm(item.h)}mm
                </tspan>
              </text>
            )}
          </g>
        )
      })}

      {!compact && entranceLabel && (
        <text
          className="plan-entrance-label"
          x={entranceLabel[0]}
          y={entranceLabel[1]}
          fontSize={fontSize}
          textAnchor="middle"
          dominantBaseline="middle"
        >
          主入口
        </text>
      )}

      {dims.map((d, i) => {
        const tick = fontSize * 0.35
        const mid: Point = [(d.a[0] + d.b[0]) / 2, (d.a[1] + d.b[1]) / 2]
        const text: Point = [
          mid[0] + d.outward[0] * fontSize * 0.7,
          mid[1] + d.outward[1] * fontSize * 0.7,
        ]
        const ext = (from: Point, to: Point) => (
          <line
            x1={from[0] + d.outward[0] * (WALL_THICKNESS_M + 0.04)}
            y1={from[1] + d.outward[1] * (WALL_THICKNESS_M + 0.04)}
            x2={to[0] + d.outward[0] * tick}
            y2={to[1] + d.outward[1] * tick}
          />
        )
        return (
          <g key={`d${i}`} className="plan-dim">
            <line x1={d.a[0]} y1={d.a[1]} x2={d.b[0]} y2={d.b[1]} />
            {ext(d.from, d.a)}
            {ext(d.to, d.b)}
            {[d.a, d.b].map((p, k) => (
              <line
                key={k}
                className="plan-dim-tick"
                x1={p[0] - tick / 2}
                y1={p[1] + tick / 2}
                x2={p[0] + tick / 2}
                y2={p[1] - tick / 2}
              />
            ))}
            <text
              x={text[0]}
              y={text[1]}
              fontSize={fontSize}
              textAnchor="middle"
              dominantBaseline="middle"
              transform={`rotate(${d.angle} ${text[0]} ${text[1]})`}
            >
              {d.label}
            </text>
          </g>
        )
      })}

      {!compact && (
        <text
          className="plan-info"
          x={bounds.minX - pad + fontSize}
          y={bounds.maxZ + bottomPad - fontSize * 0.8}
          fontSize={fontSize}
        >
          面积 {area.toFixed(1)} m² · 层高 {mToMm(space.height)} mm
        </text>
      )}
    </svg>
  )
}
