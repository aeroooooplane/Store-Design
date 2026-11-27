import {
  MARKET_LABELS,
  SHOP_TYPE_LABELS,
  SI_STYLES,
  STORE_TYPE_LABELS,
  mToMm,
  polygonArea,
} from '@store/shared'
import type { Project, SiStyle, Space } from '@store/shared'
import { Info } from 'lucide-react'
import { useState } from 'react'
import type { ReactNode } from 'react'
import { ErrorMessage } from '../../components/ErrorMessage.tsx'
import { formatDateTime } from '../../lib/format.ts'
import { StoreTypeTag } from '../projects/StoreTypeTag.tsx'

interface ProjectCardProps {
  project: Project
  space: Space | null
  /** The SI style saved for the step on screen, or the project default. */
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
  const [detailsOpen, setDetailsOpen] = useState(false)
  return (
    <section className="project-bar" aria-label="项目信息">
      <h2 title={project.name}>{project.name}</h2>
      <StoreTypeTag project={project} />
      <span className="project-bar-facts">
        <span className="tag">{MARKET_LABELS[project.market]}</span>
        {facts && (
          <span className="hint project-bar-size">
            面积 {facts.area} · {facts.size} · 层高 {facts.height}
          </span>
        )}
      </span>
      <div className="tabs" role="group" aria-label="SI 风格">
        {SI_STYLES.map((style) => (
          <button
            key={style}
            type="button"
            aria-pressed={siStyle === style}
            disabled={siBusy || !!siLocked}
            title={siLocked ?? '切换空间或方案的 SI 时另存同层节点。没有改动时可切回原节点。'}
            onClick={() => {
              if (siStyle !== style) onSiSwitch?.(style)
            }}
          >
            {style}
          </button>
        ))}
      </div>
      <details
        className="project-bar-details"
        onToggle={(event) => setDetailsOpen(event.currentTarget.open)}
      >
        <summary aria-label="项目信息与 SI 提示" title="项目信息与 SI 提示">
          <Info size={16} aria-hidden="true" />
          {(notice || (error !== null && error !== undefined)) && (
            <span className="project-bar-dot" aria-hidden="true" />
          )}
        </summary>
        {detailsOpen && (
          <div className="project-bar-details-content">
            <ProjectDetails project={project} space={space} siStyle={siStyle} />
            {siLocked && <p className="hint">{siLocked}</p>}
            <ErrorMessage error={error} />
          </div>
        )}
      </details>
      {notice && (
        <span className="project-bar-live" role="status">
          {notice}
        </span>
      )}
    </section>
  )
}

export function CurrentSpaceCard({
  space,
  action,
  error,
}: {
  space: Space
  action: ReactNode
  error: boolean
}) {
  const facts = spaceFacts(space)
  return (
    <section className="space-info-card current-space-card">
      <header className="space-info-heading">
        <h3>当前空间</h3>
        {action}
      </header>
      <p className="space-info-size">{facts.size}</p>
      <dl className="space-info-metrics">
        <div>
          <dt>面积</dt>
          <dd>{facts.area}</dd>
        </div>
        <div>
          <dt>层高</dt>
          <dd>{facts.height}</dd>
        </div>
      </dl>
      {error && <p role="alert">请先完成当前节点的保存或渲染，再修改空间。</p>}
    </section>
  )
}

export function ProjectDetails({
  project,
  siStyle,
  space,
}: {
  project: Project
  siStyle: SiStyle
  space?: Space | null
}) {
  const facts = space ? spaceFacts(space) : null
  const rows: [string, string][] = [
    ['项目', project.name],
    ['店铺类型', project.storeType ? STORE_TYPE_LABELS[project.storeType] : '待设置'],
    ['铺位形态', SHOP_TYPE_LABELS[space?.shopType ?? project.shopType]],
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
