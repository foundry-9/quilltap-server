/**
 * Unit tests for the generalized one-shot tool loop (`runOneShotToolLoop`) —
 * the shared engine behind `runBrahmaQuery` and `runScenarioBuilder`.
 *
 * Ported scenarios from `lib/services/brahma-console/__tests__/one-shot.service.test.ts`
 * (basic success, multi-turn tool calls, duplicate-call guard, forced final
 * turn, budget-exhaustion salvage), calling `runOneShotToolLoop` directly with
 * a fake profile/built tools/toolContext instead of via `runBrahmaQuery`. Plus
 * new cases specific to the generalized loop: abort handling (pre-call and
 * between turns), `logType` passthrough, `controller` passthrough, cumulative
 * `onReasoning`, and `toolsExecuted`/`usage` aggregation across turns.
 */

import { runOneShotToolLoop, type BuiltTools } from '../one-shot-loop'

jest.mock('@/lib/services/chat-message/streaming.service', () => ({
  streamMessage: jest.fn(),
}))
jest.mock('@/lib/services/chat-message/tool-execution.service', () => ({
  processToolCalls: jest.fn(),
  detectToolCallsInResponse: jest.fn(),
}))
jest.mock('@/lib/services/chat-message/pseudo-tool.service', () => ({
  buildNativeToolSystemInstructions: jest.fn(() => 'NATIVE'),
  checkShouldUseTextBlockTools: jest.fn(() => false),
  buildTextBlockSystemInstructions: jest.fn(() => 'TEXTBLOCK'),
  parseTextBlocksFromResponse: jest.fn(() => []),
  stripTextBlockMarkersFromResponse: jest.fn((s: string) => s),
}))
jest.mock('@/lib/tools', () => ({
  hasTextBlockMarkers: jest.fn(() => false),
}))
jest.mock('@/lib/services/chat-message/agent-mode-resolver.service', () => ({
  buildAgentModeInstructions: jest.fn(() => 'AGENT'),
  buildForceFinalMessage: jest.fn(() => 'FORCE FINAL'),
  extractSubmitFinalResponseFromText: jest.fn((s: string) => s),
}))
jest.mock('@/lib/services/brahma-console/orchestrator.service', () => ({
  normalizeToolCallSignature: jest.fn(() => 'sig'),
}))

import { streamMessage } from '@/lib/services/chat-message/streaming.service'
import { processToolCalls, detectToolCallsInResponse } from '@/lib/services/chat-message/tool-execution.service'
import { normalizeToolCallSignature } from '@/lib/services/brahma-console/orchestrator.service'

const MOCK_PROFILE = {
  id: 'conn-1',
  provider: 'anthropic',
  modelName: 'claude-haiku',
  apiKeyId: null,
  allowWebSearch: false,
} as never

const MOCK_TOOLS: BuiltTools = {
  tools: [{ function: { name: 'run_sql' } }],
  modelSupportsNativeTools: true,
}

const REPOS = {} as never

function baseOpts(overrides: Partial<Parameters<typeof runOneShotToolLoop>[0]> = {}) {
  return {
    repos: REPOS,
    userId: 'u1',
    chatId: 'c1',
    connectionProfile: MOCK_PROFILE,
    apiKey: 'key',
    systemPrompt: 'SYS',
    userMessage: 'question',
    tools: MOCK_TOOLS,
    toolContext: { chatId: 'c1', userId: 'u1' } as never,
    maxAgentTurns: 25,
    ...overrides,
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  jest.mocked(detectToolCallsInResponse).mockReturnValue([])
  jest.mocked(processToolCalls).mockResolvedValue({ toolMessages: [], generatedImagePaths: [] } as never)
  jest.mocked(normalizeToolCallSignature).mockReturnValue('sig')
  jest.mocked(streamMessage).mockImplementation(async function* () {
    yield { content: 'Tables: foo, bar.' }
    yield { done: true, rawResponse: {} }
  } as never)
})

describe('runOneShotToolLoop — ported scenarios', () => {
  it('returns the accumulated answer when the model replies without tools', async () => {
    const result = await runOneShotToolLoop(baseOpts())
    expect(result).toEqual({
      ok: true,
      answer: 'Tables: foo, bar.',
      toolsExecuted: 0,
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    })
  })

  it('executes tools across multiple turns', async () => {
    jest
      .mocked(streamMessage)
      .mockImplementationOnce(async function* () {
        yield { done: true, rawResponse: { tool: true } }
      } as never)
      .mockImplementationOnce(async function* () {
        yield { content: 'Two tables.' }
        yield { done: true, rawResponse: {} }
      } as never)
    jest
      .mocked(detectToolCallsInResponse)
      .mockReturnValueOnce([{ name: 'run_sql', arguments: { sql: 'select 1' }, callId: 'c1' }] as never)
      .mockReturnValueOnce([] as never)
    jest.mocked(processToolCalls).mockResolvedValue({
      toolMessages: [{ toolName: 'run_sql', success: true, content: 'rows', callId: 'c1' }],
      generatedImagePaths: [],
    } as never)

    const result = await runOneShotToolLoop(baseOpts())

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.answer).toBe('Two tables.')
      expect(result.toolsExecuted).toBe(1)
    }
  })

  it('returns an empty-response failure when the model produces nothing', async () => {
    jest.mocked(streamMessage).mockImplementation(async function* () {
      yield { done: true, rawResponse: {} }
    } as never)
    const result = await runOneShotToolLoop(baseOpts())
    expect(result).toEqual({ ok: false, detail: 'empty response' })
  })

  it('forces a final answer after repeated duplicate tool-call signatures', async () => {
    // Every turn streams the same tool call; normalizeToolCallSignature always
    // returns 'sig', so the loop's duplicate counter climbs each iteration
    // until MAX_DUPLICATE_TOOL_CALLS is exceeded and it forces a final turn
    // (content-only assistant turn + a "you already have this" user nudge,
    // no more tool execution).
    jest.mocked(streamMessage).mockImplementation(async function* () {
      yield { done: true, rawResponse: { tool: true } }
    } as never)
    jest.mocked(detectToolCallsInResponse).mockReturnValue(
      [{ name: 'run_sql', arguments: { sql: 'select 1' }, callId: 'c1' }] as never,
    )
    jest.mocked(processToolCalls).mockResolvedValue({
      toolMessages: [{ toolName: 'run_sql', success: true, content: 'same rows', callId: 'c1' }],
      generatedImagePaths: [],
    } as never)

    const result = await runOneShotToolLoop(baseOpts({ maxAgentTurns: 25 }))

    // The forced-final message never gets a real prose answer from the mock
    // (streamMessage always returns a tool call), so budget-exhaustion salvage
    // kicks in once the turn cap is hit — proving the stuck-loop guard forced
    // things toward completion rather than looping 25 times unchecked.
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.answer).toContain('same rows')
    }
    // processToolCalls stops being invoked once the duplicate guard trips —
    // it should have run far fewer times than maxAgentTurns.
    expect(jest.mocked(processToolCalls).mock.calls.length).toBeLessThan(25)
  })

  it('salvages a partial answer from tool data when the turn budget is exhausted (Bug 47)', async () => {
    jest.mocked(streamMessage).mockImplementation(async function* () {
      yield { done: true, rawResponse: { tool: true } }
    } as never)
    jest.mocked(detectToolCallsInResponse).mockReturnValue(
      [{ name: 'run_sql', arguments: { sql: 'select 1' }, callId: 'c1' }] as never,
    )
    jest.mocked(processToolCalls).mockResolvedValue({
      toolMessages: [{ toolName: 'run_sql', success: true, content: 'rows: 7', callId: 'c1' }],
      generatedImagePaths: [],
    } as never)

    const result = await runOneShotToolLoop(baseOpts({ maxAgentTurns: 2 }))

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.answer).toContain('2-turn budget')
      expect(result.answer).toContain('rows: 7')
    }
  })
})

describe('runOneShotToolLoop — abort handling', () => {
  it('returns {ok:false, detail:"aborted"} without calling streamMessage when the signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()

    const result = await runOneShotToolLoop(baseOpts({ signal: controller.signal }))

    expect(result).toEqual({ ok: false, detail: 'aborted' })
    expect(streamMessage).not.toHaveBeenCalled()
  })

  it('aborts between turns: streamMessage is called only once when abort fires during turn 1 tool execution', async () => {
    const controller = new AbortController()

    // Turn 1 streams a tool call; turn 2 (if it ran) would stream a plain answer.
    jest
      .mocked(streamMessage)
      .mockImplementationOnce(async function* () {
        yield { done: true, rawResponse: { tool: true } }
      } as never)
      .mockImplementationOnce(async function* () {
        yield { content: 'should never be seen' }
        yield { done: true, rawResponse: {} }
      } as never)
    jest.mocked(detectToolCallsInResponse).mockReturnValueOnce(
      [{ name: 'run_sql', arguments: { sql: 'select 1' }, callId: 'c1' }] as never,
    )
    // Abort as a side effect of executing the tool call — simulates the caller
    // cancelling mid-turn (e.g. the user closed the stream).
    jest.mocked(processToolCalls).mockImplementationOnce(async () => {
      controller.abort()
      return { toolMessages: [{ toolName: 'run_sql', success: true, content: 'rows', callId: 'c1' }], generatedImagePaths: [] } as never
    })

    const result = await runOneShotToolLoop(baseOpts({ signal: controller.signal }))

    expect(result).toEqual({ ok: false, detail: 'aborted' })
    expect(streamMessage).toHaveBeenCalledTimes(1)
  })
})

describe('runOneShotToolLoop — logType passthrough', () => {
  it('passes opts.logType through to streamMessage', async () => {
    await runOneShotToolLoop(baseOpts({ logType: 'SCENARIO_BUILDER' as never }))

    const streamArgs = jest.mocked(streamMessage).mock.calls[0][0] as unknown as { logType?: string }
    expect(streamArgs.logType).toBe('SCENARIO_BUILDER')
  })

  it('omits/defaults logType when not provided (streamMessage receives undefined)', async () => {
    await runOneShotToolLoop(baseOpts())

    const streamArgs = jest.mocked(streamMessage).mock.calls[0][0] as unknown as { logType?: string }
    expect(streamArgs.logType).toBeUndefined()
  })
})

describe('runOneShotToolLoop — controller passthrough', () => {
  it('hands the exact provided controller instance to processToolCalls, not an internal sink', async () => {
    const providedController = { enqueue: jest.fn() }

    jest.mocked(streamMessage).mockImplementationOnce(async function* () {
      yield { done: true, rawResponse: { tool: true } }
    } as never).mockImplementationOnce(async function* () {
      yield { content: 'done' }
      yield { done: true, rawResponse: {} }
    } as never)
    jest.mocked(detectToolCallsInResponse).mockReturnValueOnce(
      [{ name: 'run_sql', arguments: { sql: 'select 1' }, callId: 'c1' }] as never,
    ).mockReturnValueOnce([] as never)

    await runOneShotToolLoop(baseOpts({ controller: providedController as never }))

    expect(processToolCalls).toHaveBeenCalledTimes(1)
    const controllerArg = jest.mocked(processToolCalls).mock.calls[0][2]
    expect(controllerArg).toBe(providedController)
  })

  it('uses an internal no-op sink (not undefined) when opts.controller is omitted', async () => {
    jest.mocked(streamMessage).mockImplementationOnce(async function* () {
      yield { done: true, rawResponse: { tool: true } }
    } as never).mockImplementationOnce(async function* () {
      yield { content: 'done' }
      yield { done: true, rawResponse: {} }
    } as never)
    jest.mocked(detectToolCallsInResponse).mockReturnValueOnce(
      [{ name: 'run_sql', arguments: { sql: 'select 1' }, callId: 'c1' }] as never,
    ).mockReturnValueOnce([] as never)

    await runOneShotToolLoop(baseOpts())

    const controllerArg = jest.mocked(processToolCalls).mock.calls[0][2] as { enqueue: (...args: unknown[]) => void }
    expect(controllerArg).toBeDefined()
    expect(typeof controllerArg.enqueue).toBe('function')
    // Calling it must not throw — it's a sink.
    expect(() => controllerArg.enqueue('x')).not.toThrow()
  })
})

describe('runOneShotToolLoop — onReasoning', () => {
  it('invokes onReasoning with the latest cumulative reasoning text per changed chunk, not per raw delta', async () => {
    // Within a single turn, providers send progressively longer cumulative
    // reasoning strings across chunks; the loop calls onReasoning once per
    // *changed* value (source: `if (chunk.reasoningContent !== turnReasoning)`)
    // with that full value — never a concatenation, and never for a repeat.
    jest.mocked(streamMessage).mockImplementationOnce(async function* () {
      yield { reasoningContent: 'Thinking' }
      yield { reasoningContent: 'Thinking about the' }
      yield { reasoningContent: 'Thinking about the' } // repeat — should NOT re-fire
      yield { reasoningContent: 'Thinking about the answer' }
      yield { content: 'Final answer.' }
      yield { done: true, rawResponse: {} }
    } as never)

    const onReasoning = jest.fn()
    const result = await runOneShotToolLoop(baseOpts({ onReasoning }))

    expect(result).toEqual({
      ok: true,
      answer: 'Final answer.',
      toolsExecuted: 0,
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    })
    expect(onReasoning.mock.calls.map((c) => c[0])).toEqual([
      'Thinking',
      'Thinking about the',
      'Thinking about the answer',
    ])
  })

  it('resets reasoning per turn — a second turn does not receive turn 1 reasoning concatenated in', async () => {
    jest
      .mocked(streamMessage)
      .mockImplementationOnce(async function* () {
        yield { reasoningContent: 'Turn one reasoning' }
        yield { done: true, rawResponse: { tool: true } }
      } as never)
      .mockImplementationOnce(async function* () {
        yield { reasoningContent: 'Turn two reasoning' }
        yield { content: 'done' }
        yield { done: true, rawResponse: {} }
      } as never)
    jest.mocked(detectToolCallsInResponse).mockReturnValueOnce(
      [{ name: 'run_sql', arguments: { sql: 'select 1' }, callId: 'c1' }] as never,
    ).mockReturnValueOnce([] as never)
    jest.mocked(processToolCalls).mockResolvedValue({
      toolMessages: [{ toolName: 'run_sql', success: true, content: 'rows', callId: 'c1' }],
      generatedImagePaths: [],
    } as never)

    const onReasoning = jest.fn()
    await runOneShotToolLoop(baseOpts({ onReasoning }))

    expect(onReasoning.mock.calls.map((c) => c[0])).toEqual([
      'Turn one reasoning',
      'Turn two reasoning',
    ])
  })
})

describe('runOneShotToolLoop — toolsExecuted and usage aggregation', () => {
  it('sums toolsExecuted across turns and sums usage across turns (using each turn\'s LAST usage chunk)', async () => {
    jest
      .mocked(streamMessage)
      .mockImplementationOnce(async function* () {
        // Provider repeats usage across chunks — the loop keeps the last one
        // seen for this turn (source: `if (chunk.usage) turnUsage = chunk.usage`).
        yield { done: false, rawResponse: {}, usage: { promptTokens: 100, completionTokens: 1, totalTokens: 101 } }
        yield { done: true, rawResponse: { tool: true }, usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 } }
      } as never)
      .mockImplementationOnce(async function* () {
        yield { content: 'done', usage: { promptTokens: 20, completionTokens: 8, totalTokens: 28 } }
        yield { done: true, rawResponse: {} }
      } as never)
    jest
      .mocked(detectToolCallsInResponse)
      .mockReturnValueOnce([
        { name: 'run_sql', arguments: { sql: 'select 1' }, callId: 'c1' },
        { name: 'run_sql', arguments: { sql: 'select 2' }, callId: 'c2' },
      ] as never)
      .mockReturnValueOnce([] as never)
    jest.mocked(processToolCalls).mockResolvedValue({
      toolMessages: [
        { toolName: 'run_sql', success: true, content: 'rows1', callId: 'c1' },
        { toolName: 'run_sql', success: true, content: 'rows2', callId: 'c2' },
      ],
      generatedImagePaths: [],
    } as never)

    const result = await runOneShotToolLoop(baseOpts())

    expect(result.ok).toBe(true)
    if (result.ok) {
      // toolsExecuted: 2 calls in turn 1, 0 in turn 2 -> 2 total.
      expect(result.toolsExecuted).toBe(2)
      // usage: turn 1's LAST chunk (10/5/15) + turn 2's only chunk (20/8/28)
      // summed across turns.
      expect(result.usage).toEqual({
        promptTokens: 30,
        completionTokens: 13,
        totalTokens: 43,
      })
    }
  })
})
