import type { ReadableStream } from 'node:stream/web'

type OnText = (text: string) => void
type ToolFragment = { id?: string; name?: string; arguments: string }

export interface OpenAiResponse {
  choices?: {
    message?: {
      content?: string | null
      tool_calls?: { id?: string; function?: { name?: string; arguments?: unknown } }[]
    }
  }[]
  usage?: { prompt_tokens?: number; completion_tokens?: number }
}

type OpenAiDelta = {
  choices?: {
    delta?: {
      content?: string | null
      tool_calls?: {
        index: number
        id?: string
        function?: { name?: string; arguments?: string }
      }[]
    }
    finish_reason?: string | null
  }[]
  usage?: OpenAiResponse['usage'] | null
  error?: { message?: string }
}

export interface AnthropicResponse {
  content?: { type: string; text?: string; id?: string; name?: string; input?: unknown }[]
  usage?: { input_tokens?: number; output_tokens?: number }
}

type AnthropicEvent =
  | { type: 'message_start'; message: AnthropicResponse }
  | { type: 'message_delta'; delta?: { stop_reason?: string }; usage?: AnthropicResponse['usage'] }
  | {
      type: 'content_block_start'
      index: number
      content_block: NonNullable<AnthropicResponse['content']>[number]
    }
  | {
      type: 'content_block_delta'
      index: number
      delta: { type: string; text?: string; partial_json?: string }
    }
  | { type: 'message_stop' }
  | { type: 'error'; error?: { message?: string } }

async function* eventData(response: Response): AsyncGenerator<string> {
  if (!response.body) throw new Error('模型响应缺少数据流')
  const reader = (response.body as ReadableStream<Uint8Array>).getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let lines: string[] = []
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let newline = buffer.indexOf('\n')
      while (newline !== -1) {
        const line = buffer.slice(0, newline).replace(/\r$/, '')
        buffer = buffer.slice(newline + 1)
        if (line.startsWith('data:')) lines.push(line.slice(5).replace(/^ /, ''))
        else if (line === '' && lines.length) {
          yield lines.join('\n')
          lines = []
        }
        newline = buffer.indexOf('\n')
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
}

export async function readOpenAiStream(
  response: Response,
  onText: OnText,
): Promise<OpenAiResponse> {
  let text = ''
  let usage: OpenAiResponse['usage']
  let finish: string | null | undefined
  const calls = new Map<number, ToolFragment>()
  for await (const data of eventData(response)) {
    if (data === '[DONE]') {
      if (
        !finish ||
        ['content_filter', 'insufficient_system_resource', 'aborted'].includes(finish)
      ) {
        throw new Error('模型未正常完成回复')
      }
      if (calls.size && !['tool_calls', 'stop'].includes(finish))
        throw new Error('工具参数未完整返回')
      return {
        choices: [
          {
            message: {
              content: text,
              tool_calls: [...calls.entries()]
                .sort(([a], [b]) => a - b)
                .map(([, call]) => ({
                  id: call.id,
                  function: { name: call.name, arguments: call.arguments },
                })),
            },
          },
        ],
        usage,
      }
    }
    const chunk = JSON.parse(data) as OpenAiDelta
    if (chunk.error) throw new Error(chunk.error.message?.slice(0, 300) || '模型中断了回复')
    if (chunk.usage) usage = chunk.usage
    const choice = chunk.choices?.[0]
    if (choice?.finish_reason) finish = choice.finish_reason
    const delta = choice?.delta
    if (delta?.content) {
      text += delta.content
      onText(delta.content)
    }
    for (const fragment of delta?.tool_calls ?? []) {
      const call = calls.get(fragment.index) ?? { arguments: '' }
      if (fragment.id) call.id = fragment.id
      if (fragment.function?.name) call.name = (call.name ?? '') + fragment.function.name
      call.arguments += fragment.function?.arguments ?? ''
      calls.set(fragment.index, call)
    }
  }
  throw new Error('模型响应流提前结束')
}

export async function readAnthropicStream(
  response: Response,
  onText: OnText,
): Promise<AnthropicResponse> {
  const blocks: NonNullable<AnthropicResponse['content']> = []
  const argumentsByIndex = new Map<number, string>()
  let usage: AnthropicResponse['usage']
  let finish: string | undefined
  for await (const data of eventData(response)) {
    const event = JSON.parse(data) as AnthropicEvent
    switch (event.type) {
      case 'message_start':
        usage = event.message.usage
        break
      case 'message_delta':
        usage = { ...usage, ...event.usage }
        if (event.delta?.stop_reason) finish = event.delta.stop_reason
        break
      case 'content_block_start': {
        const block = event.content_block
        blocks[event.index] = block
        if (block.type === 'text' && block.text) onText(block.text)
        break
      }
      case 'content_block_delta': {
        const block = blocks[event.index]
        if (block?.type === 'text' && event.delta.type === 'text_delta' && event.delta.text) {
          block.text = (block.text ?? '') + event.delta.text
          onText(event.delta.text)
        }
        if (block?.type === 'tool_use' && event.delta.type === 'input_json_delta') {
          argumentsByIndex.set(
            event.index,
            (argumentsByIndex.get(event.index) ?? '') + (event.delta.partial_json ?? ''),
          )
        }
        break
      }
      case 'message_stop':
        if (blocks.some((block) => block.type === 'tool_use') && finish !== 'tool_use') {
          throw new Error('工具参数未完整返回')
        }
        for (const [index, input] of argumentsByIndex) {
          const block = blocks[index]
          if (block) block.input = input
        }
        return { content: blocks.filter(Boolean), usage }
      case 'error':
        throw new Error(event.error?.message?.slice(0, 300) || '模型中断了回复')
    }
  }
  throw new Error('模型响应流提前结束')
}
