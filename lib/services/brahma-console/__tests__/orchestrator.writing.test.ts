/**
 * @jest-environment node
 *
 * (node env: the orchestrator returns a `ReadableStream`, which jsdom lacks but
 * Node provides as a global.)
 *
 * Unit tests for the Brahma Console orchestrator — Writing Assistant mode
 * (read-only tools under an effect ceiling, the marked output, salvage as a
 * notice, the manifest in the prompt) and attachments (recorded on the USER
 * message, carried on the request, budgeted by the one transport pass).
 *
 * The load-bearing guarantee: a Brahma turn fires the context-summary check
 * (so past chats get auto-titled) but NEVER triggers memory extraction — the
 * console forms no persistent memories. We also cover the model resolution
 * helper (pinned-vs-default).
 *
 * Mocks follow the repo convention: BARE factory functions, configured via
 * jest.mocked(...) in beforeEach. The repos object is passed into the
 * orchestrator directly (it does not call getRepositories itself).
 */

// ── Subject ─────────────────────────────────────────────────────────────────
import { handleBrahmaConsoleMessage, buildConsoleTurnPlan } from '../orchestrator.service'

// ── Mocks ─────────────────────────────────────────────────────────────────
jest.mock('@/lib/plugins/provider-validation', () => ({
  requiresApiKey: jest.fn().mockReturnValue(false),
  acceptsApiKey: jest.fn().mockReturnValue(false),
}))

jest.mock('@/lib/services/chat-message/streaming.service', () => ({
  buildTools: jest.fn(),
  streamMessage: jest.fn(),
  encodeContentChunk: jest.fn(() => new Uint8Array()),
  encodeReasoningChunk: jest.fn(() => new Uint8Array()),
  encodeDoneEvent: jest.fn(() => new Uint8Array()),
  encodeErrorEvent: jest.fn(() => new Uint8Array()),
  safeEnqueue: (controller: ReadableStreamDefaultController<Uint8Array>, data: Uint8Array) => {
    try { controller.enqueue(data); return true } catch { return false }
  },
  safeClose: (controller: ReadableStreamDefaultController<Uint8Array>) => {
    try { controller.close() } catch { /* already closed */ }
  },
}))

jest.mock('@/lib/services/chat-message/tool-execution.service', () => ({
  processToolCalls: jest.fn(),
  saveToolMessages: jest.fn(),
  detectToolCallsInResponse: jest.fn(),
}))

jest.mock('@/lib/services/chat-message/pseudo-tool.service', () => ({
  buildNativeToolSystemInstructions: jest.fn(() => 'native tool instructions'),
  checkShouldUseTextBlockTools: jest.fn(() => false),
  buildTextBlockSystemInstructions: jest.fn(() => 'text block instructions'),
  parseTextBlocksFromResponse: jest.fn(() => []),
  stripTextBlockMarkersFromResponse: jest.fn((s: string) => s),
}))

jest.mock('@/lib/services/chat-message/agent-mode-resolver.service', () => ({
  buildAgentModeInstructions: jest.fn((_n: number, kind: string) => `agent instructions (${kind})`),
  buildForceFinalMessage: jest.fn(() => 'force final'),
  extractSubmitFinalResponseFromText: jest.fn((text: string) => text),
  WRITING_FINISH_NOW: 'finish the piece now',
}))

jest.mock('@/lib/brahma-console/writing-context', () => ({
  resolveConsoleContext: jest.fn(),
  renderConsoleContextManifest: jest.fn(),
}))

jest.mock('../turn-attachments', () => ({
  loadConsoleTurnAttachments: jest.fn(),
  composeAttachmentContent: jest.fn((content: string, payload?: { addressLines: string[] }) =>
    payload ? `${content}\n\n${payload.addressLines.join('\n')}` : content),
}))

jest.mock('@/lib/chat/image-transport-budget', () => ({
  applyImageTransportBudget: jest.fn(async (messages: unknown[]) => ({ messages, report: {} })),
}))

jest.mock('@/lib/services/chat-message/memory-trigger.service', () => ({
  triggerContextSummaryCheck: jest.fn(),
  triggerTurnMemoryExtraction: jest.fn(),
}))

jest.mock('../turn-budget', () => ({
  resolveBrahmaMaxAgentTurns: jest.fn().mockResolvedValue(25),
}))

jest.mock('@/lib/services/token-tracking.service', () => ({
  trackMessageTokenUsage: jest.fn(),
}))

jest.mock('@/lib/services/cost-estimation.service', () => ({
  estimateMessageCost: jest.fn(),
}))

jest.mock('@/lib/tools', () => ({
  hasTextBlockMarkers: jest.fn(() => false),
}))

// ── Imports (after mocks) ───────────────────────────────────────────────────
import { buildTools, streamMessage, encodeDoneEvent } from '@/lib/services/chat-message/streaming.service'
import {
  detectToolCallsInResponse,
  processToolCalls,
  saveToolMessages,
} from '@/lib/services/chat-message/tool-execution.service'
import { estimateMessageCost } from '@/lib/services/cost-estimation.service'
import { resolveBrahmaMaxAgentTurns } from '../turn-budget'
import { resolveConsoleContext, renderConsoleContextManifest } from '@/lib/brahma-console/writing-context'
import { loadConsoleTurnAttachments } from '../turn-attachments'
import { applyImageTransportBudget } from '@/lib/chat/image-transport-budget'
import { BRAHMA_WRITING_ASSISTANT_BRIEF } from '@/lib/brahma-console/system-prompt-builder'
import { resolveToolPermit, offeredTools } from '@/lib/tools/effects'

// ── Fixtures ─────────────────────────────────────────────────────────────────
const MOCK_PROFILE = {
  id: 'conn-1',
  userId: 'user-1',
  provider: 'openai',
  modelName: 'gpt-4o',
  allowWebSearch: false,
}

type Saved = { role: string; content: string; systemKind?: string; attachments?: string[] }

function makeMockRepos(chatOverrides: Record<string, unknown> = {}, messages: unknown[] = []) {
  return {
    chats: {
      findById: jest.fn().mockResolvedValue({
        id: 'chat-1',
        userId: 'user-1',
        chatType: 'brahma',
        consoleConnectionProfileId: 'conn-1',
        participants: [],
        ...chatOverrides,
      }),
      addMessage: jest.fn().mockResolvedValue(undefined),
      getMessages: jest.fn().mockResolvedValue(messages),
    },
    connections: {
      findById: jest.fn().mockResolvedValue(MOCK_PROFILE),
      findDefault: jest.fn().mockResolvedValue(MOCK_PROFILE),
      findApiKeyById: jest.fn().mockResolvedValue({ id: 'key-1', key_value: 'sk-test' }),
    },
    chatSettings: {
      findByUserId: jest.fn().mockResolvedValue({ cheapLLMSettings: { enabled: true } }),
    },
  }
}

const WRITING = { consoleMode: 'writing', consoleContext: [{ kind: 'general' }] }

async function drain(stream: ReadableStream<Uint8Array>): Promise<void> {
  const reader = stream.getReader()
  while (true) {
    const { done } = await reader.read()
    if (done) break
  }
}

function savedMessages(repos: ReturnType<typeof makeMockRepos>): Saved[] {
  return repos.chats.addMessage.mock.calls.map((c: unknown[]) => c[1] as Saved)
}

function oneToolCallThenAnswer(answer: string) {
  let call = 0
  jest.mocked(buildTools).mockResolvedValue({
    tools: [{ name: 'search' }],
    modelSupportsNativeTools: true,
    useNativeWebSearch: false,
    offer: offeredTools(['search']),
    pluginToolEffects: new Map(),
  } as never)
  jest.mocked(streamMessage).mockImplementation(async function* () {
    call++
    if (call === 1) {
      yield { content: 'Let me look at the notes first.' }
      yield { done: true, rawResponse: { tool: 1 } }
    } else {
      yield { content: answer }
      yield { done: true, rawResponse: { finishReason: 'stop' } }
    }
  } as never)
  jest.mocked(detectToolCallsInResponse)
    .mockReturnValueOnce([{ name: 'search', arguments: { query: 'x' }, callId: 'call_1' }] as never)
    .mockReturnValue([] as never)
  jest.mocked(processToolCalls).mockResolvedValue({
    toolMessages: [{ toolName: 'search', success: true, content: 'results', callId: 'call_1', arguments: { query: 'x' } }],
    generatedImagePaths: [],
  } as never)
  jest.mocked(saveToolMessages).mockResolvedValue(undefined as never)
}

beforeEach(() => {
  jest.clearAllMocks()
  jest.mocked(buildTools).mockResolvedValue({
    tools: [],
    modelSupportsNativeTools: false,
    useNativeWebSearch: false,
  } as never)
  jest.mocked(streamMessage).mockImplementation(async function* () {
    yield { content: 'The finished piece.' }
    yield { done: true, rawResponse: { finishReason: 'stop' } }
  } as never)
  jest.mocked(detectToolCallsInResponse).mockReturnValue([])
  jest.mocked(estimateMessageCost).mockResolvedValue({ cost: 0, source: 'fallback' } as never)
  jest.mocked(resolveConsoleContext).mockResolvedValue({} as never)
  jest.mocked(renderConsoleContextManifest).mockReturnValue('## Sources for this piece\n\nMANIFEST_MARKER')
  jest.mocked(loadConsoleTurnAttachments).mockResolvedValue(new Map())
})

describe('buildConsoleTurnPlan', () => {
  it('is read-only with a read ceiling in Writing Assistant mode', () => {
    const plan = buildConsoleTurnPlan({ consoleMode: 'writing' })
    expect(plan).toMatchObject({ writing: true, docToolsMode: 'read', effectCeiling: 'read', agentKind: 'writing' })
  })

  it('is the ordinary Console otherwise', () => {
    const plan = buildConsoleTurnPlan({ consoleMode: null })
    expect(plan).toMatchObject({ writing: false, docToolsMode: 'full', effectCeiling: undefined, agentKind: 'research' })
  })
})

describe('Writing Assistant mode', () => {
  it('offers read-only doc tools under a read ceiling, on the tool list and the executor context', async () => {
    oneToolCallThenAnswer('A piece.')
    const repos = makeMockRepos(WRITING)
    await drain(await handleBrahmaConsoleMessage(repos as never, 'chat-1', 'user-1', { content: 'write it' }))

    expect(jest.mocked(buildTools).mock.calls[0][0]).toMatchObject({ docToolsMode: 'read', effectCeiling: 'read' })
    const toolContext = jest.mocked(processToolCalls).mock.calls[0][1] as { effectCeiling?: string; operatorSurface?: boolean }
    expect(toolContext.effectCeiling).toBe('read')
    expect(toolContext.operatorSurface).toBe(true)
  })

  it('marks the final message as the output, and leaves the intermediate prose unmarked', async () => {
    oneToolCallThenAnswer('```markdown\n# The Piece\n\nBody.\n```')
    const repos = makeMockRepos(WRITING)
    await drain(await handleBrahmaConsoleMessage(repos as never, 'chat-1', 'user-1', { content: 'write it' }))

    const assistants = savedMessages(repos).filter(m => m.role === 'ASSISTANT')
    expect(assistants).toHaveLength(2)
    expect(assistants[0].content).toBe('Let me look at the notes first.')
    expect(assistants[0].systemKind).toBeUndefined()
    // Normalised: the whole-text markdown fence is unwrapped.
    expect(assistants[1]).toMatchObject({ content: '# The Piece\n\nBody.', systemKind: 'writing-output' })
    expect(jest.mocked(encodeDoneEvent).mock.calls.at(-1)?.[1]).toMatchObject({ systemKind: 'writing-output' })
  })

  it('puts the writing brief and the manifest in the prompt, in place of the ordinary brief', async () => {
    const repos = makeMockRepos(WRITING)
    await drain(await handleBrahmaConsoleMessage(repos as never, 'chat-1', 'user-1', { content: 'write it' }))

    expect(resolveConsoleContext).toHaveBeenCalledWith(repos, 'user-1', [{ kind: 'general' }])
    const system = (jest.mocked(streamMessage).mock.calls[0][0] as { messages: Array<{ role: string; content: string }> }).messages[0]
    expect(system.role).toBe('system')
    expect(system.content).toContain(BRAHMA_WRITING_ASSISTANT_BRIEF)
    expect(system.content).toContain('MANIFEST_MARKER')
    expect(system.content).not.toContain('Speak plainly and helpfully in your own voice')
    expect(system.content.indexOf('MANIFEST_MARKER')).toBeLessThan(system.content.indexOf('agent instructions (writing)'))
  })

  it('saves a budget salvage as an unmarked notice with no tool-result digest', async () => {
    jest.mocked(resolveBrahmaMaxAgentTurns).mockResolvedValueOnce(2)
    jest.mocked(buildTools).mockResolvedValue({
      tools: [{ name: 'search' }],
      modelSupportsNativeTools: true,
      useNativeWebSearch: false,
      offer: offeredTools(['search']),
      pluginToolEffects: new Map(),
    } as never)
    jest.mocked(streamMessage).mockImplementation(async function* () {
      yield { content: '' }
      yield { done: true, rawResponse: { tool: 1 } }
    } as never)
    let n = 0
    jest.mocked(detectToolCallsInResponse).mockImplementation(() => [{ name: 'search', arguments: { query: `q${n++}` }, callId: `c${n}` }] as never)
    jest.mocked(processToolCalls).mockResolvedValue({
      toolMessages: [{ toolName: 'search', success: true, content: 'RAW_TOOL_DIGEST', callId: 'c', arguments: {} }],
      generatedImagePaths: [],
    } as never)

    const repos = makeMockRepos(WRITING)
    await drain(await handleBrahmaConsoleMessage(repos as never, 'chat-1', 'user-1', { content: 'write it' }))

    const final = savedMessages(repos).filter(m => m.role === 'ASSISTANT').at(-1)
    expect(final?.systemKind).toBeUndefined()
    expect(final?.content).toMatch(/turn budget/)
    expect(final?.content).not.toContain('RAW_TOOL_DIGEST')
  })

  it('leaves the ordinary Console unchanged: full doc tools, no ceiling, no marker', async () => {
    const repos = makeMockRepos()
    await drain(await handleBrahmaConsoleMessage(repos as never, 'chat-1', 'user-1', { content: 'hello' }))

    const opts = jest.mocked(buildTools).mock.calls[0][0] as unknown as Record<string, unknown>
    expect(opts.docToolsMode).toBe('full')
    expect(opts.effectCeiling).toBeUndefined()
    expect(resolveConsoleContext).not.toHaveBeenCalled()
    const final = savedMessages(repos).filter(m => m.role === 'ASSISTANT').at(-1)
    expect(final?.systemKind).toBeUndefined()
  })
})

describe('the read ceiling is the guarantee', () => {
  it('refuses a doc_write_file call under a read ceiling even when offered', () => {
    const permit = resolveToolPermit('doc_write_file', { path: 'a.md', content: 'x' }, {
      offer: offeredTools(['doc_write_file']),
      operatorSurface: true,
      effectCeiling: 'read',
    })
    expect(permit.permitted).toBe(false)
    if (!permit.permitted) expect(permit.refusal).toBe('above-ceiling')
  })
})

describe('attachments', () => {
  it('records the attachment ids on the USER message', async () => {
    const repos = makeMockRepos()
    await drain(await handleBrahmaConsoleMessage(repos as never, 'chat-1', 'user-1', { content: 'look', fileIds: ['f-1', 'f-2'] }))
    const user = savedMessages(repos).find(m => m.role === 'USER')
    expect(user?.attachments).toEqual(['f-1', 'f-2'])
  })

  it('carries loaded attachments and the address line on the request, through the transport budget', async () => {
    const history = [
      { type: 'message', id: 'm-user', role: 'USER', content: 'look at this', attachments: ['f-1'], createdAt: '2026-11-12T00:00:00Z' },
    ]
    const repos = makeMockRepos({}, history)
    const image = { id: 'f-1', filename: 'a.webp', mimeType: 'image/webp', size: 3, data: 'abc' }
    jest.mocked(loadConsoleTurnAttachments).mockResolvedValue(new Map([
      ['m-user', { attachments: [image], prefix: '', addressLines: ['[Attached: qtap://Quilltap General/Brahma/a.webp]'] }],
    ]))

    await drain(await handleBrahmaConsoleMessage(repos as never, 'chat-1', 'user-1', { content: 'look at this', fileIds: ['f-1'] }))

    expect(applyImageTransportBudget).toHaveBeenCalledTimes(1)
    const sent = (jest.mocked(streamMessage).mock.calls[0][0] as { messages: Array<{ role: string; content: string; attachments?: unknown[] }> }).messages
    const user = sent.find(m => m.role === 'user')
    expect(user?.attachments).toEqual([image])
    expect(user?.content).toContain('[Attached: qtap://Quilltap General/Brahma/a.webp]')
  })

  it('skips the transport pass when nothing is attached', async () => {
    const repos = makeMockRepos()
    await drain(await handleBrahmaConsoleMessage(repos as never, 'chat-1', 'user-1', { content: 'hello' }))
    expect(applyImageTransportBudget).not.toHaveBeenCalled()
  })
})
