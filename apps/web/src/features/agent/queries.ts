import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AgentActionSchema,
  AgentMessageSchema,
  AgentReplySchema,
  AgentSessionSchema,
} from '@store/shared'
import type { AgentAction, AgentReply, AgentSend, AgentSession } from '@store/shared'
import { api, unwrap } from '../../api/client.ts'
import { workbenchKeys } from '../workbench/api.ts'

export const agentKeys = {
  sessions: (projectId: string) => ['agent', projectId, 'sessions'] as const,
  messages: (sessionId: string) => ['agent', 'messages', sessionId] as const,
}

export function useAgentSessions(projectId: string) {
  return useQuery({
    queryKey: agentKeys.sessions(projectId),
    queryFn: async () =>
      AgentSessionSchema.array().parse(
        unwrap(
          await api.GET('/api/v1/projects/{projectId}/agent/sessions', {
            params: { path: { projectId } },
          }),
        ),
      ),
  })
}

export function useCreateSession(projectId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async (): Promise<AgentSession> =>
      AgentSessionSchema.parse(
        unwrap(
          await api.POST('/api/v1/projects/{projectId}/agent/sessions', {
            params: { path: { projectId } },
            body: {},
          }),
        ),
      ),
    onSuccess: () => client.invalidateQueries({ queryKey: agentKeys.sessions(projectId) }),
  })
}

export function useAgentMessages(sessionId: string | null) {
  return useQuery({
    queryKey: agentKeys.messages(sessionId ?? 'none'),
    enabled: sessionId !== null,
    queryFn: async () =>
      AgentMessageSchema.array().parse(
        unwrap(
          await api.GET('/api/v1/agent/sessions/{sessionId}/messages', {
            params: { path: { sessionId: sessionId ?? '' } },
          }),
        ),
      ),
  })
}

/** One turn; the history tree is reloaded since the agent may have added nodes. */
export function useSendMessage(projectId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async ({
      sessionId,
      input,
    }: {
      sessionId: string
      input: AgentSend
    }): Promise<AgentReply> =>
      AgentReplySchema.parse(
        unwrap(
          await api.POST('/api/v1/agent/sessions/{sessionId}/messages', {
            params: { path: { sessionId } },
            body: input,
          }),
        ),
      ),
    onSettled: async (_reply, _error, { sessionId }) => {
      await client.invalidateQueries({ queryKey: agentKeys.messages(sessionId) })
      await client.invalidateQueries({ queryKey: agentKeys.sessions(projectId) })
      await client.invalidateQueries({ queryKey: workbenchKeys.tree(projectId) })
    },
  })
}

export function useUndoAction(projectId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async ({
      actionId,
    }: {
      sessionId: string
      actionId: string
    }): Promise<AgentAction> =>
      AgentActionSchema.parse(
        unwrap(
          await api.POST('/api/v1/agent/actions/{actionId}/undo', {
            params: { path: { actionId } },
          }),
        ),
      ),
    onSettled: async (_action, _error, { sessionId }) => {
      await client.invalidateQueries({ queryKey: agentKeys.messages(sessionId) })
      await client.invalidateQueries({ queryKey: workbenchKeys.tree(projectId) })
    },
  })
}
