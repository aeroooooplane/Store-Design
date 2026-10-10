import { Link, useParams } from 'react-router'
import { MARKET_LABELS, SHOP_TYPE_LABELS } from '@store/shared'
import { ErrorMessage } from '../../components/ErrorMessage.tsx'
import { Workbench } from '../workbench/Workbench.tsx'
import { useProject } from './queries.ts'

export function ProjectPage() {
  const { projectId = '' } = useParams()
  const project = useProject(projectId)

  return (
    <main className="page page-wide">
      <header className="page-header">
        <h1>{project.data?.name ?? '项目'}</h1>
        <p>
          {project.data
            ? `${SHOP_TYPE_LABELS[project.data.shopType]} · ${MARKET_LABELS[project.data.market]} · ${project.data.siStyle} · `
            : null}
          <Link to="/">← 返回项目列表</Link>
        </p>
      </header>
      <ErrorMessage error={project.error} />
      {project.data?.deletedAt ? (
        <p className="notice">项目在回收站中，恢复后才能继续编辑。</p>
      ) : project.data ? (
        <Workbench project={project.data} />
      ) : null}
    </main>
  )
}
