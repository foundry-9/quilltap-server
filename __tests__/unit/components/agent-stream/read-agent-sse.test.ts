/**
 * @jest-environment node
 */
/**
 * readAgentSse — the one SSE read loop behind the three console clients
 * (Help chat, Brahma Console, the agent-stream runs).
 */
import { readAgentSse } from '@/components/agent-stream/parse-agent-stream'

function responseOf(chunks: string[]): Response {
  const encoder = new TextEncoder()
  let i = 0
  return {
    body: {
      getReader: () => ({
        read: async () =>
          i < chunks.length ? { done: false, value: encoder.encode(chunks[i++]) } : { done: true, value: undefined },
      }),
    },
  } as unknown as Response
}

describe('readAgentSse', () => {
  it('hands each data event to the handler, across chunk boundaries, and reports the end', async () => {
    const events: unknown[] = []
    const outcome = await readAgentSse(
      responseOf(['data: {"content":"Old ', 'sport"}\n\n: keep-alive\n\ndata: {"done":true}\n\n']),
      (event) => {
        events.push(event)
      },
    )
    expect(outcome).toBe('ended')
    expect(events).toEqual([{ content: 'Old sport' }, { done: true }])
  })

  it('stops reading when the handler returns true', async () => {
    const events: unknown[] = []
    const outcome = await readAgentSse(
      responseOf(['data: {"error":"boom"}\n\ndata: {"content":"never"}\n\n']),
      (event) => {
        events.push(event)
        return true
      },
    )
    expect(outcome).toBe('stopped')
    expect(events).toEqual([{ error: 'boom' }])
  })

  it('throws when the response has no body', async () => {
    await expect(readAgentSse({ body: null } as unknown as Response, () => {})).rejects.toThrow('No response body')
  })
})
