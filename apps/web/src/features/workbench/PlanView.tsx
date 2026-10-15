import { useId, useMemo } from 'react'
import type { PointerEvent as ReactPointerEvent, Ref } from 'react'
import {
  WALL_THICKNESS_M,
  facingAfter,
  itemElevation,
  itemMount,
  mToMm,
  mainEntrance,
  mountedWall,
  polygonArea,
  sceneFrame,
} from '@store/shared'
import type { Asset, Issue, Layout, LayoutItem, Point, ShopType, Space } from '@store/shared'
import {
  LABEL_OFFSET_EM,
  avoidOverlaps,
  dimensionChains,
  openingLines,
  overallDimensions,
  radiusMarks,
  symbolBaseRotation,
  tickHalf,
  wallBands,
} from './plan-drawing.ts'
import type { RadiusMark, TextBox } from './plan-drawing.ts'
import { placeSpacingLabels, spacingItems, spacingMarks } from './plan-spacing.ts'
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
  /**
   * Delivery drawing (manuals' style): numbered yellow badges instead of names, matching the
   * legend (deliveryLegend), and the main customer-flow arrow.
   */
  numbers?: Readonly<Record<string, number>> | undefined
  /** Clear distances around the 软装 props (see plan-spacing.ts); off unless asked for. */
  spacing?: boolean | undefined
  title: string
}

const points = (polygon: readonly Point[]) => polygon.map((p) => p.join(',')).join(' ')

/** Brand yellow (SI1.0 p.11), used for the numbered badges of delivery plans. */
const BADGE_YELLOW = '#ffd200'

/** Numbered badge of a prop; colours are attributes so an exported image keeps them. */
function NumberBadge({ no, x, y, size }: { no: number; x: number; y: number; size: number }) {
  return (
    <g className="plan-badge">
      <rect
        x={x - size / 2}
        y={y - size / 2}
        width={size}
        height={size}
        rx={size * 0.2}
        fill={BADGE_YELLOW}
      />
      <text
        x={x}
        y={y}
        fontSize={size * 0.58}
        fontWeight={700}
        fill="#1f2328"
        textAnchor="middle"
        dominantBaseline="central"
      >
        {String(no).padStart(2, '0')}
      </text>
    </g>
  )
}

/** 主客流方向: from the main entrance into the shop. */
function FlowArrow({
  from,
  inward,
  length,
  fontSize,
}: {
  from: Point
  inward: Point
  length: number
  fontSize: number
}) {
  const start: Point = [from[0] + inward[0] * 0.15, from[1] + inward[1] * 0.15]
  const end: Point = [start[0] + inward[0] * length, start[1] + inward[1] * length]
  const head = fontSize * 0.7
  const side: Point = [-inward[1], inward[0]]
  const tip = (k: number): Point => [
    end[0] - inward[0] * head + side[0] * head * 0.5 * k,
    end[1] - inward[1] * head + side[1] * head * 0.5 * k,
  ]
  // Beside the middle of the shaft, clear of it (five characters at 0.8 × fontSize).
  const away = fontSize * 2.4
  const label: Point = [
    (start[0] + end[0]) / 2 + side[0] * away,
    (start[1] + end[1]) / 2 + side[1] * away,
  ]
  const half = fontSize * 0.07
  const neck: Point = [end[0] - inward[0] * head * 0.9, end[1] - inward[1] * head * 0.9]
  const shaft: Point[] = [
    [start[0] + side[0] * half, start[1] + side[1] * half],
    [neck[0] + side[0] * half, neck[1] + side[1] * half],
    [neck[0] - side[0] * half, neck[1] - side[1] * half],
    [start[0] - side[0] * half, start[1] - side[1] * half],
  ]
  return (
    <g className="plan-flow">
      {/* A filled shaft: plan lines do not scale, which would make a stroked one vanish. */}
      <polygon points={points(shaft)} fill="#36495c" />
      <polygon points={points([end, tip(1), tip(-1)])} fill="#36495c" />
      <text
        x={label[0]}
        y={label[1]}
        fontSize={fontSize * 0.8}
        fill="#36495c"
        textAnchor="middle"
        dominantBaseline="middle"
      >
        主客流方向
      </text>
    </g>
  )
}

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

/** A wall or ceiling piece: a dashed outline over whatever stands below it. */
function mountedBlock(item: LayoutItem) {
  return (
    <rect
      className="plan-mounted"
      x={item.cx - item.w / 2}
      y={item.cz - item.d / 2}
      width={item.w}
      height={item.d}
    />
  )
}

/**
 * Where a wall piece's number or label goes: on its back edge, along the wall, so it stays clear
 * of the cabinet below; a ceiling piece (or one off the wall) keeps its centre.
 */
function mountedAnchor(item: LayoutItem, space: Space): { at: Point; angle: number } {
  const face = itemMount(item) === 'wall' ? mountedWall(item, space) : null
  if (!face) return { at: [item.cx, item.cz], angle: 0 }
  const at: Point = [
    item.cx - (face.inward[0] * item.w) / 2,
    item.cz - (face.inward[1] * item.d) / 2,
  ]
  return { at, angle: face.along === 'x' ? 0 : -90 }
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
 * names with heights, dimension chains along every edge (a radius for arcs) and the area.
 * Units are metres with SVG y = plan z (both point down); line widths do not scale with zoom.
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
  numbers,
  spacing = false,
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
  const { dims, radii } = useMemo(() => {
    if (compact) return { dims: [], radii: [] as RadiusMark[] }
    const marks = radiusMarks(space, dimOffset)
    // Chains whose labels would overlap earlier ones move one dimension step further out.
    const step = fontSize * 2.4
    const chains = avoidOverlaps(dimensionChains(space, dimOffset), marks, fontSize, step)
    return {
      dims: [...chains, ...overallDimensions(space, chains, dimOffset, step, marks)],
      radii: marks,
    }
  }, [compact, space, dimOffset, fontSize])
  const pad = compact ? WALL_THICKNESS_M + 0.15 : dimOffset + fontSize * 2.2
  const bottomPad = compact ? pad : pad + fontSize * 2
  // Room beyond `pad` for chains farther out than a straight edge's (overall sizes, arcs).
  const extra = useMemo(() => {
    if (!dims.length && !radii.length) return { left: 0, top: 0, right: 0, bottom: 0 }
    const ends = [...dims.flatMap((d) => [d.a, d.b]), ...radii.map((m) => m.end)]
    const reach = (beyond: number) => {
      const more = beyond + fontSize * 2.2 - pad
      return more > 1e-6 ? more : 0
    }
    return {
      left: reach(Math.max(0, ...ends.map((p) => bounds.minX - p[0]))),
      top: reach(Math.max(0, ...ends.map((p) => bounds.minZ - p[1]))),
      right: reach(Math.max(0, ...ends.map((p) => p[0] - bounds.maxX))),
      bottom: reach(Math.max(0, ...ends.map((p) => p[1] - bounds.maxZ))),
    }
  }, [dims, radii, bounds, fontSize, pad])
  const viewBox = `${bounds.minX - pad - extra.left} ${bounds.minZ - pad - extra.top} ${width + pad * 2 + extra.left + extra.right} ${depth + pad + bottomPad + extra.top + extra.bottom}`

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
  // Halfway along the main entrance on the boundary (for an arc storefront on the arc, not on
  // its chord). The label sits there once, just outside, between the wall and the dimensions.
  const { front, entrance: entranceMid } = sceneFrame(space)
  const entranceLabel: Point | null = entrance
    ? [
        entranceMid[0] + front[0] * (WALL_THICKNESS_M + fontSize * 0.9),
        entranceMid[1] + front[1] * (WALL_THICKNESS_M + fontSize * 0.9),
      ]
    : null
  const area = polygonArea(space.boundary)
  const spacings = useMemo(() => {
    if (!spacing || compact || !layout) return []
    // Prop names (or numbers) stay readable: a spacing number never covers them.
    const blocked: TextBox[] = layout.items
      .filter((item) => itemMount(item) === 'floor')
      .map((item) => ({
        center: [item.cx, item.cz + (numbers ? 0 : fontSize * 0.3)],
        axis: [1, 0],
        halfW: numbers ? fontSize * 0.65 : Math.max(item.name.length, 7) * fontSize * 0.25,
        halfH: numbers ? fontSize * 0.65 : fontSize * 0.9,
      }))
    const marks = spacingMarks(space, spacingItems(layout.items, assets))
    return placeSpacingLabels(marks, fontSize * 0.8, blocked)
  }, [spacing, compact, layout, assets, space, numbers, fontSize])

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
      {/* Openings follow the boundary: one across several edges is drawn piece by piece. */}
      {space.openEdges.flatMap((e, i) =>
        openingLines(space, e).map(([a, b], k) => (
          <line
            key={`open${i}-${k}`}
            className="plan-open-edge"
            x1={a[0]}
            y1={a[1]}
            x2={b[0]}
            y2={b[1]}
          />
        )),
      )}
      {space.entrances.flatMap((e, i) =>
        openingLines(space, e).map(([a, b], k) => (
          <line
            key={`e${i}-${k}`}
            className="plan-entrance"
            x1={a[0]}
            y1={a[1]}
            x2={b[0]}
            y2={b[1]}
          >
            <title>{e.kind === 'main' ? '主入口' : '入口'}</title>
          </line>
        )),
      )}

      {/* Floor props first, so the wall and ceiling pieces above them stay on top. */}
      {[...(layout?.items ?? [])]
        .sort((a, b) => Number(itemMount(a) !== 'floor') - Number(itemMount(b) !== 'floor'))
        .map((item) => {
          const asset = assetOf(item)
          const mounted = itemMount(item) !== 'floor'
          const symbol = asset?.planSymbol ? symbols.get(asset.planSymbol.url) : undefined
          const drawing = mounted ? mountedBlock(item) : symbolFor(item, asset, symbol)
          const anchor = mounted ? mountedAnchor(item, space) : null
          const classes = [
            'plan-item',
            mounted ? 'mounted' : '',
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
              {!compact && numbers?.[item.id] !== undefined && (
                <NumberBadge
                  no={numbers[item.id] ?? 0}
                  x={anchor ? anchor.at[0] : item.cx}
                  y={anchor ? anchor.at[1] : item.cz}
                  size={fontSize * 1.3}
                />
              )}
              {!compact && !numbers && anchor && (
                <text
                  className="plan-label"
                  x={anchor.at[0]}
                  y={anchor.at[1]}
                  fontSize={fontSize * 0.7}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  transform={
                    anchor.angle
                      ? `rotate(${anchor.angle} ${anchor.at[0]} ${anchor.at[1]})`
                      : undefined
                  }
                >
                  {name} 离地{mToMm(itemElevation(item))}
                </text>
              )}
              {!compact && !numbers && !anchor && (
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

      {spacings.map((m, i) => {
        const half = tickHalf(m.a, m.b, fontSize * 0.25)
        return (
          <g key={`s${i}`} className="plan-spacing">
            <line x1={m.a[0]} y1={m.a[1]} x2={m.b[0]} y2={m.b[1]} />
            {[m.a, m.b].map((p, k) => (
              <line
                key={k}
                x1={p[0] - half[0]}
                y1={p[1] - half[1]}
                x2={p[0] + half[0]}
                y2={p[1] + half[1]}
              />
            ))}
            <text
              x={m.text.center[0]}
              y={m.text.center[1]}
              fontSize={fontSize * 0.8}
              textAnchor="middle"
              dominantBaseline="middle"
              transform={
                m.angle ? `rotate(${m.angle} ${m.text.center[0]} ${m.text.center[1]})` : undefined
              }
            >
              {m.label}
            </text>
          </g>
        )
      })}

      {!compact && numbers && entrance && (
        <FlowArrow
          from={entranceMid}
          inward={[-front[0], -front[1]]}
          length={Math.min(1.4, Math.max(0.6, depth * 0.18))}
          fontSize={fontSize}
        />
      )}
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
        // 45° to the dimension line, so it stays visible on slanted edges.
        const half = tickHalf(d.a, d.b, tick)
        const mid: Point = [(d.a[0] + d.b[0]) / 2, (d.a[1] + d.b[1]) / 2]
        const text: Point = [
          mid[0] + d.outward[0] * fontSize * 0.7,
          mid[1] + d.outward[1] * fontSize * 0.7,
        ]
        // From just outside the wall, or from where the dimension says (a stub, or nothing).
        const ext = (from: Point, to: Point, start: Point | undefined) => (
          <line
            x1={start ? start[0] : from[0] + d.outward[0] * (WALL_THICKNESS_M + 0.04)}
            y1={start ? start[1] : from[1] + d.outward[1] * (WALL_THICKNESS_M + 0.04)}
            x2={to[0] + d.outward[0] * tick}
            y2={to[1] + d.outward[1] * tick}
          />
        )
        return (
          <g key={`d${i}`} className="plan-dim">
            <line x1={d.a[0]} y1={d.a[1]} x2={d.b[0]} y2={d.b[1]} />
            {ext(d.from, d.a, d.extA)}
            {ext(d.to, d.b, d.extB)}
            {[d.a, d.b].map((p, k) => (
              <line
                key={k}
                className="plan-dim-tick"
                x1={p[0] - half[0]}
                y1={p[1] - half[1]}
                x2={p[0] + half[0]}
                y2={p[1] + half[1]}
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

      {radii.map((m, i) => {
        // A radial leader from outside up to the arc, its arrow touching the arc, "R…" beyond.
        const head = fontSize * 0.45
        const side: Point = [-m.outward[1] * head * 0.3, m.outward[0] * head * 0.3]
        const neck: Point = [m.at[0] + m.outward[0] * head, m.at[1] + m.outward[1] * head]
        const text: Point = [
          m.end[0] + m.outward[0] * fontSize * LABEL_OFFSET_EM,
          m.end[1] + m.outward[1] * fontSize * LABEL_OFFSET_EM,
        ]
        return (
          <g key={`r${i}`} className="plan-dim plan-radius">
            <line x1={m.at[0]} y1={m.at[1]} x2={m.end[0]} y2={m.end[1]} />
            <polygon
              points={points([
                m.at,
                [neck[0] + side[0], neck[1] + side[1]],
                [neck[0] - side[0], neck[1] - side[1]],
              ])}
              fill="#6b7280"
            />
            <text
              x={text[0]}
              y={text[1]}
              fontSize={fontSize}
              textAnchor="middle"
              dominantBaseline="middle"
              transform={`rotate(${m.angle} ${text[0]} ${text[1]})`}
            >
              {m.label}
            </text>
          </g>
        )
      })}

      {!compact && (
        <text
          className="plan-info"
          x={bounds.minX - pad - extra.left + fontSize}
          y={bounds.maxZ + bottomPad + extra.bottom - fontSize * 0.8}
          fontSize={fontSize}
        >
          面积 {area.toFixed(1)} m² · 层高 {mToMm(space.height)} mm
        </text>
      )}
    </svg>
  )
}
