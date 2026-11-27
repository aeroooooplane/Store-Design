import {
  AGENT_STREAM_MEDIA_TYPE,
  AgentReplySchema,
  AgentStreamEventSchema,
  ERROR_CODES,
} from '@store/shared'
import type { AgentReply, AgentSend } from '@store/shared'
import { api, ApiRequestError, unwrap } from '../../api/client.ts'

type TurnUpdates = {
  onUser: (id: string) => void
  onText: (text: string) => void
}

/** Reveal small deltas character by character. Catch up when several arrive together. */
function typeText(onText: TurnUpdates['onText']) {
  const queue: string[] = []
  let timer: ReturnType<typeof setInterval> | undefined
  let drained: (() => void) | undefined

  function stop() {
    clearInterval(timer)
    timer = undefined
    drained?.()
  }

  return {
    add(text: string) {
      queue.push(...text)
      timer ??= setInterval(() => {
        onText(queue.splice(0, Math.max(1, Math.ceil(queue.length / 12))).join(''))
        if (!queue.length) stop()
      }, 16)
    },
    finish() {
      return timer ? new Promise<void>((resolve) => (drained = resolve)) : Promise.resolve()
    },
    stop,
  }
}

export async function sendAgentReply(
  sessionId: string,
  input: AgentSend,
  updates: TurnUpdates,
): Promise<AgentReply> {
  const response = await api.POST('/api/v1/agent/sessions/{sessionId}/messages', {
    params: { path: { sessionId } },
    headers: { Accept: AGENT_STREAM_MEDIA_TYPE },
    body: input,
    parseAs: 'stream',
  })
  if (!response.response.ok) unwrap(response)
  if (!response.response.headers.get('content-type')?.includes(AGENT_STREAM_MEDIA_TYPE)) {
    return AgentReplySchema.parse(await response.response.json())
  }

  const body = unwrap(response)
  if (!body) throw new Error('设计助理的回复缺少数据流')
  const reader = body.getReader()
  const decoder = new TextDecoder()
  const typing = typeText(updates.onText)
  let buffer = ''
  let round: number | undefined
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) throw new Error('设计助理的连接已中断，请查看对话记录')
      buffer += decoder.decode(value, { stream: true })
      let newline = buffer.indexOf('\n')
      while (newline !== -1) {
        const event = AgentStreamEventSchema.parse(JSON.parse(buffer.slice(0, newline)))
        buffer = buffer.slice(newline + 1)
        newline = buffer.indexOf('\n')
        switch (event.type) {
          case 'user':
            updates.onUser(event.id)
            break
          case 'delta':
            if (round !== undefined && round !== event.round) typing.add('\n\n')
            round = event.round
            typing.add(event.text)
            break
          case 'done':
            await typing.finish()
            return event.result
          case 'error': {
            const { code, message, requestId, details } = event.error
            const status = Object.entries(ERROR_CODES).find(([name]) => name === code)?.[1] ?? 500
            throw new ApiRequestError(status, code, message, requestId, details)
          }
        }
      }
    }
  } finally {
    typing.stop()
    await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
}
