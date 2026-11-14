/**
 * The tool slate a Salon turn offers its character (`resolveTurnToolSlate`),
 * with `buildTools` mocked so the test reads only what the slate asks for and
 * how it reads the answer back.
 */

jest.mock('@/lib/logging/create-logger', () => {
  const logger = () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), child: jest.fn() })
  return { createServiceLogger: jest.fn(logger), createLogger: jest.fn(logger) }
})

jest.mock('@/lib/services/chat-message/streaming.service', () => ({
  buildTools: jest.fn(),
  toolNameOf: (tool: { function?: { name?: string }; name?: string }) => tool.function?.name || tool.name,
}))

jest.mock('@/lib/services/chat-message/pseudo-tool.service', () => ({
  ...jest.requireActual('@/lib/services/chat-message/pseudo-tool.service'),
  checkResolvedToolMode: jest.fn(() => 'native'),
  logSimpleJsonToolUsage: jest.fn(),
  logTextBlockToolUsage: jest.fn(),
}))

import { resolveTurnToolSlate, type TurnToolSlateParams } from '@/lib/services/chat-message/turn-tools.service'
import { buildTools } from '@/lib/services/chat-message/streaming.service'
import { checkResolvedToolMode, SIMPLE_JSON_STOP } from '@/lib/services/chat-message/pseudo-tool.service'

const TOOL = { type: 'function', function: { name: 'wardrobe_list' } }

function params(over: Partial<TurnToolSlateParams> = {}): TurnToolSlateParams {
  return {
    repos: {
      chats: { update: jest.fn() },
      projectDocMountLinks: { findByProjectId: jest.fn(async () => [{ id: 'link' }]) },
      characters: { findAllRaw: jest.fn(async () => []) },
    } as never,
    chat: { id: 'chat-1', projectId: 'proj-1', participants: [], disabledTools: ['curl'] } as never,
    userId: 'user-1',
    chatSettings: null,
    character: { id: 'char-1', name: 'Riya' } as never,
    profile: { id: 'prof', provider: 'OPENAI', modelName: 'gpt', allowWebSearch: false } as never,
    imageProfileId: null,
    imageProfile: null,
    compressionEnabled: true,
    offerSubmitFinalResponse: false,
    isMultiCharacter: true,
    ...over,
  }
}

describe('resolveTurnToolSlate', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.mocked(buildTools).mockResolvedValue({
      tools: [TOOL],
      modelSupportsNativeTools: true,
      useNativeWebSearch: false,
      customToolEffects: new Map(),
      pluginToolEffects: new Map(),
    })
  })

  it('asks buildTools for the character\'s slate', async () => {
    await resolveTurnToolSlate(params())
    expect(jest.mocked(buildTools).mock.calls[0][0]).toMatchObject({
      userId: 'user-1',
      projectId: 'proj-1',
      requestFullContext: true,
      isMultiCharacter: true,
      canDressThemselves: true,
      canCreateOutfits: true,
      canManageInventory: true,
      // Linked project stores open the doc tools.
      docToolsMode: 'full',
      // No answerer and not transparent.
      askCarinaEnabled: false,
      customToolContext: expect.objectContaining({ characterId: 'char-1', chatId: 'chat-1' }),
    })
  })

  it('withholds self_inventory from a character not opted into transparency', async () => {
    await resolveTurnToolSlate(params())
    expect(jest.mocked(buildTools).mock.calls[0][0].disabledTools).toEqual(['curl', 'self_inventory'])
  })

  it('a transparent character keeps self_inventory and is offered ask_carina', async () => {
    await resolveTurnToolSlate(params({ character: { id: 'char-1', name: 'Riya', systemTransparency: true } as never }))
    const options = jest.mocked(buildTools).mock.calls[0][0]
    expect(options.disabledTools).toEqual(['curl'])
    expect(options.askCarinaEnabled).toBe(true)
  })

  it('the chat-level custom-tools switch withholds the roster', async () => {
    await resolveTurnToolSlate(params({ chatSettings: { customTools: false } as never }))
    expect(jest.mocked(buildTools).mock.calls[0][0].customToolContext).toBeNull()
  })

  it('an autonomous room without permission builds under a write ceiling', async () => {
    const slate = await resolveTurnToolSlate(params({
      chat: { id: 'chat-1', chatType: 'autonomous', participants: [] } as never,
    }))
    expect(jest.mocked(buildTools).mock.calls[0][0].effectCeiling).toBe('write')
    expect(slate.effectCeiling).toBe('write')
  })

  it('native: the tools travel natively with the native rules', async () => {
    const slate = await resolveTurnToolSlate(params())
    expect(slate.actualTools).toEqual([TOOL])
    expect(slate.useTextBlockTools).toBe(false)
    expect(slate.toolInstructions).toEqual(expect.any(String))
    expect(slate.stopSequences).toBeUndefined()
  })

  it('native: a roleplay character hears the roleplay tool-rules preamble', async () => {
    const slate = await resolveTurnToolSlate(params())
    expect(slate.toolInstructions).toContain('## Using tools')
    expect(slate.toolInstructions).not.toContain('MANDATORY')
  })

  it('native: an assistant character hears the assistant tool-rules preamble', async () => {
    const slate = await resolveTurnToolSlate(
      params({ character: { id: 'char-1', name: 'Riya', kind: 'assistant' } as never }),
    )
    expect(slate.toolInstructions).toContain('## Tool Execution Rules (MANDATORY')
  })

  it.each([true, false])('passes offerSubmitFinalResponse=%s to buildTools as its submit switch', async (offer) => {
    await resolveTurnToolSlate(params({ offerSubmitFinalResponse: offer }))
    expect(jest.mocked(buildTools).mock.calls[0][0]).toMatchObject({ agentModeEnabled: offer })
  })

  it('simple-json: no native tools, its instructions, and its stop sequences', async () => {
    jest.mocked(checkResolvedToolMode).mockReturnValueOnce('simple-json')
    const slate = await resolveTurnToolSlate(params())
    expect(slate.tools).toEqual([TOOL])
    expect(slate.actualTools).toEqual([])
    expect(slate.useTextBlockTools).toBe(true)
    expect(slate.toolInstructions).toEqual(expect.any(String))
    expect(slate.stopSequences).toBe(SIMPLE_JSON_STOP)
  })

  it('the Courier builds nothing', async () => {
    const slate = await resolveTurnToolSlate(params({ profile: { id: 'prof', provider: 'OPENAI', transport: 'courier' } as never }))
    expect(buildTools).not.toHaveBeenCalled()
    expect(slate.tools).toEqual([])
    expect(slate.toolInstructions).toBeUndefined()
  })

  it('spends forceToolsOnNextMessage and reports the change', async () => {
    const p = params({ chat: { id: 'chat-1', participants: [], forceToolsOnNextMessage: true } as never })
    const slate = await resolveTurnToolSlate(p)
    expect(slate.toolSettingsChanged).toBe(true)
    expect((p.repos as unknown as { chats: { update: jest.Mock } }).chats.update)
      .toHaveBeenCalledWith('chat-1', { forceToolsOnNextMessage: false })
  })
})

describe('TurnToolSlate.formatToolsFor (#181)', () => {
  const ANTHROPIC_SHAPE = [{ name: 'wardrobe_list', input_schema: {} }]
  const OPENAI_SHAPE = [
    { type: 'function', function: { name: 'wardrobe_list' } },
    // Present for this provider only (e.g. its own web search); the primary
    // was never offered it, so the stand-in is not either.
    { type: 'function', function: { name: 'search_web' } },
  ]
  const primary = { id: 'prof-anthropic', provider: 'ANTHROPIC', modelName: 'claude', allowWebSearch: false }
  const understudy = { id: 'prof-openai', provider: 'OPENAI', modelName: 'gpt', allowWebSearch: true }

  beforeEach(() => {
    jest.clearAllMocks()
    jest.mocked(buildTools).mockImplementation(async (options) => ({
      tools: options.connectionProfile.provider === 'ANTHROPIC' ? ANTHROPIC_SHAPE : OPENAI_SHAPE,
      modelSupportsNativeTools: true,
      useNativeWebSearch: options.connectionProfile.provider === 'OPENAI',
      customToolEffects: new Map(),
      pluginToolEffects: new Map(),
      offer: { kind: 'all' } as never,
    }))
  })

  it('returns the primary\'s own format, without a rebuild, for the primary', async () => {
    const slate = await resolveTurnToolSlate(params({ profile: primary as never }))
    const format = await slate.formatToolsFor(primary as never)
    expect(format.actualTools).toBe(slate.actualTools)
    expect(jest.mocked(buildTools)).toHaveBeenCalledTimes(1)
  })

  it('rebuilds for a stand-in on another provider with the same options, narrowed to what the primary offered', async () => {
    const slate = await resolveTurnToolSlate(params({ profile: primary as never }))
    const format = await slate.formatToolsFor(understudy as never)

    expect(jest.mocked(buildTools)).toHaveBeenCalledTimes(2)
    const [first, second] = jest.mocked(buildTools).mock.calls.map((c) => c[0])
    const { connectionProfile: _a, ...firstOptions } = first
    const { connectionProfile: secondProfile, ...secondOptions } = second
    expect(secondProfile).toBe(understudy)
    expect(secondOptions).toEqual(firstOptions)

    expect(format.actualTools).toEqual([{ type: 'function', function: { name: 'wardrobe_list' } }])
    expect(format.resolvedToolMode).toBe('native')
    expect(format.useNativeWebSearch).toBe(true)
  })

  it('resolves the stand-in\'s own tool mode', async () => {
    const slate = await resolveTurnToolSlate(params({ profile: primary as never }))
    jest.mocked(checkResolvedToolMode).mockReturnValueOnce('simple-json')
    const format = await slate.formatToolsFor(understudy as never)
    expect(format.resolvedToolMode).toBe('simple-json')
    expect(format.actualTools).toEqual([])
    expect(format.stopSequences).toBe(SIMPLE_JSON_STOP)
  })
})
