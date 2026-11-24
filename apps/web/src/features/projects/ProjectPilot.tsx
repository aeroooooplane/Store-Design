import { useState } from 'react'
import type { Project } from '@store/shared'
import { ProjectForm } from './ProjectForm.tsx'
import { ProjectDrawings } from './ProjectDrawings.tsx'
import { useUpdateProject } from './queries.ts'

export function ProjectPilot({ project }: { project: Project }) {
  // Keep the revision seen when editing started, even if the query refreshes in the background.
  const [base, setBase] = useState(project)
  const update = useUpdateProject()

  return (
    <>
      <header className="page-header">
        <h1>{project.name}</h1>
        <p>试点仅使用虚构项目及假图纸。</p>
      </header>
      <ProjectForm
        key={base.revision}
        initial={base}
        label="保存项目"
        saving={update.isPending}
        error={update.error}
        onSave={async (patch) => setBase(await update.mutateAsync({ project: base, patch }))}
      />
      {update.isSuccess && <p role="status">项目已保存。</p>}
      <ProjectDrawings projectId={project.id} />
    </>
  )
}
