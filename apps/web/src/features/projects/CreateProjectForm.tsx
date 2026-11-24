import { ProjectForm } from './ProjectForm.tsx'
import { useCreateProject } from './queries.ts'

const initial = { name: '', shopType: 'side_hall', market: 'domestic', siStyle: 'SI1.0' } as const

export function CreateProjectForm() {
  const create = useCreateProject()

  return (
    <ProjectForm
      initial={initial}
      label="新建项目"
      saving={create.isPending}
      error={create.error}
      onSave={create.mutateAsync}
      clearNameOnSave
    />
  )
}
