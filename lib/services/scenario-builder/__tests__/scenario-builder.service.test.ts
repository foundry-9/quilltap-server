/**
 * Unit tests for `runScenarioBuilder` (`lib/services/scenario-builder/scenario-builder.service.ts`).
 *
 * Construction-level checks with the heavy collaborators mocked: `buildTools`,
 * `runOneShotToolLoop` / `buildOneShotToolInstructions`, the mount pool
 * resolver, and web-search configuration. Verifies tool-slate gating by mode
 * (real vs. in-world), the tool context shape (mountPool present, no
 * operatorSurface), the log type, the user-message assembly for in-chat and
 * revision inputs, and the SSE-style events enqueued on success, failure, and
 * abort.
 *
 * Also includes direct, unmocked tests of the pure prompt/message builders in
 * `lib/scenario-builder/system-prompt.ts`.
 */

import { runScenarioBuilder, type RunScenarioBuilderOptions } from '../scenario-builder.service'

jest.mock('@/lib/services/chat-message/streaming.service', () => ({
  buildTools: jest.fn(),
  encodeErrorEvent: jest.fn(() => new Uint8Array([1, 2, 3])),
  encodeReasoningChunk: jest.fn(() => new Uint8Array([4, 5, 6])),
}))
jest.mock('@/lib/services/agent-loop/one-shot-loop', () => ({
  buildOneShotToolInstructions: jest.fn(() => 'TOOL_INSTRUCTIONS'),
  runOneShotToolLoop: jest.fn(),
}))
jest.mock('@/lib/tools/handlers/web-search-handler', () => ({
  isWebSearchConfigured: jest.fn(() => false),
}))
jest.mock('@/lib/plugins/tool-registry', () => ({
  toolRegistry: { hasPlugin: jest.fn(() => false) },
}))
jest.mock('@/lib/scenario-builder/mount-pool', () => ({
  resolveScenarioBuilderMountPool: jest.fn(),
}))

import { buildTools, encodeErrorEvent, encodeReasoningChunk } from '@/lib/services/chat-message/streaming.service'
import { buildOneShotToolInstructions, runOneShotToolLoop } from '@/lib/services/agent-loop/one-shot-loop'
import { isWebSearchConfigured } from '@/lib/tools/handlers/web-search-handler'
import { resolveScenarioBuilderMountPool } from '@/lib/scenario-builder/mount-pool'
import {
  buildScenarioBuilderSystemPrompt,
  buildScenarioBuilderUserMessage,
} from '@/lib/scenario-builder/system-prompt'

const FAKE_POOL = {
  participantMountPointIds: ['vault-1'],
  groupMountPointIds: [],
  projectMountPointIds: [],
  globalMountPointId: null,
  characterMountPointId: null,
} as never

const MOCK_PROFILE = {
  id: 'conn-1',
  provider: 'anthropic',
  modelName: 'claude-haiku',
  apiKeyId: null,
  allowWebSearch: false,
} as Record<string, unknown>

const REPOS = {} as never

function baseOptions(overrides: Partial<RunScenarioBuilderOptions['input']> = {}): RunScenarioBuilderOptions {
  return {
    repos: REPOS,
    userId: 'user-1',
    connectionProfile: MOCK_PROFILE as never,
    apiKey: 'key',
    input: {
      mode: 'real',
      location: 'Prague',
      time: 'dusk',
      details: '',
      characterIds: [],
      ...overrides,
    },
  }
}

function makeController() {
  return { enqueue: jest.fn() }
}

beforeEach(() => {
  jest.clearAllMocks()
  jest.mocked(resolveScenarioBuilderMountPool).mockResolvedValue(FAKE_POOL)
  jest.mocked(buildTools).mockResolvedValue({
    tools: [{ function: { name: 'search' } }],
    modelSupportsNativeTools: true,
  } as never)
  jest.mocked(buildOneShotToolInstructions).mockReturnValue('TOOL_INSTRUCTIONS')
  jest.mocked(runOneShotToolLoop).mockResolvedValue({
    ok: true,
    answer: 'A quiet square at dusk.',
    toolsExecuted: 0,
    usage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 },
  } as never)
})

describe('runScenarioBuilder — tool-slate gating', () => {
  test('real mode, allowWebSearch false → webSearch off in buildTools options; prompt says the web is unavailable', async () => {
    jest.mocked(isWebSearchConfigured).mockReturnValue(true)
    const opts = baseOptions()
    opts.connectionProfile = { ...MOCK_PROFILE, allowWebSearch: false } as never
    const controller = makeController()

    await runScenarioBuilder(opts, controller)

    expect(buildTools).toHaveBeenCalledTimes(1)
    const callArgs = jest.mocked(buildTools).mock.calls[0]
    const toolOptions = callArgs[callArgs.length - 1] as {
      documentsOnlySearch: boolean
      webSearch: boolean
      pluginToolAllowlist: string[]
    }
    expect(toolOptions.webSearch).toBe(false)

    const loopArgs = jest.mocked(runOneShotToolLoop).mock.calls[0][0] as { systemPrompt: string }
    expect(loopArgs.systemPrompt).toContain('The web is unavailable')
  })

  test('real mode, allowWebSearch true + isWebSearchConfigured true → webSearch true and pluginToolAllowlist [curl]', async () => {
    jest.mocked(isWebSearchConfigured).mockReturnValue(true)
    const opts = baseOptions()
    opts.connectionProfile = { ...MOCK_PROFILE, allowWebSearch: true } as never
    const controller = makeController()

    await runScenarioBuilder(opts, controller)

    const callArgs = jest.mocked(buildTools).mock.calls[0]
    const toolOptions = callArgs[callArgs.length - 1] as {
      webSearch: boolean
      pluginToolAllowlist: string[]
    }
    expect(toolOptions.webSearch).toBe(true)
    expect(toolOptions.pluginToolAllowlist).toEqual(['curl'])
  })

  test('in-world mode → webSearch always false, pluginToolAllowlist []', async () => {
    jest.mocked(isWebSearchConfigured).mockReturnValue(true)
    const opts = baseOptions({ mode: 'in-world' })
    opts.connectionProfile = { ...MOCK_PROFILE, allowWebSearch: true } as never
    const controller = makeController()

    await runScenarioBuilder(opts, controller)

    const callArgs = jest.mocked(buildTools).mock.calls[0]
    const toolOptions = callArgs[callArgs.length - 1] as {
      webSearch: boolean
      pluginToolAllowlist: string[]
    }
    expect(toolOptions.webSearch).toBe(false)
    expect(toolOptions.pluginToolAllowlist).toEqual([])
  })

  test('docToolsMode passed to buildTools is "read" (positional index 13)', async () => {
    const controller = makeController()
    await runScenarioBuilder(baseOptions(), controller)

    const callArgs = jest.mocked(buildTools).mock.calls[0]
    expect(callArgs[13]).toBe('read')
  })

  test('documentsOnlySearch: true is passed to buildTools options', async () => {
    const controller = makeController()
    await runScenarioBuilder(baseOptions(), controller)

    const callArgs = jest.mocked(buildTools).mock.calls[0]
    const toolOptions = callArgs[callArgs.length - 1] as { documentsOnlySearch: boolean }
    expect(toolOptions.documentsOnlySearch).toBe(true)
  })
})

describe('runScenarioBuilder — tool context and loop invocation', () => {
  test('toolContext has mountPool and no operatorSurface field', async () => {
    const controller = makeController()
    await runScenarioBuilder(baseOptions(), controller)

    const loopArgs = jest.mocked(runOneShotToolLoop).mock.calls[0][0] as unknown as {
      toolContext: Record<string, unknown>
    }
    expect(loopArgs.toolContext.mountPool).toBe(FAKE_POOL)
    expect(loopArgs.toolContext).not.toHaveProperty('operatorSurface')
  })

  test('logType SCENARIO_BUILDER is passed to runOneShotToolLoop', async () => {
    const controller = makeController()
    await runScenarioBuilder(baseOptions(), controller)

    const loopArgs = jest.mocked(runOneShotToolLoop).mock.calls[0][0] as { logType: string }
    expect(loopArgs.logType).toBe('SCENARIO_BUILDER')
  })

  test('userMessage contains Current draft / Revision requested when priorDraft + revision given', async () => {
    const controller = makeController()
    await runScenarioBuilder(
      baseOptions({ priorDraft: 'Once upon a time', revision: 'Make it rain' }),
      controller,
    )

    const loopArgs = jest.mocked(runOneShotToolLoop).mock.calls[0][0] as { userMessage: string }
    expect(loopArgs.userMessage).toContain('Current draft:')
    expect(loopArgs.userMessage).toContain('Revision requested:')
  })

  test('in-chat input surfaces "Current scene (being replaced):" and "Where the conversation stands:"', async () => {
    const controller = makeController()
    await runScenarioBuilder(
      baseOptions({
        chat: { id: 'chat-1', scenarioText: 'An old scene.', contextSummary: 'The plot so far.' },
      }),
      controller,
    )

    const loopArgs = jest.mocked(runOneShotToolLoop).mock.calls[0][0] as { userMessage: string }
    expect(loopArgs.userMessage).toContain('Current scene (being replaced):')
    expect(loopArgs.userMessage).toContain('Where the conversation stands:')
  })
})

describe('runScenarioBuilder — outcome events', () => {
  test('successful loop result enqueues a done event carrying the scenario', async () => {
    jest.mocked(runOneShotToolLoop).mockResolvedValue({
      ok: true,
      answer: '  A quiet square at dusk.  ',
      toolsExecuted: 2,
      usage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 },
    } as never)
    const controller = makeController()

    await runScenarioBuilder(baseOptions(), controller)

    expect(controller.enqueue).toHaveBeenCalledTimes(1)
    const bytes = controller.enqueue.mock.calls[0][0] as Uint8Array
    const text = new TextDecoder().decode(bytes)
    expect(text.startsWith('data: ')).toBe(true)
    const payload = JSON.parse(text.slice('data: '.length).trim())
    expect(payload.done).toBe(true)
    expect(payload.scenario).toBe('A quiet square at dusk.')
  })

  test('failed loop result with detail "empty response" enqueues an error event', async () => {
    jest.mocked(runOneShotToolLoop).mockResolvedValue({ ok: false, detail: 'empty response' } as never)
    const controller = makeController()

    await runScenarioBuilder(baseOptions(), controller)

    expect(encodeErrorEvent).toHaveBeenCalledTimes(1)
    const errorArgs = jest.mocked(encodeErrorEvent).mock.calls[0]
    expect(errorArgs[2]).toBe('scenario_builder_failed')
    expect(errorArgs[3]).toBe('empty response')
    expect(controller.enqueue).toHaveBeenCalledTimes(1)
    expect(controller.enqueue).toHaveBeenCalledWith(jest.mocked(encodeErrorEvent).mock.results[0].value)
  })

  test('failed loop result with detail "aborted" enqueues nothing', async () => {
    jest.mocked(runOneShotToolLoop).mockResolvedValue({ ok: false, detail: 'aborted' } as never)
    const controller = makeController()

    await runScenarioBuilder(baseOptions(), controller)

    expect(encodeErrorEvent).not.toHaveBeenCalled()
    expect(controller.enqueue).not.toHaveBeenCalled()
  })
})

describe('buildScenarioBuilderSystemPrompt / buildScenarioBuilderUserMessage (pure, unmocked)', () => {
  test('details renders as "(none)" when empty/blank', () => {
    const message = buildScenarioBuilderUserMessage({
      mode: 'real',
      location: 'Prague',
      time: 'dusk',
      details: '   ',
    })
    expect(message).toContain('Details: (none)')
  })

  test('in-world mode prompt says the web is not to be used / no web tools', () => {
    const prompt = buildScenarioBuilderSystemPrompt({
      mode: 'in-world',
      webAvailable: false,
      toolInstructions: '',
      now: new Date('2026-09-23T12:00:00Z'),
    })
    expect(prompt).toContain('You have no access to the web.')
    expect(prompt).not.toContain('search_web')
  })

  test('prompt instructs against placeholders like {{char}} / {{user}}', () => {
    const prompt = buildScenarioBuilderSystemPrompt({
      mode: 'real',
      webAvailable: true,
      toolInstructions: '',
      now: new Date('2026-09-23T12:00:00Z'),
    })
    expect(prompt).toContain('{{char}}')
    expect(prompt).toContain('{{user}}')
    expect(prompt).toMatch(/never name, count, or describe the people/i)
  })
})
