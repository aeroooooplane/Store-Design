import { MARKET_LABELS, SHOP_TYPE_LABELS, SI_STYLES, mToMm, polygonArea } from '@store/shared'
import type { Project, Space } from '@store/shared'
import { ErrorMessage } from '../../components/ErrorMessage.tsx'
import { formatDateTime } from '../../lib/format.ts'
import { useUpdateProject } from '../projects/queries.ts'

/** Project name, the current space's size and the SI style switch (top of the left column). */
export function ProjectCard({ project, space }: { project: Project; space: Space | null }) {
  const update = useUpdateProject()
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
            aria-pressed={project.siStyle === style}
            disabled={update.isPending}
            title="决定自动排布与添加模型中的软装道具；已有方案不变"
            onClick={() => {
              if (project.siStyle !== style) update.mutate({ project, patch: { siStyle: style } })
            }}
          >
            {style}
          </button>
        ))}
      </div>
      <ErrorMessage error={update.error} />
    </section>
  )
}
