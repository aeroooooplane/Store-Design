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

/** Project name, the current space's size and the SI style switch (top of the left column). */
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
  const xs = space?.boundary.map((p) => p[0]) ?? []
  const zs = space?.boundary.map((p) => p[1]) ?? []
  return (
    <section className="wb-card project-card" aria-label="项目信息">
      <h2>{project.name}</h2>
      <p className="hint">
        {SHOP_TYPE_LABELS[project.shopType]} · {MARKET_LABELS[project.market]} · 创建于{' '}
        {formatDateTime(project.createdAt)}
      </p>
      {space && (
        <p className="hint">
          面积 {polygonArea(space.boundary).toFixed(1)} m² ·{' '}
          {mToMm(Math.max(...xs) - Math.min(...xs))} × {mToMm(Math.max(...zs) - Math.min(...zs))} mm
          · 层高 {mToMm(space.height)} mm
        </p>
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
        <p className="hint" role="status">
          {notice}
        </p>
      ) : null}
      {siLocked ? <p className="hint">{siLocked}</p> : null}
      <ErrorMessage error={error} />
    </section>
  )
}
