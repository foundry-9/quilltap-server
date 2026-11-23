/**
 * Unit tests for `runWardrobeInstructionDesign`
 * (`lib/services/wardrobe-design/wardrobe-design.service.ts`).
 *
 * Checked at construction level with the heavy collaborators mocked: the tool
 * slate for each combination of what was asked for and what is reachable, the
 * read-only tool context (operator surface only with the stores open, effect
 * ceiling `read` always, never a mount pool), the log type, the revision's
 * reuse numbers, and the events enqueued on success, an unreadable or empty
 * answer, failure and abort. The proposal parser and the prompt run unmocked.
 */

import {
  resolveWardrobeDesignReach,
  runWardrobeInstructionDesign,
  wardrobeDesignUsesTools,
  WARDROBE_DESIGN_MAX_AGENT_TURNS,
  type RunWardrobeDesignOptions,
} from '../wardrobe-design.service'

jest.mock('@/lib/services/chat-message/streaming.service', () => ({
  buildTools: jest.fn(),
  encodeErrorEvent: jest.fn((_encoder: unknown, message: string, code: string) =>
    new TextEncoder().encode(`data: ${JSON.stringify({ error: message, code })}\n\n`),
  ),
  encodeReasoningChunk: jest.fn(() => new Uint8Array([4, 5, 6])),
}))
jest.mock('@/lib/services/agent-loop/one-shot-loop', () => ({
  buildOneShotToolInstructions: jest.fn(() => 'TOOL_INSTRUCTIONS'),
  runOneShotToolLoop: jest.fn(),
}))
jest.mock('@/lib/tools/web-capabilities', () => ({
  resolveWebCapabilities: jest.fn(),
}))
jest.mock('@/lib/wardrobe/instruction-design/brief', () => ({
  buildWardrobeDesignBrief: jest.fn(),
}))

import { buildTools } from '@/lib/services/chat-message/streaming.service'
import { buildOneShotToolInstructions, runOneShotToolLoop } from '@/lib/services/agent-loop/one-shot-loop'
import { resolveWebCapabilities } from '@/lib/tools/web-capabilities'
import { buildWardrobeDesignBrief } from '@/lib/wardrobe/instruction-design/brief'

const profile = (over: Record<string, unknown> = {}) =>
  ({ id: 'conn-1', provider: 'anthropic', modelName: 'claude', allowToolUse: true, allowWebSearch: true, ...over }) as never

const REUSABLE = [
  { id: 'item-blazer', title: 'Navy Blazer', types: ['top'] },
  { id: 'item-brogues', title: 'Oxford Brogues', types: ['footwear'] },
]

const ANSWER = JSON.stringify({
  items: [
    { title: 'Pencil Skirt', description: 'Charcoal wool.', imagePrompt: 'charcoal wool pencil skirt', types: ['bottom'], appropriateness: 'business' },
  ],
  outfit: { title: 'Board Meeting', description: 'Severe.', appropriateness: 'business', reuse: [1, 9] },
  notes: 'Built round the blazer already on the rail.',
})

function options(
  input: Partial<RunWardrobeDesignOptions['input']> = {},
  connectionProfile: never = profile(),
): RunWardrobeDesignOptions {
  return {
    repos: {} as never,
    userId: 'user-1',
    connectionProfile,
    apiKey: 'key',
    location: { scope: 'character', origin: { scope: 'character', id: 'char-1', name: 'Mara' } } as never,
    input: { instructions: 'a business outfit', searchStores: true, searchWeb: true, ...input },
  }
}

const makeController = () => ({ enqueue: jest.fn() })
const frames = (controller: { enqueue: jest.Mock }) =>
  controller.enqueue.mock.calls
    .map(([bytes]) => new TextDecoder().decode(bytes as Uint8Array))
    .filter((s) => s.startsWith('data: '))
    .map((s) => JSON.parse(s.slice(6)))

const toolOptions = () => jest.mocked(buildTools).mock.calls[0][0] as unknown as Record<string, unknown>
const loopArgs = () => jest.mocked(runOneShotToolLoop).mock.calls[0][0]

beforeEach(() => {
  jest.clearAllMocks()
  jest.mocked(resolveWebCapabilities).mockResolvedValue({ webSearchConfigured: true, curlConfigured: true })
  jest.mocked(buildWardrobeDesignBrief).mockResolvedValue({ text: 'BRIEF_TEXT', reusable: REUSABLE, parts: ['rail'] } as never)
  jest.mocked(buildTools).mockResolvedValue({
    tools: [{ function: { name: 'search' } }],
    modelSupportsNativeTools: true,
    offer: { kind: 'offered', names: new Set(['search']) },
    customToolEffects: new Map(),
    pluginToolEffects: new Map(),
  } as never)
  jest.mocked(runOneShotToolLoop).mockResolvedValue({
    ok: true,
    answer: ANSWER,
    toolsExecuted: 4,
    usage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 },
  } as never)
})

describe('resolveWardrobeDesignReach', () => {
  it('needs the profile to allow web search and a search provider that is ready', async () => {
    expect(await resolveWardrobeDesignReach({} as never, 'u', profile(), { searchStores: false, searchWeb: true })).toEqual({
      stores: false, webSearch: true, webFetch: true, webWantedButUnavailable: false,
    })
    const noSearch = await resolveWardrobeDesignReach({} as never, 'u', profile({ allowWebSearch: false }), { searchStores: true, searchWeb: true })
    expect(noSearch).toMatchObject({ webSearch: false, webFetch: true, webWantedButUnavailable: false })
  })

  it('offers no web search when the provider is not ready, even on a profile that allows it', async () => {
    jest.mocked(resolveWebCapabilities).mockResolvedValue({ webSearchConfigured: false, curlConfigured: true })
    const reach = await resolveWardrobeDesignReach({} as never, 'u', profile(), { searchStores: false, searchWeb: true })
    expect(reach).toEqual({ stores: false, webSearch: false, webFetch: true, webWantedButUnavailable: false })
  })

  it('reports a wanted web that cannot be had, and never looks when it was not wanted', async () => {
    jest.mocked(resolveWebCapabilities).mockResolvedValue({ webSearchConfigured: false, curlConfigured: false })
    const none = await resolveWardrobeDesignReach({} as never, 'u', profile(), { searchStores: false, searchWeb: true })
    expect(none).toEqual({ stores: false, webSearch: false, webFetch: false, webWantedButUnavailable: true })
    expect(wardrobeDesignUsesTools(none)).toBe(false)

    jest.clearAllMocks()
    const off = await resolveWardrobeDesignReach({} as never, 'u', profile(), { searchStores: true, searchWeb: false })
    expect(off).toEqual({ stores: true, webSearch: false, webFetch: false, webWantedButUnavailable: false })
    expect(resolveWebCapabilities).not.toHaveBeenCalled()
  })
})

describe('runWardrobeInstructionDesign — the slate and the context', () => {
  it('everything on: read-only stores, web search, curl, ceiling read, operator surface', async () => {
    await runWardrobeInstructionDesign(options(), makeController())

    expect(toolOptions()).toMatchObject({
      agentModeEnabled: true,
      canDressThemselves: false,
      canCreateOutfits: false,
      canManageInventory: false,
      docToolsMode: 'read',
      storeSearch: true,
      sqlAccess: true,
      excludeMemorySearch: true,
      includeWorkspaceTools: false,
      askCarinaEnabled: false,
      webSearch: true,
      pluginToolAllowlist: ['curl'],
      effectCeiling: 'read',
    })
    expect(toolOptions()).not.toHaveProperty('imageProfileId')

    const args = loopArgs()
    expect(args.toolContext.operatorSurface).toBe(true)
    expect(args.toolContext.effectCeiling).toBe('read')
    expect(args.toolContext.mountPool).toBeUndefined()
    expect(args.logType).toBe('WARDROBE_INSTRUCTION_DESIGN')
    expect(args.maxAgentTurns).toBe(WARDROBE_DESIGN_MAX_AGENT_TURNS)
    expect(args.statusContext).toEqual({ characterName: 'Aurora', characterId: '' })
    expect(args.systemPrompt).toContain('You are Aurora')
    expect(args.systemPrompt).toContain('TOOL_INSTRUCTIONS')
    expect(args.userMessage).toContain('a business outfit')
    expect(args.userMessage).toContain('BRIEF_TEXT')

    const textBlock = jest.mocked(buildOneShotToolInstructions).mock.calls[0][0].textBlockOptions
    expect(textBlock).toMatchObject({ search: true, webSearch: true, wardrobeCreate: false, wardrobeWear: false })
  })

  it('stores only: no web search, no curl, the ceiling stays read', async () => {
    await runWardrobeInstructionDesign(options({ searchWeb: false }), makeController())
    expect(toolOptions()).toMatchObject({ docToolsMode: 'read', webSearch: false, pluginToolAllowlist: [], effectCeiling: 'read' })
    expect(loopArgs().toolContext.operatorSurface).toBe(true)
  })

  it('web only: the stores stay shut — no doc tools, no search, no SQL, no operator surface', async () => {
    await runWardrobeInstructionDesign(options({ searchStores: false }), makeController())
    expect(toolOptions()).toMatchObject({
      docToolsMode: 'off',
      storeSearch: false,
      sqlAccess: false,
      webSearch: true,
      pluginToolAllowlist: ['curl'],
      effectCeiling: 'read',
    })
    expect(loopArgs().toolContext).not.toHaveProperty('operatorSurface')
    expect(loopArgs().toolContext.effectCeiling).toBe('read')
    expect(loopArgs().systemPrompt).not.toContain('run_sql')
  })

  it('a profile that forbids web search gets none, but may still fetch pages', async () => {
    await runWardrobeInstructionDesign(options({}, profile({ allowWebSearch: false })), makeController())
    expect(toolOptions()).toMatchObject({ webSearch: false, pluginToolAllowlist: ['curl'] })
    expect(loopArgs().systemPrompt).toContain('You have no web search in this run')
  })

  it('nothing to look at: only submit_final_response, and still ceiling read', async () => {
    jest.mocked(resolveWebCapabilities).mockResolvedValue({ webSearchConfigured: false, curlConfigured: false })
    await runWardrobeInstructionDesign(options({ searchStores: false }), makeController())

    expect(toolOptions()).toEqual(expect.objectContaining({ onlyTools: [], agentModeEnabled: true }))
    expect(toolOptions()).not.toHaveProperty('docToolsMode')
    expect(loopArgs().toolContext).not.toHaveProperty('operatorSurface')
    expect(loopArgs().toolContext.effectCeiling).toBe('read')
    expect(loopArgs().systemPrompt).toContain('The web is unavailable in this run')
  })
})

describe('runWardrobeInstructionDesign — the result', () => {
  it('ends with done: the pieces, the outfit, reused pieces by id, and the notes', async () => {
    const controller = makeController()
    await runWardrobeInstructionDesign(options(), controller)

    const done = frames(controller).find((f) => f.done)
    expect(done.proposal.items.map((i: { title: string }) => i.title)).toEqual(['Pencil Skirt'])
    expect(done.proposal.outfit.title).toBe('Board Meeting')
    // 9 names no listed piece and is dropped; 1 is the blazer.
    expect(done.proposal.reuse).toEqual([{ id: 'item-blazer', title: 'Navy Blazer', types: ['top'] }])
    expect(done.proposal.notes).toBe('Built round the blazer already on the rail.')
    expect(done).toMatchObject({ provider: 'anthropic', modelName: 'claude', toolsExecuted: 4 })
    expect(done.reach).toMatchObject({ stores: true, webSearch: true, webFetch: true })
  })

  it('a revision shows the edited design, with reused ids turned back into numbers', async () => {
    await runWardrobeInstructionDesign(
      options({
        revision: 'make the skirt longer',
        priorProposal: {
          items: [{ title: 'Pencil Skirt', description: 'Charcoal.', imagePrompt: 'skirt', types: ['bottom'], appropriateness: '' }],
          outfit: { title: 'Board Meeting', description: '', appropriateness: '' },
          // The brogues are piece 2; the third id has left the rail.
          reuseItemIds: ['item-brogues', 'item-gone'],
        },
      }),
      makeController(),
    )
    const message = loopArgs().userMessage
    expect(message).toContain('Current design:')
    expect(JSON.parse(message.split('Current design:\n')[1].split('\n\nRevision requested:')[0]).outfit.reuse).toEqual([2])
    expect(message).toContain('Revision requested:\nmake the skirt longer')
  })

  it('an answer that is not a proposal is an error, not an empty design', async () => {
    jest.mocked(runOneShotToolLoop).mockResolvedValue({ ok: true, answer: 'A lovely grey cloak.', toolsExecuted: 0, usage: {} } as never)
    const controller = makeController()
    await runWardrobeInstructionDesign(options(), controller)
    expect(frames(controller)).toEqual([expect.objectContaining({ code: 'wardrobe_design_unreadable' })])
  })

  it('a proposal with no pieces is an error', async () => {
    jest.mocked(runOneShotToolLoop).mockResolvedValue({ ok: true, answer: '{"items":[],"outfit":null}', toolsExecuted: 0, usage: {} } as never)
    const controller = makeController()
    await runWardrobeInstructionDesign(options(), controller)
    expect(frames(controller)).toEqual([expect.objectContaining({ code: 'wardrobe_design_empty' })])
  })

  it('a loop that ends without an answer is an error; an abort is silent', async () => {
    jest.mocked(runOneShotToolLoop).mockResolvedValue({ ok: false, detail: 'budget' } as never)
    const failed = makeController()
    await runWardrobeInstructionDesign(options(), failed)
    expect(frames(failed)).toEqual([expect.objectContaining({ code: 'wardrobe_design_failed' })])

    jest.mocked(runOneShotToolLoop).mockResolvedValue({ ok: false, detail: 'aborted' } as never)
    const aborted = makeController()
    await runWardrobeInstructionDesign(options(), aborted)
    expect(aborted.enqueue).not.toHaveBeenCalled()
  })

  it('never throws: a thrown failure becomes an error event, or silence once the client is gone', async () => {
    jest.mocked(buildTools).mockRejectedValue(new Error('provider exploded'))
    const controller = makeController()
    await expect(runWardrobeInstructionDesign(options(), controller)).resolves.toBeUndefined()
    expect(frames(controller)).toEqual([expect.objectContaining({ code: 'wardrobe_design_failed' })])

    const gone = makeController()
    const abort = new AbortController()
    abort.abort()
    await runWardrobeInstructionDesign(options(), gone, abort.signal)
    expect(gone.enqueue).not.toHaveBeenCalled()
  })
})
