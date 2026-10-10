import { Link, useParams } from 'react-router'
import { MARKET_LABELS, SHOP_TYPE_LABELS, SI_STYLES } from '@store/shared'
import { ErrorMessage } from '../../components/ErrorMessage.tsx'
import { Workbench } from '../workbench/Workbench.tsx'
import { useProject, useUpdateProject } from './queries.ts'

export function ProjectPage() {
  const { projectId = '' } = useParams()
  const project = useProject(projectId)
  const update = useUpdateProject()

  return (
    <main className="page page-wide">
      <header className="page-header">
        <h1>{project.data?.name ?? '项目'}</h1>
        <p>
          {project.data
            ? `${SHOP_TYPE_LABELS[project.data.shopType]} · ${MARKET_LABELS[project.data.market]} · `
            : null}
          <Link to="/">← 返回项目列表</Link>
        </p>
      </header>
      {project.data && !project.data.deletedAt && (
        <div className="toolbar project-settings">
          <span className="tabs" role="group" aria-label="SI 风格">
            {SI_STYLES.map((style) => (
              <button
                key={style}
                type="button"
                aria-pressed={project.data?.siStyle === style}
                disabled={update.isPending}
                onClick={() => {
                  if (project.data && project.data.siStyle !== style) {
                    update.mutate({ project: project.data, patch: { siStyle: style } })
                  }
                }}
              >
                {style}
              </button>
            ))}
          </span>
          <span className="hint">
            SI
            风格决定自动排布与“添加模型”中的软装道具；已有方案不变。信息化物料、品牌标识与非标陈列两种风格都可用。
          </span>
        </div>
      )}
      <ErrorMessage error={project.error ?? update.error} />
      {project.data?.deletedAt ? (
        <p className="notice">项目在回收站中，恢复后才能继续编辑。</p>
      ) : project.data ? (
        <Workbench project={project.data} />
      ) : null}
    </main>
  )
}
