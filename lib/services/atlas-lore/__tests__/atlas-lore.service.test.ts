/**
 * Unit tests for `runAtlasLoreDraft` (`lib/services/atlas-lore/atlas-lore.service.ts`)
 * and the pure modules under `lib/atlas/lore-draft/`.
 *
 * The service is checked at construction level with the heavy collaborators
 * mocked: the tool slate per `searchStores`, the read-only tool context
 * (operator surface only with the stores open, effect ceiling `read` always),
 * the log type, the target's taken names in the user message, and the events
 * enqueued on success, failure and abort. The parser, the prompt builders and
 * the request schema run unmocked.
 */

import { runAtlasLoreDraft, type RunAtlasLoreDraftOptions } from '../atlas-lore.service'

jest.mock('@/lib/services/chat-message/streaming.service', () => ({
  buildTools: jest.fn(),
  encodeErrorEvent: jest.fn(() => new Uint8Array([1, 2, 3])),
  encodeReasoningChunk: jest.fn(() => new Uint8Array([4, 5, 6])),
}))
jest.mock('@/lib/services/agent-loop/one-shot-loop', () => ({
  buildOneShotToolInstructions: jest.fn(() => 'TOOL_INSTRUCTIONS'),
  runOneShotToolLoop: jest.fn(),
}))
jest.mock('@/lib/services/brahma-console/turn-budget', () => ({
  resolveBrahmaMaxAgentTurns: jest.fn(async () => 12),
}))
jest.mock('@/lib/atlas/location', () => ({
  resolveAtlasLocation: jest.fn(),
}))

import { buildTools, encodeErrorEvent } from '@/lib/services/chat-message/streaming.service'
import { runOneShotToolLoop } from '@/lib/services/agent-loop/one-shot-loop'
import { resolveAtlasLocation } from '@/lib/atlas/location'
import { parseAtlasLoreDraft } from '@/lib/atlas/lore-draft/parse'
import {
  buildAtlasLoreSystemPrompt,
  buildAtlasLoreUserMessage,
  renderAtlasLoreDraft,
} from '@/lib/atlas/lore-draft/prompt'
import { atlasLoreDraftRequestSchema } from '@/lib/atlas/lore-draft/request-schema'

const MOCK_PROFILE = { id: 'conn-1', provider: 'anthropic', modelName: 'claude-haiku', allowToolUse: true } as Record<string, unknown>

const ANSWER = `---
name: The Convertible
aliases:
  - the roadster
  - The Convertible
graphicPrompt: A cream 1930s roadster with chrome running boards.
---

It belongs to Aunt Agatha.
`

function baseOptions(overrides: Partial<RunAtlasLoreDraftOptions['input']> = {}): RunAtlasLoreDraftOptions {
  return {
    repos: {} as never,
    userId: 'user-1',
    connectionProfile: MOCK_PROFILE as never,
    apiKey: 'key',
    input: {
      subject: 'the convertible',
      details: '',
      searchStores: true,
      target: { scope: 'general', id: null },
      ...overrides,
    },
  }
}

const makeController = () => ({ enqueue: jest.fn() })
const decodeFrames = (controller: { enqueue: jest.Mock }) =>
  controller.enqueue.mock.calls
    .map(([bytes]) => new TextDecoder().decode(bytes as Uint8Array))
    .filter((s) => s.startsWith('data: '))
    .map((s) => JSON.parse(s.slice(6)))

beforeEach(() => {
  jest.clearAllMocks()
  jest.mocked(resolveAtlasLocation).mockResolvedValue({
    origin: { scope: 'general', id: null, name: 'Quilltap General' },
    readEntries: jest.fn(async () => [{ name: 'Blackmoor Hall', aliases: ['the Hall'] }]),
  } as never)
  jest.mocked(buildTools).mockResolvedValue({
    tools: [{ function: { name: 'search' } }],
    modelSupportsNativeTools: true,
    offer: new Set(['search']),
    customToolEffects: new Map(),
    pluginToolEffects: new Map(),
  } as never)
  jest.mocked(runOneShotToolLoop).mockResolvedValue({
    ok: true,
    answer: ANSWER,
    toolsExecuted: 3,
    usage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 },
  } as never)
})

describe('runAtlasLoreDraft — the slate and the context', () => {
  test('stores open: read-only doc tools, SQL, no web, effect ceiling read; operator surface', async () => {
    await runAtlasLoreDraft(baseOptions(), makeController())

    const [toolOptions] = jest.mocked(buildTools).mock.calls[0]
    expect(toolOptions.docToolsMode).toBe('read')
    expect(toolOptions.sqlAccess).toBe(true)
    expect(toolOptions.webSearch).toBe(false)
    expect(toolOptions.excludeMemorySearch).toBe(true)
    expect(toolOptions.effectCeiling).toBe('read')
    expect(toolOptions.canManageInventory).toBe(false)

    const loopArgs = jest.mocked(runOneShotToolLoop).mock.calls[0][0]
    expect(loopArgs.toolContext.operatorSurface).toBe(true)
    expect(loopArgs.toolContext.effectCeiling).toBe('read')
    expect(loopArgs.toolContext.mountPool).toBeUndefined()
    expect(loopArgs.logType).toBe('ATLAS_LORE_DRAFT')
    expect(loopArgs.maxAgentTurns).toBe(12)
    expect(loopArgs.systemPrompt).toContain('run_sql')
  })

  test('stores closed: only submit_final_response, no operator surface, still ceiling read', async () => {
    await runAtlasLoreDraft(baseOptions({ searchStores: false }), makeController())

    const [toolOptions] = jest.mocked(buildTools).mock.calls[0]
    expect(toolOptions.onlyTools).toEqual([])
    expect(toolOptions.agentModeEnabled).toBe(true)

    const loopArgs = jest.mocked(runOneShotToolLoop).mock.calls[0][0]
    expect(loopArgs.toolContext).not.toHaveProperty('operatorSurface')
    expect(loopArgs.toolContext.effectCeiling).toBe('read')
    expect(loopArgs.systemPrompt).not.toContain('Reach for the lookup shortcuts')
  })

  test('the user message names the tier and its taken names', async () => {
    await runAtlasLoreDraft(baseOptions(), makeController())
    const loopArgs = jest.mocked(runOneShotToolLoop).mock.calls[0][0]
    expect(loopArgs.userMessage).toContain('Subject: the convertible')
    expect(loopArgs.userMessage).toContain('Quilltap General')
    expect(loopArgs.userMessage).toContain('Blackmoor Hall; the Hall')
  })

  test('an unreadable target does not stop the run', async () => {
    jest.mocked(resolveAtlasLocation).mockRejectedValue(new Error('vault gone'))
    const controller = makeController()
    await runAtlasLoreDraft(baseOptions({ target: { scope: 'project', id: 'p-1' } }), controller)
    const loopArgs = jest.mocked(runOneShotToolLoop).mock.calls[0][0]
    expect(loopArgs.userMessage).toContain('Filed in: a project')
    expect(decodeFrames(controller).at(-1)).toMatchObject({ done: true })
  })
})

describe('runAtlasLoreDraft — outcomes', () => {
  test('success enqueues done with the parsed draft', async () => {
    const controller = makeController()
    await runAtlasLoreDraft(baseOptions(), controller)
    const done = decodeFrames(controller).at(-1)
    expect(done).toMatchObject({
      done: true,
      structured: true,
      draft: {
        name: 'The Convertible',
        aliases: ['the roadster'],
        graphicPrompt: 'A cream 1930s roadster with chrome running boards.',
        knowledge: 'It belongs to Aunt Agatha.',
      },
    })
  })

  test('a failed loop enqueues an error', async () => {
    jest.mocked(runOneShotToolLoop).mockResolvedValue({ ok: false, detail: 'empty response' } as never)
    const controller = makeController()
    await runAtlasLoreDraft(baseOptions(), controller)
    expect(encodeErrorEvent).toHaveBeenCalledWith(expect.anything(), expect.stringContaining('without a draft'), 'atlas_lore_draft_failed', 'empty response')
  })

  test('an aborted loop enqueues nothing', async () => {
    jest.mocked(runOneShotToolLoop).mockResolvedValue({ ok: false, detail: 'aborted' } as never)
    const controller = makeController()
    await runAtlasLoreDraft(baseOptions(), controller)
    expect(controller.enqueue).not.toHaveBeenCalled()
  })

  test('a throw enqueues an error and never rethrows', async () => {
    jest.mocked(runOneShotToolLoop).mockRejectedValue(new Error('provider down'))
    const controller = makeController()
    await expect(runAtlasLoreDraft(baseOptions(), controller)).resolves.toBeUndefined()
    expect(encodeErrorEvent).toHaveBeenCalledWith(expect.anything(), expect.any(String), 'atlas_lore_draft_failed', 'provider down')
  })
})

describe('parseAtlasLoreDraft', () => {
  test('reads frontmatter and body; drops an alias equal to the name', () => {
    const { draft, structured } = parseAtlasLoreDraft(ANSWER, 'x')
    expect(structured).toBe(true)
    expect(draft.aliases).toEqual(['the roadster'])
  })

  test('unwraps a code fence and skips a preamble line', () => {
    const fenced = 'Here you are:\n```markdown\n' + ANSWER.trim() + '\n```'
    const { draft, structured } = parseAtlasLoreDraft(fenced.replace('Here you are:\n', ''), 'x')
    expect(structured).toBe(true)
    expect(draft.name).toBe('The Convertible')
    const preambled = parseAtlasLoreDraft('Here is the entry.\n\n' + ANSWER, 'x')
    expect(preambled.structured).toBe(true)
    expect(preambled.draft.knowledge).toBe('It belongs to Aunt Agatha.')
  })

  test('accepts comma-separated aliases and snake_case graphic prompt', () => {
    const { draft } = parseAtlasLoreDraft('---\nname: Hall\naliases: the pile, the house\ngraphic_prompt: grey stone\n---\nOld.', 'x')
    expect(draft.aliases).toEqual(['the pile', 'the house'])
    expect(draft.graphicPrompt).toBe('grey stone')
  })

  test('no frontmatter: subject as name, whole answer as knowledge', () => {
    const { draft, structured } = parseAtlasLoreDraft('Just some prose about it.', 'the brass contraption')
    expect(structured).toBe(false)
    expect(draft).toEqual({ name: 'the brass contraption', aliases: [], graphicPrompt: null, knowledge: 'Just some prose about it.' })
  })

  test('a frontmatter with no name falls back to the subject; empty body is null', () => {
    const { draft } = parseAtlasLoreDraft('---\ngraphicPrompt: ""\n---\n', 'the Lighthouse')
    expect(draft.name).toBe('the Lighthouse')
    expect(draft.graphicPrompt).toBeNull()
    expect(draft.knowledge).toBeNull()
  })
})

describe('lore-draft prompts', () => {
  test('the system prompt teaches the output shape and research by mode', () => {
    const open = buildAtlasLoreSystemPrompt({ searchStores: true, sqlPrompt: 'SQL!', toolInstructions: 'TOOLS' })
    expect(open).toContain('graphicPrompt:')
    expect(open).toContain('SQL!')
    expect(open).toContain('TOOLS')
    const closed = buildAtlasLoreSystemPrompt({ searchStores: false, sqlPrompt: 'SQL!', toolInstructions: '' })
    expect(closed).not.toContain('SQL!')
    expect(closed).toContain('no tools for this run')
  })

  test('a revision carries the rendered draft and the instruction', () => {
    const message = buildAtlasLoreUserMessage({
      subject: 'Hall',
      details: '',
      targetLabel: 'Quilltap General',
      takenNames: [],
      priorDraft: { name: 'Hall: the old', aliases: ['pile'], graphicPrompt: null, knowledge: 'Old.' },
      revision: 'shorter',
    })
    expect(message).toContain('Details from the operator: (none)')
    expect(message).toContain('name: "Hall: the old"')
    expect(message).toContain('Revision requested:\nshorter')
    expect(message).not.toContain('already used')
  })

  test('a rendered draft parses back to itself', () => {
    const draft = { name: 'Hall: the old', aliases: ['pile', 'the house'], graphicPrompt: 'grey: stone', knowledge: 'Old.\n\n- one' }
    expect(parseAtlasLoreDraft(renderAtlasLoreDraft(draft), 'x').draft).toEqual(draft)
  })
})

describe('atlasLoreDraftRequestSchema', () => {
  const valid = { subject: 'Hall', target: { scope: 'general' } }

  test('defaults searchStores on and details empty', () => {
    const parsed = atlasLoreDraftRequestSchema.parse(valid)
    expect(parsed.searchStores).toBe(true)
    expect(parsed.details).toBe('')
  })

  test('refuses a general target with an id, and another without one', () => {
    expect(atlasLoreDraftRequestSchema.safeParse({ ...valid, target: { scope: 'general', id: '6f9619ff-8b86-4011-b42d-00c04fc964ff' } }).success).toBe(false)
    expect(atlasLoreDraftRequestSchema.safeParse({ ...valid, target: { scope: 'project' } }).success).toBe(false)
  })

  test('priorDraft and revision travel together', () => {
    const priorDraft = { name: 'Hall', aliases: [], graphicPrompt: null, knowledge: null }
    expect(atlasLoreDraftRequestSchema.safeParse({ ...valid, priorDraft }).success).toBe(false)
    expect(atlasLoreDraftRequestSchema.safeParse({ ...valid, priorDraft, revision: 'more' }).success).toBe(true)
  })

  test('refuses unknown keys', () => {
    expect(atlasLoreDraftRequestSchema.safeParse({ ...valid, stray: 1 }).success).toBe(false)
  })
})
