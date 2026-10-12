import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AiBudgetSchema, AiOverviewSchema, AiSettingsSchema } from '@store/shared'
import type { AiOverview, AiSettingsUpdate } from '@store/shared'
import { api, unwrap } from '../../api/client.ts'

export const aiKeys = {
  overview: ['ai', 'overview'] as const,
  budget: ['ai', 'budget'] as const,
}

/** Usable models, the choices in force and today's budget, in one request. */
export function useAiOverview() {
  return useQuery({
    queryKey: aiKeys.overview,
    queryFn: async () => AiOverviewSchema.parse(unwrap(await api.GET('/api/v1/ai'))),
  })
}

/** Today's remaining budget, refreshed often enough to notice spending. */
export function useAiBudget() {
  return useQuery({
    queryKey: aiKeys.budget,
    refetchInterval: 60_000,
    queryFn: async () => AiBudgetSchema.parse(unwrap(await api.GET('/api/v1/ai/budget'))),
  })
}

export function useUpdateAiSettings() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async (patch: AiSettingsUpdate) =>
      AiSettingsSchema.parse(unwrap(await api.PATCH('/api/v1/ai/settings', { body: patch }))),
    onSuccess: (settings) =>
      client.setQueryData<AiOverview>(aiKeys.overview, (current) =>
        current ? { ...current, settings } : current,
      ),
    onSettled: () => client.invalidateQueries({ queryKey: aiKeys.overview }),
  })
}
