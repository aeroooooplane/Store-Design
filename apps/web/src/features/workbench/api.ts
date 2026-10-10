import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AssetListSchema,
  DraftSavedSchema,
  DraftSchema,
  LayoutCandidatesSchema,
  NodeCameraListSchema,
  NodeCameraSchema,
  NodeCreatedSchema,
  NodeSchema,
  NodeTreeSchema,
} from '@store/shared'
import type {
  CameraCreate,
  CameraUpdate,
  Draft,
  DraftSaved,
  Layout,
  LayoutGenerate,
  NodeCreateInput,
} from '@store/shared'
import { ApiRequestError, api, ifMatch, unwrap } from '../../api/client.ts'

/** Every response is parsed with the shared schemas, so runtime data matches the types. */
export const workbenchKeys = {
  tree: (projectId: string) => ['workbench', projectId, 'tree'] as const,
  node: (nodeId: string) => ['workbench', 'node', nodeId] as const,
  draft: (projectId: string) => ['workbench', projectId, 'draft'] as const,
  assets: ['workbench', 'assets'] as const,
  cameras: (nodeId: string) => ['workbench', 'cameras', nodeId] as const,
}

export function useTree(projectId: string) {
  return useQuery({
    queryKey: workbenchKeys.tree(projectId),
    queryFn: async () =>
      NodeTreeSchema.parse(
        unwrap(
          await api.GET('/api/v1/projects/{projectId}/nodes', {
            params: { path: { projectId }, query: { includeHidden: 'true' } },
          }),
        ),
      ),
  })
}

export function useNode(nodeId: string | null) {
  return useQuery({
    queryKey: workbenchKeys.node(nodeId ?? 'none'),
    enabled: nodeId !== null,
    // Nodes never change after creation (except name/hidden, which the tree carries).
    staleTime: Infinity,
    queryFn: async () =>
      NodeSchema.parse(
        unwrap(
          await api.GET('/api/v1/nodes/{nodeId}', { params: { path: { nodeId: nodeId ?? '' } } }),
        ),
      ),
  })
}

/** The whole catalogue: placeable models plus those that can only be placeholders. */
export function useCatalog() {
  return useQuery({
    queryKey: workbenchKeys.assets,
    staleTime: 5 * 60_000,
    queryFn: async () => AssetListSchema.parse(unwrap(await api.GET('/api/v1/assets'))).items,
  })
}

/** The shared draft, or null when there is none (404). */
export function useDraft(projectId: string) {
  return useQuery({
    queryKey: workbenchKeys.draft(projectId),
    queryFn: async (): Promise<Draft | null> => {
      try {
        return DraftSchema.parse(
          unwrap(
            await api.GET('/api/v1/projects/{projectId}/draft', {
              params: { path: { projectId } },
            }),
          ),
        )
      } catch (error) {
        if (error instanceof ApiRequestError && error.status === 404) return null
        throw error
      }
    },
  })
}

export async function putDraft(
  projectId: string,
  body: { baseNodeId: string; layout: Layout },
  revision: number | null,
): Promise<DraftSaved> {
  const header = revision === null ? {} : ifMatch(revision)
  return DraftSavedSchema.parse(
    unwrap(
      await api.PUT('/api/v1/projects/{projectId}/draft', {
        params: { path: { projectId }, header },
        body,
      }),
    ),
  )
}

export async function deleteDraft(projectId: string, revision: number): Promise<void> {
  const result = await api.DELETE('/api/v1/projects/{projectId}/draft', {
    params: { path: { projectId }, header: ifMatch(revision) },
  })
  if (result.error !== undefined) unwrap(result)
}

export function useCreateNode(projectId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async (body: NodeCreateInput) =>
      NodeCreatedSchema.parse(
        unwrap(
          await api.POST('/api/v1/projects/{projectId}/nodes', {
            params: { path: { projectId } },
            body,
          }),
        ),
      ),
    // Awaited, so callers can select the new node once the tree contains it.
    onSuccess: (created) => {
      client.setQueryData(workbenchKeys.node(created.node.id), created.node)
      return client.invalidateQueries({ queryKey: workbenchKeys.tree(projectId) })
    },
  })
}

export function useNodeVisibility(projectId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async ({ nodeId, hidden }: { nodeId: string; hidden: boolean }) => {
      const params = { params: { path: { nodeId } } }
      return NodeSchema.parse(
        unwrap(
          hidden
            ? await api.POST('/api/v1/nodes/{nodeId}/hide', params)
            : await api.POST('/api/v1/nodes/{nodeId}/restore', params),
        ),
      )
    },
    onSettled: () => client.invalidateQueries({ queryKey: workbenchKeys.tree(projectId) }),
  })
}

export function useRenameNode(projectId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async ({ nodeId, name }: { nodeId: string; name: string }) =>
      NodeSchema.parse(
        unwrap(
          await api.PATCH('/api/v1/nodes/{nodeId}', {
            params: { path: { nodeId } },
            body: { name },
          }),
        ),
      ),
    onSettled: () => client.invalidateQueries({ queryKey: workbenchKeys.tree(projectId) }),
  })
}

export function useGenerateLayouts() {
  return useMutation({
    mutationFn: async (
      body: Partial<LayoutGenerate> & Pick<LayoutGenerate, 'space' | 'shopType'>,
    ) => LayoutCandidatesSchema.parse(unwrap(await api.POST('/api/v1/layouts/generate', { body }))),
  })
}

/** All views of a white-model node, including removed ones (they can be restored). */
export function useCameras(nodeId: string) {
  return useQuery({
    queryKey: workbenchKeys.cameras(nodeId),
    queryFn: async () =>
      NodeCameraListSchema.parse(
        unwrap(
          await api.GET('/api/v1/nodes/{nodeId}/cameras', {
            params: { path: { nodeId }, query: { includeDeleted: 'true' } },
          }),
        ),
      ).cameras,
  })
}

export type CameraAction =
  | { type: 'add'; camera: CameraCreate }
  | { type: 'update'; cameraId: string; patch: CameraUpdate }
  | { type: 'remove' | 'restore'; cameraId: string }

export function useCameraAction(nodeId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async (action: CameraAction) => {
      if (action.type === 'add') {
        return unwrap(
          await api.POST('/api/v1/nodes/{nodeId}/cameras', {
            params: { path: { nodeId } },
            body: action.camera,
          }),
        )
      }
      const params = { params: { path: { cameraId: action.cameraId } } }
      return NodeCameraSchema.parse(
        unwrap(
          action.type === 'update'
            ? await api.PATCH('/api/v1/cameras/{cameraId}', { ...params, body: action.patch })
            : action.type === 'remove'
              ? await api.DELETE('/api/v1/cameras/{cameraId}', params)
              : await api.POST('/api/v1/cameras/{cameraId}/restore', params),
        ),
      )
    },
    onSettled: () => client.invalidateQueries({ queryKey: workbenchKeys.cameras(nodeId) }),
  })
}
