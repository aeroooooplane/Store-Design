import { facadePlanSpans, facadePoint, facadeWordmark, openingPieces } from '@store/shared'
import type { FacadeConfig, FacadeSection, Market, SiStyle, Space } from '@store/shared'
import { facadeColors, sectionPieces } from './appearance.ts'

export function FacadeFormsPlan({
  space,
  config,
  sections,
}: {
  space: Space
  config?: FacadeConfig | undefined
  sections: FacadeSection[]
}) {
  const xs = space.boundary.map(([x]) => x)
  const zs = space.boundary.map(([, z]) => z)
  const width = Math.max(...xs) - Math.min(...xs)
  const depth = Math.max(...zs) - Math.min(...zs)
  const pad = Math.max(width, depth) * 0.12
  const island = config && 'kind' in config && config.kind === 'island_hanging'
  const lines = config
    ? facadePlanSpans({ ...space, facade: config }, island ? 'island' : 'side_hall')
    : []
  return (
    <svg
      className="facade-position"
      role="img"
      aria-label="门头平面定位"
      viewBox={[
        Math.min(...xs) - pad,
        Math.min(...zs) - pad,
        width + 2 * pad,
        depth + 2 * pad,
      ].join(' ')}
    >
      <polygon
        className="facade-position-boundary"
        points={space.boundary.map((p) => p.join(',')).join(' ')}
      />
      {[...space.entrances, ...space.openEdges].flatMap((opening, i) =>
        (openingPieces(space, opening) ?? []).map(({ a, b, edge }) => (
          <line
            key={i + '-' + edge}
            className="facade-position-entrance"
            x1={a[0]}
            y1={a[1]}
            x2={b[0]}
            y2={b[1]}
          />
        )),
      )}
      {lines.map(({ a, b }, index) => (
        <line key={index} className="facade-plan-span" x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} />
      ))}
      {sections
        .filter((section) => section.label === '面 A' || section.label === '面 B' || island)
        .map(({ frame, label }) => {
          const [x, z] = facadePoint(frame, frame.width / 2)
          const endX = x + pad * 0.6 * frame.outward[0]
          const endZ = z + pad * 0.6 * frame.outward[1]
          return (
            <g key={label} className="facade-plan-label">
              {island && <path d={'M' + x + ',' + z + 'L' + endX + ',' + endZ} />}
              <text
                x={x + pad * 0.8 * frame.outward[0]}
                y={z + pad * 0.8 * frame.outward[1]}
                fontSize={pad * 0.25}
              >
                {island ? '字标朝向' : label}
              </text>
            </g>
          )
        })}
    </svg>
  )
}

export function FacadeFormsElevation({
  sections,
  si,
  market,
}: {
  sections: FacadeSection[]
  si: SiStyle
  market: Market
}) {
  const first = sections[0]
  if (!first) return null
  const offset = (section: FacadeSection) =>
    (section.frame.origin[0] - first.frame.origin[0]) * first.frame.direction[0] +
    (section.frame.origin[1] - first.frame.origin[1]) * first.frame.direction[1]
  const width = Math.max(...sections.map((section) => offset(section) + section.frame.width))
  const top = Math.max(...sections.map((section) => section.fasciaBottom + section.fasciaHeight))
  const pad = Math.max(width, top) * 0.09
  const art = facadeWordmark(market)
  const colors = facadeColors(si)
  return (
    <svg
      className="facade-elevation facade-forms-elevation"
      role="img"
      aria-label="门头正立面"
      viewBox={[-pad, -pad, width + 2 * pad, top + 2 * pad].join(' ')}
    >
      <path
        className="facade-elevation-floor"
        d={'M' + -pad / 2 + ',' + top + 'H' + (width + pad / 2)}
      />
      {sections.map((section, index) => (
        <g key={index} transform={'translate(' + offset(section) + ' 0)'}>
          {section.openings.map(({ start, end, height }) => (
            <rect
              className="facade-elevation-opening"
              key={start}
              x={start}
              y={top - height}
              width={end - start}
              height={height}
            />
          ))}
          {sectionPieces(section).map((piece, i) => (
            <rect
              key={i}
              x={piece.x}
              y={top - piece.y - piece.h}
              width={piece.w}
              height={piece.h}
              fill={colors[piece.finish]}
            />
          ))}
          {section.logos.map((logo) => {
            const scale = logo.height / art.height
            const letterWidth = art.width * scale
            if (!scale) return null
            return (
              <g key={logo.center}>
                {section.beamOnly &&
                  [0.26, 0.74].map((x) => (
                    <line
                      key={x}
                      x1={logo.center + letterWidth * (x - 0.5)}
                      x2={logo.center + letterWidth * (x - 0.5)}
                      y1={top - section.fasciaBottom}
                      y2={top - logo.top}
                      stroke={colors.panel}
                      strokeWidth={0.015}
                    />
                  ))}
                <g
                  className={section.beamOnly ? 'facade-hanging-wordmark' : undefined}
                  transform={
                    'translate(' +
                    (logo.center - letterWidth / 2) +
                    ' ' +
                    (top - logo.top) +
                    ') scale(' +
                    scale +
                    ' ' +
                    scale * Math.cos(logo.tilt ?? 0) +
                    ')'
                  }
                  fill="#fffdfa"
                >
                  {art.paths.map((shape, i) => (
                    <path key={i} d={shape.d} fillRule={shape.evenOdd ? 'evenodd' : 'nonzero'} />
                  ))}
                </g>
              </g>
            )
          })}
        </g>
      ))}
    </svg>
  )
}
