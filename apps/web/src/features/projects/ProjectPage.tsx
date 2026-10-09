import { Link, useParams } from 'react-router'
import { MARKET_LABELS, SHOP_TYPE_LABELS } from '@store/shared'
import { ErrorMessage } from '../../components/ErrorMessage.tsx'
import { formatDateTime } from '../../lib/format.ts'
import { useProject } from './queries.ts'

export function ProjectPage() {
  const { projectId = '' } = useParams()
  const project = useProject(projectId)

  return (
    <main className="page">
      <header className="page-header">
        <h1>{project.data?.name ?? '项目'}</h1>
        <p>
          <Link to="/">← 返回项目列表</Link>
        </p>
      </header>
      <ErrorMessage error={project.error} />
      {project.data ? (
        <>
          <dl className="facts">
            <dt>铺位形态</dt>
            <dd>{SHOP_TYPE_LABELS[project.data.shopType]}</dd>
            <dt>市场</dt>
            <dd>{MARKET_LABELS[project.data.market]}</dd>
            <dt>SI 风格</dt>
            <dd>{project.data.siStyle}</dd>
            <dt>创建时间</dt>
            <dd>{formatDateTime(project.data.createdAt)}</dd>
            <dt>状态</dt>
            <dd>{project.data.deletedAt ? '在回收站中' : '进行中'}</dd>
          </dl>
          <p className="notice">空间编辑、自动排布、白模与渲染将在后续阶段接入此页面。</p>
        </>
      ) : null}
    </main>
  )
}
