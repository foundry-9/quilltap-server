/**
 * @jest-environment node
 *
 * Unit tests for the shared tool-call threading primitives used by BOTH the
 * Salon's native-tool loop and the Brahma Console orchestrator. These encode
 * the rule whose absence made the console loop: an assistant tool-call turn
 * must carry its `toolCalls`, and each result must be paired back to its call.
 */

import {
  buildAssistantToolCallMessage,
  buildToolResultMessages,
} from '@/lib/services/chat-message/tool-call-threading'
import type { ToolMessage } from '@/lib/services/chat-message/types'

describe('buildAssistantToolCallMessage', () => {
  it('attaches the toolCalls array when calls carry provider call IDs', () => {
    const msg = buildAssistantToolCallMessage(
      [{ name: 'run_sql', arguments: { sql: 'SELECT 1' }, callId: 'call_1' }],
      '',
    )
    expect(msg.role).toBe('assistant')
    expect(msg.content).toBe('')
    expect(msg.toolCalls).toEqual([
      { id: 'call_1', type: 'function', function: { name: 'run_sql', arguments: JSON.stringify({ sql: 'SELECT 1' }) } },
    ])
  })

  it('preserves accompanying prose and forwards reasoning/thoughtSignature', () => {
    const msg = buildAssistantToolCallMessage(
      [{ name: 'doc_open_file', arguments: { path: 'a.md' }, callId: 'tc-9' }],
      'Let me open it. ',
      { reasoningContent: 'thinking…', thoughtSignature: 'sig-1' },
    )
    expect(msg.content).toBe('Let me open it. ')
    expect(msg.reasoningContent).toBe('thinking…')
    expect(msg.thoughtSignature).toBe('sig-1')
  })

  it('omits toolCalls entirely when no call has an ID (text-fallback providers)', () => {
    const msg = buildAssistantToolCallMessage(
      [{ name: 'image', arguments: { prompt: 'x' } }],
      '',
    )
    expect(msg.toolCalls).toBeUndefined()
  })

  it('collapses whitespace-only prose to an empty string', () => {
    const msg = buildAssistantToolCallMessage([{ name: 't', arguments: {}, callId: 'c' }], '   \n ')
    expect(msg.content).toBe('')
  })
})

describe('buildToolResultMessages', () => {
  it('emits a native tool-role message paired by toolCallId when a call ID exists', () => {
    const toolMessages: ToolMessage[] = [
      { toolName: 'run_sql', success: true, content: '{"rows":[1]}', callId: 'call_1' },
    ]
    expect(buildToolResultMessages(toolMessages)).toEqual([
      { role: 'tool', content: '{"rows":[1]}', toolCallId: 'call_1', name: 'run_sql', thoughtSignature: undefined, reasoningContent: undefined },
    ])
  })

  it('falls back to a [Tool Result] user message when there is no call ID', () => {
    const toolMessages: ToolMessage[] = [
      { toolName: 'image', success: true, content: 'generated' },
    ]
    expect(buildToolResultMessages(toolMessages)).toEqual([
      { role: 'user', content: '[Tool Result: image]\ngenerated', thoughtSignature: undefined, reasoningContent: undefined, name: undefined },
    ])
  })

  it('preserves order across a mixed batch', () => {
    const toolMessages: ToolMessage[] = [
      { toolName: 'a', success: true, content: 'ra', callId: 'c1' },
      { toolName: 'b', success: true, content: 'rb' },
    ]
    const out = buildToolResultMessages(toolMessages)
    expect(out.map(m => m.role)).toEqual(['tool', 'user'])
    expect(out[0].toolCallId).toBe('c1')
    expect(out[1].content).toBe('[Tool Result: b]\nrb')
  })
})
