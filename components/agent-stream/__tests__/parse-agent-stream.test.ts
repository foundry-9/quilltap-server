/**
 * Pure-function tests for the shared agent SSE parser (`parse-agent-stream.ts`),
 * used by both the Brahma Console streaming hook and the Scenario Builder's
 * `useScenarioBuilderRun`.
 */

import {
  applyAgentStreamEvent,
  EMPTY_AGENT_TOOL_CALL_STATE,
  parseAgentSseLine,
  splitSseBuffer,
  type AgentToolCallState,
} from '../parse-agent-stream'

describe('parseAgentSseLine', () => {
  it('parses a well-formed data line into its JSON payload', () => {
    expect(parseAgentSseLine('data: {"done":true,"scenario":"A scene."}')).toEqual({
      done: true,
      scenario: 'A scene.',
    })
  })

  it('returns null for a comment / keep-alive line', () => {
    expect(parseAgentSseLine(': keep-alive')).toBeNull()
  })

  it('returns null for a blank line', () => {
    expect(parseAgentSseLine('')).toBeNull()
  })

  it('returns null for a data line with empty payload', () => {
    expect(parseAgentSseLine('data: ')).toBeNull()
  })

  it('returns null for malformed JSON', () => {
    expect(parseAgentSseLine('data: {not json')).toBeNull()
  })

  it('returns null when the payload is a JSON array rather than an object', () => {
    expect(parseAgentSseLine('data: [1,2,3]')).toBeNull()
  })

  it('returns null for a line that is not a data line at all', () => {
    expect(parseAgentSseLine('event: ping')).toBeNull()
  })
})

describe('splitSseBuffer', () => {
  it('splits complete lines and carries the trailing partial line over', () => {
    const { lines, rest } = splitSseBuffer('', 'data: {"a":1}\n\ndata: {"b":2}\n\ndata: {"c"')
    expect(lines).toEqual(['data: {"a":1}', '', 'data: {"b":2}', ''])
    expect(rest).toBe('data: {"c"')
  })

  it('joins a carried-over partial line with the next chunk', () => {
    const first = splitSseBuffer('', 'data: {"a"')
    expect(first.rest).toBe('data: {"a"')

    const second = splitSseBuffer(first.rest, ':1}\n\n')
    expect(second.lines).toEqual(['data: {"a":1}', ''])
    expect(second.rest).toBe('')
  })

  it('returns everything as rest when there is no newline yet', () => {
    const { lines, rest } = splitSseBuffer('', 'data: {"a":1}')
    expect(lines).toEqual([])
    expect(rest).toBe('data: {"a":1}')
  })
})

describe('applyAgentStreamEvent', () => {
  it('starts from EMPTY_AGENT_TOOL_CALL_STATE with no tool calls', () => {
    expect(EMPTY_AGENT_TOOL_CALL_STATE).toEqual({ toolCalls: [], batchBase: 0 })
  })

  it('returns the same state object when the event carries nothing tool-related', () => {
    const state = EMPTY_AGENT_TOOL_CALL_STATE
    const next = applyAgentStreamEvent(state, { reasoning: 'thinking…' })
    expect(next).toBe(state)
  })

  it('adds pending entries for a toolsDetected batch', () => {
    const next = applyAgentStreamEvent(EMPTY_AGENT_TOOL_CALL_STATE, {
      toolsDetected: 2,
      toolNames: ['search_web', 'curl'],
      toolArguments: [{ query: 'Gare du Nord' }, { url: 'https://example.com' }],
    })

    expect(next.toolCalls).toEqual([
      { name: 'search_web', arguments: { query: 'Gare du Nord' }, pending: true },
      { name: 'curl', arguments: { url: 'https://example.com' }, pending: true },
    ])
    expect(next.batchBase).toBe(0)
  })

  it('falls back to "unknown" name and {} arguments for a malformed entry', () => {
    const next = applyAgentStreamEvent(EMPTY_AGENT_TOOL_CALL_STATE, {
      toolsDetected: 1,
      toolNames: [42],
      toolArguments: ['not an object'],
    })

    expect(next.toolCalls).toEqual([{ name: 'unknown', arguments: {}, pending: true }])
  })

  it('settles a pending call by index on a matching toolResult', () => {
    let state = applyAgentStreamEvent(EMPTY_AGENT_TOOL_CALL_STATE, {
      toolsDetected: 1,
      toolNames: ['search'],
      toolArguments: [{ query: 'inn' }],
    })

    state = applyAgentStreamEvent(state, {
      toolResult: { index: 0, success: true, result: { hits: 3 } },
    })

    expect(state.toolCalls).toEqual([
      {
        name: 'search',
        arguments: { query: 'inn' },
        pending: false,
        success: true,
        result: { hits: 3 },
        error: undefined,
      },
    ])
  })

  it('records a string error on a failed toolResult', () => {
    let state = applyAgentStreamEvent(EMPTY_AGENT_TOOL_CALL_STATE, {
      toolsDetected: 1,
      toolNames: ['curl'],
      toolArguments: [{ url: 'https://example.com' }],
    })

    state = applyAgentStreamEvent(state, {
      toolResult: { index: 0, success: false, error: 'timed out' },
    })

    expect(state.toolCalls[0]).toMatchObject({ success: false, error: 'timed out', pending: false })
  })

  it('ignores a toolResult with no matching pending entry', () => {
    const state: AgentToolCallState = { toolCalls: [], batchBase: 0 }
    const next = applyAgentStreamEvent(state, { toolResult: { index: 5, success: true } })
    expect(next).toBe(state)
  })

  it('batches tool-call indices across two detection batches from separate agent turns', () => {
    // Turn 1: two tools detected, both settle.
    let state = applyAgentStreamEvent(EMPTY_AGENT_TOOL_CALL_STATE, {
      toolsDetected: 2,
      toolNames: ['search', 'doc_read_file'],
      toolArguments: [{ query: 'lore' }, { path: 'Knowledge/history.md' }],
    })
    expect(state.batchBase).toBe(0)

    state = applyAgentStreamEvent(state, { toolResult: { index: 0, success: true } })
    state = applyAgentStreamEvent(state, { toolResult: { index: 1, success: true } })

    // Turn 2: a fresh batch of one tool call. Its toolResult index is relative
    // to THIS batch, so batchBase must have advanced to 2.
    state = applyAgentStreamEvent(state, {
      toolsDetected: 1,
      toolNames: ['curl'],
      toolArguments: [{ url: 'https://example.com' }],
    })
    expect(state.batchBase).toBe(2)
    expect(state.toolCalls).toHaveLength(3)

    state = applyAgentStreamEvent(state, { toolResult: { index: 0, success: false, error: 'blocked' } })

    expect(state.toolCalls[2]).toMatchObject({ name: 'curl', success: false, error: 'blocked', pending: false })
    // The earlier two entries from batch 1 are untouched by batch 2's index 0.
    expect(state.toolCalls[0]).toMatchObject({ success: true, pending: false })
    expect(state.toolCalls[1]).toMatchObject({ success: true, pending: false })
  })
})
