import { useParams } from 'react-router'
import { Download } from 'lucide-react'
import { ProjectNavSlot } from '../../components/AppNav.tsx'
import { ErrorMessage } from '../../components/ErrorMessage.tsx'
import { Workbench } from '../workbench/Workbench.tsx'
import { projectExportUrl, useProject } from './queries.ts'

/** A project: the workbench, with name, details and SI switch in its project card. */
export function ProjectPage() {
  const { projectId = '' } = useParams()
  const project = useProject(projectId)

  return (
    <main className="page page-workbench">
      {project.data && !project.data.deletedAt && (
        <ProjectNavSlot slot="actions">
          <a
            className="with-icon"
            href={projectExportUrl(projectId)}
            download
            title="导出为项目文件（含全部节点与草稿）"
          >
            <Download size={16} aria-hidden="true" />
            导出项目
          </a>
        </ProjectNavSlot>
      )}
      <ErrorMessage error={project.error} />
      {project.data?.deletedAt ? (
        <p className="notice">项目在回收站中，恢复后才能继续编辑。</p>
      ) : project.data ? (
        <Workbench project={project.data} />
      ) : null}
    </main>
  )
}
