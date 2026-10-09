import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Project, ProjectCreate } from '@store/shared'
import { api, ifMatch, unwrap } from '../../api/client.ts'

export interface ProjectListParams {
  q: string
  status: 'active' | 'deleted'
  page: number
}

export const PAGE_SIZE = 20

const keys = {
  all: ['projects'] as const,
  list: (params: ProjectListParams) => ['projects', 'list', params] as const,
  detail: (id: string) => ['projects', 'detail', id] as const,
}

export function useProjectList(params: ProjectListParams) {
  return useQuery({
    queryKey: keys.list(params),
    queryFn: async () =>
      unwrap(
        await api.GET('/api/v1/projects', {
          params: {
            query: {
              status: params.status,
              page: params.page,
              pageSize: PAGE_SIZE,
              ...(params.q.trim() ? { q: params.q.trim() } : {}),
            },
          },
        }),
      ),
    placeholderData: keepPreviousData,
  })
}

export function useProject(id: string) {
  return useQuery({
    queryKey: keys.detail(id),
    queryFn: async () =>
      unwrap(
        await api.GET('/api/v1/projects/{projectId}', { params: { path: { projectId: id } } }),
      ),
  })
}

export function useCreateProject() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async (body: ProjectCreate) => unwrap(await api.POST('/api/v1/projects', { body })),
    onSuccess: () => client.invalidateQueries({ queryKey: keys.all }),
  })
}

/** Moves a project into the recycle bin or back, guarded by its current revision. */
export function useSetProjectDeleted() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async ({ project, deleted }: { project: Project; deleted: boolean }) => {
      const params = { path: { projectId: project.id }, header: ifMatch(project.revision) }
      return deleted
        ? unwrap(await api.DELETE('/api/v1/projects/{projectId}', { params }))
        : unwrap(await api.POST('/api/v1/projects/{projectId}/restore', { params }))
    },
    onSettled: () => client.invalidateQueries({ queryKey: keys.all }),
  })
}
