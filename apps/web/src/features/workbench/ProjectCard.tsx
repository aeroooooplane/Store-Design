import { MARKET_LABELS, SHOP_TYPE_LABELS, SI_STYLES, mToMm, polygonArea } from '@store/shared'
import type { Project, SiStyle, Space } from '@store/shared'
import { ErrorMessage } from '../../components/ErrorMessage.tsx'
import { formatDateTime } from '../../lib/format.ts'

interface ProjectCardProps {
  project: Project
  space: Space | null
  /** The SI style of the step on screen (each step has its own; the project's on a space). */
  siStyle: SiStyle
  /** Why the style cannot be switched here (a render keeps the style it was made in). */
  siLocked?: string | null
  /** A switch is under way. */
  siBusy?: boolean
  onSiSwitch?: (style: SiStyle) => void
  /** What the last switch did. */
  notice?: string | null
  error?: unknown
}

/** Area, outer size and ceiling height of the space. */
function spaceFacts(space: Space) {
  const xs = space.boundary.map((p) => p[0])
  const zs = space.boundary.map((p) => p[1])
  return {
    area: `${polygonArea(space.boundary).toFixed(1)} m²`,
    size: `${mToMm(Math.max(...xs) - Math.min(...xs))} × ${mToMm(Math.max(...zs) - Math.min(...zs))} mm`,
    height: `${mToMm(space.height)} mm`,
  }
}

/** One bar above the workbench: project name, the current space's size and the SI style switch. */
export function ProjectCard({
  project,
  space,
  siStyle,
  siLocked,
  siBusy,
  onSiSwitch,
  notice,
  error,
}: ProjectCardProps) {
  const facts = space ? spaceFacts(space) : null
  return (
    <section className="project-bar" aria-label="项目信息">
      <h2>{project.name}</h2>
      <span className="tag">
        {SHOP_TYPE_LABELS[project.shopType]} · {MARKET_LABELS[project.market]}
      </span>
      {facts && (
        <span className="hint project-bar-size">
          面积 {facts.area} · {facts.size} · 层高 {facts.height}
        </span>
      )}
      <div className="tabs" role="group" aria-label="SI 风格">
        {SI_STYLES.map((style) => (
          <button
            key={style}
            type="button"
            aria-pressed={siStyle === style}
            disabled={siBusy || !!siLocked}
            title={
              siLocked ??
              '当前节点的 SI 风格。在方案或三维效果节点上切换时，另存一个换成该风格道具的兄弟节点，原节点保留；换款后没改过再切回，直接回到原节点'
            }
            onClick={() => {
              if (siStyle !== style) onSiSwitch?.(style)
            }}
          >
            {style}
          </button>
        ))}
      </div>
      {notice ? (
        <p className="hint project-bar-notice" role="status">
          {notice}
        </p>
      ) : null}
      {siLocked ? <p className="hint project-bar-notice">{siLocked}</p> : null}
      <ErrorMessage error={error} />
    </section>
  )
}

/** The "空间信息" tab of the left column. */
export function ProjectDetails({
  project,
  space,
  siStyle,
}: {
  project: Project
  space: Space | null
  siStyle: SiStyle
}) {
  const facts = space ? spaceFacts(space) : null
  const rows: [string, string][] = [
    ['项目', project.name],
    ['铺位形态', SHOP_TYPE_LABELS[project.shopType]],
    ['市场', MARKET_LABELS[project.market]],
    ['当前节点 SI', siStyle],
    ['创建时间', formatDateTime(project.createdAt)],
    ...(facts
      ? ([
          ['面积', facts.area],
          ['外框尺寸', facts.size],
          ['层高', facts.height],
        ] satisfies [string, string][])
      : []),
  ]
  return (
    <dl className="project-details">
      {rows.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  )
}
