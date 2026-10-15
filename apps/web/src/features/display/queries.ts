import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  DisplayExportSchema,
  DisplayRulesViewSchema,
  DisplayTaskListSchema,
  DisplayTaskSchema,
  NodeDisplaySchema,
} from '@store/shared'
import type {
  DisplayPptOptions,
  DisplayDetectRequest,
  DisplayEdits,
  DisplayExport,
  DisplayTask,
  DisplayTaskCreate,
  DisplayTaskUpdate,
  NodeDisplay,
  NodeDisplayExportRequest,
} from '@store/shared'
import { api, ifMatch, unwrap } from '../../api/client.ts'

export const displayKeys = {
  rules: ['display', 'rules'] as const,
  tasks: ['display', 'tasks'] as const,
  task: (id: string) => ['display', 'task', id] as const,
  node: (nodeId: string) => ['display', 'node', nodeId] as const,
}

export function useDisplayRules() {
  return useQuery({
    queryKey: displayKeys.rules,
    queryFn: async () =>
      DisplayRulesViewSchema.parse(unwrap(await api.GET('/api/v1/display-rules/current'))),
    staleTime: 60_000,
  })
}

export function useDisplayTasks() {
  return useQuery({
    queryKey: displayKeys.tasks,
    queryFn: async () =>
      DisplayTaskListSchema.parse(unwrap(await api.GET('/api/v1/display-tasks'))),
  })
}

export function useDisplayTask(id: string) {
  return useQuery({
    queryKey: displayKeys.task(id),
    queryFn: async () =>
      DisplayTaskSchema.parse(
        unwrap(
          await api.GET('/api/v1/display-tasks/{taskId}', { params: { path: { taskId: id } } }),
        ),
      ),
  })
}

export function useCreateDisplayTask() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async (body: DisplayTaskCreate): Promise<DisplayTask> =>
      DisplayTaskSchema.parse(unwrap(await api.POST('/api/v1/display-tasks', { body }))),
    onSuccess: () => client.invalidateQueries({ queryKey: displayKeys.tasks }),
  })
}

export function useDeleteDisplayTask() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const result = await api.DELETE('/api/v1/display-tasks/{taskId}', {
        params: { path: { taskId: id } },
      })
      if (!result.response.ok) unwrap(result)
    },
    onSuccess: () => client.invalidateQueries({ queryKey: displayKeys.tasks }),
  })
}

/** Every change answers with the whole task, which replaces the cached one. */
function useTaskMutation<V>(
  id: string,
  call: (task: DisplayTask, input: V) => Promise<DisplayTask>,
) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async (input: V) => {
      const task = client.getQueryData<DisplayTask>(displayKeys.task(id))
      if (!task) throw new Error('展陈任务尚未载入')
      return call(task, input)
    },
    onSuccess: (task) => {
      client.setQueryData(displayKeys.task(id), task)
      void client.invalidateQueries({ queryKey: displayKeys.tasks })
    },
  })
}

export function useUpdateDisplayTask(id: string) {
  return useTaskMutation(id, async (task, body: DisplayTaskUpdate) =>
    DisplayTaskSchema.parse(
      unwrap(
        await api.PATCH('/api/v1/display-tasks/{taskId}', {
          params: { path: { taskId: id }, header: ifMatch(task.revision) },
          body,
        }),
      ),
    ),
  )
}

export interface PictureUpload {
  which: 'plan' | 'render'
  blob: Blob
  contentType: 'image/png' | 'image/jpeg'
  originalName: string
  page?: number
}

export function useUploadTaskPicture(id: string) {
  return useTaskMutation(id, async (task, input: PictureUpload) =>
    DisplayTaskSchema.parse(
      unwrap(
        await api.PUT('/api/v1/display-tasks/{taskId}/{which}', {
          params: {
            path: { taskId: id, which: input.which },
            header: ifMatch(task.revision),
            query: {
              originalName: input.originalName,
              ...(input.page ? { page: input.page } : {}),
            },
          },
          body: input.blob,
          bodySerializer: (body) => body as Blob,
          headers: { 'content-type': input.contentType },
        }),
      ),
    ),
  )
}

export function useDetectTables(id: string) {
  return useTaskMutation(id, async (task, body: DisplayDetectRequest) =>
    DisplayTaskSchema.parse(
      unwrap(
        await api.POST('/api/v1/display-tasks/{taskId}/detect', {
          params: { path: { taskId: id }, header: ifMatch(task.revision) },
          body,
        }),
      ),
    ),
  )
}

export function useExportDisplayTask(id: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async (body: DisplayPptOptions): Promise<DisplayExport> =>
      DisplayExportSchema.parse(
        unwrap(
          await api.POST('/api/v1/display-tasks/{taskId}/export', {
            params: { path: { taskId: id } },
            body,
          }),
        ),
      ),
    onSuccess: () => client.invalidateQueries({ queryKey: displayKeys.task(id) }),
  })
}

export function useNodeDisplay(nodeId: string, enabled = true) {
  return useQuery({
    queryKey: displayKeys.node(nodeId),
    enabled,
    queryFn: async () =>
      NodeDisplaySchema.parse(
        unwrap(await api.GET('/api/v1/nodes/{nodeId}/display', { params: { path: { nodeId } } })),
      ),
  })
}

export function useSaveNodeDisplay(nodeId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async (edits: DisplayEdits): Promise<NodeDisplay> => {
      const current = client.getQueryData<NodeDisplay>(displayKeys.node(nodeId))
      const header = current && current.revision > 0 ? ifMatch(current.revision) : {}
      return NodeDisplaySchema.parse(
        unwrap(
          await api.PUT('/api/v1/nodes/{nodeId}/display', {
            params: { path: { nodeId }, header },
            body: { edits },
          }),
        ),
      )
    },
    onSuccess: (display) => client.setQueryData(displayKeys.node(nodeId), display),
  })
}

export function useExportNodeDisplay(nodeId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async (body: NodeDisplayExportRequest): Promise<DisplayExport> =>
      DisplayExportSchema.parse(
        unwrap(
          await api.POST('/api/v1/nodes/{nodeId}/display/export', {
            params: { path: { nodeId } },
            body,
          }),
        ),
      ),
    onSuccess: () => client.invalidateQueries({ queryKey: displayKeys.node(nodeId) }),
  })
}
