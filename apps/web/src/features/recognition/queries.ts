import { useMutation, useQueryClient } from '@tanstack/react-query'
import { NodeCreatedSchema, PlanUploadSchema, RecognizeResponseSchema } from '@store/shared'
import type {
  NodeCreated,
  PlanUpload,
  RecognitionConfirm,
  RecognitionRun,
  RecognizeRequest,
  RecognizeResponse,
} from '@store/shared'
import { api, unwrap } from '../../api/client.ts'
import { workbenchKeys } from '../workbench/api.ts'

export const recognitionKeys = {
  uploads: (projectId: string) => ['recognition', projectId, 'uploads'] as const,
  runs: (uploadId: string) => ['recognition', 'runs', uploadId] as const,
}

export interface UploadInput {
  blob: Blob
  contentType: 'image/png' | 'image/jpeg'
  originalName: string
  /** PDF page the picture was rendered from. */
  page?: number
}

/** Sends a picture (or a rendered PDF page) as raw bytes. */
export function useUploadPlan(projectId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async ({
      blob,
      contentType,
      originalName,
      page,
    }: UploadInput): Promise<PlanUpload> =>
      PlanUploadSchema.parse(
        unwrap(
          await api.POST('/api/v1/projects/{projectId}/uploads', {
            params: {
              path: { projectId },
              query: { originalName, ...(page ? { page } : {}) },
            },
            body: blob,
            bodySerializer: (body) => body as Blob,
            headers: { 'content-type': contentType },
          }),
        ),
      ),
    onSuccess: () => client.invalidateQueries({ queryKey: recognitionKeys.uploads(projectId) }),
  })
}

export function useRecognize(uploadId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async (request: RecognizeRequest): Promise<RecognizeResponse> =>
      RecognizeResponseSchema.parse(
        unwrap(
          await api.POST('/api/v1/uploads/{uploadId}/recognize', {
            params: { path: { uploadId } },
            body: request,
          }),
        ),
      ),
    onSettled: () => client.invalidateQueries({ queryKey: recognitionKeys.runs(uploadId) }),
  })
}

/** The corrected space becomes a root space node; the history and the runs refresh. */
export function useConfirmRun(projectId: string, uploadId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async ({
      runId,
      ...body
    }: RecognitionConfirm & { runId: string }): Promise<NodeCreated> =>
      NodeCreatedSchema.parse(
        unwrap(
          await api.POST('/api/v1/recognition-runs/{runId}/confirm', {
            params: { path: { runId } },
            body,
          }),
        ),
      ),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: workbenchKeys.tree(projectId) })
      await client.invalidateQueries({ queryKey: recognitionKeys.runs(uploadId) })
    },
  })
}

export type { RecognitionRun }
