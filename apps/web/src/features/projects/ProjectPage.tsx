import { Link, useParams } from 'react-router'
import { ErrorMessage } from '../../components/ErrorMessage.tsx'
import { Workbench } from '../workbench/Workbench.tsx'
import { projectExportUrl, useProject } from './queries.ts'

/** A project: the workbench, with name, details and SI switch in its project card. */
export function ProjectPage() {
  const { projectId = '' } = useParams()
  const project = useProject(projectId)

  return (
    <main className="page page-workbench">
      <header className="workbench-bar">
        <Link to="/">← 项目列表</Link>
        <span className="workbench-bar-end">
          {project.data && !project.data.deletedAt && (
            <a
              href={projectExportUrl(projectId)}
              download
              title="导出为项目文件（含全部节点与草稿）"
            >
              导出项目
            </a>
          )}
          <span className="hint">门店空间设计工作台</span>
        </span>
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
