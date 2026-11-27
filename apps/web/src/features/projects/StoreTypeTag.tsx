import { STORE_TYPES, STORE_TYPE_LABELS, StoreTypeSchema } from '@store/shared'
import type { Project } from '@store/shared'
import { ErrorMessage } from '../../components/ErrorMessage.tsx'
import { useUpdateProject } from './queries.ts'
import './store-type-tag.css'

export function StoreTypeTag({ project }: { project: Project }) {
  const update = useUpdateProject()

  return (
    <div className="project-store-type">
      <select
        aria-label="店铺类型"
        title="修改店铺类型"
        aria-busy={update.isPending}
        className="tag"
        value={project.storeType ?? ''}
        disabled={update.isPending || project.deletedAt !== null}
        onChange={(event) => {
          const next = StoreTypeSchema.safeParse(event.target.value)
          if (next.success && next.data !== project.storeType) {
            update.mutate({ project, patch: { storeType: next.data } })
          }
        }}
      >
        <option value="" disabled>
          待设置
        </option>
        {STORE_TYPES.map((type) => (
          <option key={type} value={type}>
            {STORE_TYPE_LABELS[type]}
          </option>
        ))}
      </select>
      {update.error && (
        <div className="project-store-type-error">
          <ErrorMessage error={update.error} />
        </div>
      )}
    </div>
  )
}
