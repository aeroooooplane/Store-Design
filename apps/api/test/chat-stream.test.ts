import { describe, expect, it, vi } from 'vitest'
import { readAnthropicStream, readOpenAiStream } from '../src/ai/chat-stream.ts'

function events(...frames: unknown[]) {
  return new Response(frames.map((frame) => 'data: ' + JSON.stringify(frame) + '\n\n').join(''))
}

describe('model streaming', () => {
  it('combines Anthropic text, tool arguments and cumulative usage', async () => {
    const onText = vi.fn()
    const result = await readAnthropicStream(
      events(
        { type: 'message_start', message: { usage: { input_tokens: 120, output_tokens: 1 } } },
        { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '检查' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '布局' } },
        {
          type: 'content_block_start',
          index: 1,
          content_block: { type: 'tool_use', id: 'tool_1', name: 'list_models', input: {} },
        },
        {
          type: 'content_block_delta',
          index: 1,
          delta: { type: 'input_json_delta', partial_json: '{"function":' },
        },
        {
          type: 'content_block_delta',
          index: 1,
          delta: { type: 'input_json_delta', partial_json: '"island_table"}' },
        },
        { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 20 } },
        { type: 'message_stop' },
      ),
      onText,
    )
    expect(onText.mock.calls).toEqual([['检查'], ['布局']])
    expect(result).toEqual({
      content: [
        { type: 'text', text: '检查布局' },
        {
          type: 'tool_use',
          id: 'tool_1',
          name: 'list_models',
          input: '{"function":"island_table"}',
        },
      ],
      usage: { input_tokens: 120, output_tokens: 20 },
    })
  })

  it('rejects an interrupted response rather than returning an incomplete tool call', async () => {
    await expect(
      readOpenAiStream(
        events({
          choices: [
            {
              delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'place_item' } }] },
            },
          ],
        }),
        vi.fn(),
      ),
    ).rejects.toThrow('模型响应流提前结束')
  })
})
