/**
 * @jest-environment node
 *
 * Casting (`castChat`, D1/D5 of the opening spec): the quick half of starting a
 * chat. It resolves every default once, creates the row `'pending'` with the
 * operator's outfit choices kept for the opening, applies the Concierge state
 * and the continuation backfill — and calls no model.
 *
 * These cases used to traverse `handleCreate` with nineteen modules mocked
 * (route.concierge-state / route.roleplay-template / route.scenario-seed /
 * route.continuation-autonomous); they now test the module they are about.
 */

jest.mock('@/lib/logger', () => {
  const logger: Record<string, unknown> = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }
  logger.child = () => logger
  return { logger }
})
jest.mock('@/lib/services/dangerous-content/manual-flip', () => ({
  applyConciergeFlip: jest.fn(async () => ({ changed: true })),
}))
jest.mock('@/lib/chat/apply-chat-continuation', () => ({
  applyChatContinuation: jest.fn(async () => {}),
}))
jest.mock('@/lib/chat/scenario-selection', () => {
  class ScenarioRefRefusedError extends Error {}
  return {
    ScenarioRefRefusedError,
    resolveScenarioSelection: jest.fn(async (fields: Record<string, string | undefined>) => ({
      scenarioText: fields.generalScenarioPath
        ? `body of ${fields.generalScenarioPath}`
        : fields.scenarioId
          ? `body of ${fields.scenarioId}`
          : fields.scenario?.trim() || null,
      scenarioSource: null,
      scenarioNotes: null,
    })),
  }
})
jest.mock('@/lib/scenarios/location', () => ({
  resolveScenarioLocation: jest.fn(async (scope: string) => ({
    list: async () => ({
      scenarios: scope === 'general' ? [{ path: 'Scenarios/salon.md', isDefault: true, archived: false }] : [],
    }),
  })),
}))
jest.mock('@/lib/memory/cheap-llm-tasks/outfit-selection', () => ({
  // The Green Room's chooser: a model call. Casting must never reach it.
  chooseLLMOutfit: jest.fn(() => new Promise(() => {})),
}))

import { castChat } from '@/lib/chat/opening/cast'
import { createChatSchema } from '@/lib/chat/opening/schema'
import { applyConciergeFlip } from '@/lib/services/dangerous-content/manual-flip'
import { applyChatContinuation } from '@/lib/chat/apply-chat-continuation'
import { resolveScenarioSelection } from '@/lib/chat/scenario-selection'
import { chooseLLMOutfit } from '@/lib/memory/cheap-llm-tasks/outfit-selection'

const USER = 'user-1'
const ALICE = '11111111-1111-4111-8111-111111111111'
const BOB = '22222222-2222-4222-8222-222222222222'
const PROFILE = '33333333-3333-4333-8333-333333333333'
const TEMPLATE = '44444444-4444-4444-8444-444444444444'
const PROJECT_TEMPLATE = '55555555-5555-4555-8555-555555555555'
const USER_TEMPLATE = '66666666-6666-4666-8666-666666666666'
const PROJECT = '77777777-7777-4777-8777-777777777777'
const SOURCE = '88888888-8888-4888-8888-888888888888'
const NEW_CHAT = 'new-chat'

function makeRepos(opts: {
  concierge?: Record<string, unknown>
  project?: Record<string, unknown> | null
  defaultImageProfile?: Record<string, unknown> | null
} = {}) {
  const created: Record<string, unknown>[] = []
  const characters: Record<string, Record<string, unknown>> = {
    [ALICE]: { id: ALICE, name: 'Alice', tags: ['t1'], canChooseOutfit: true, defaultImageProfileId: 'char-img' },
    [BOB]: { id: BOB, name: 'Bob', tags: ['t2'] },
  }
  const repos = {
    characters: { findById: jest.fn(async (id: string) => characters[id] ?? null) },
    connections: { findById: jest.fn(async (id: string) => (id === PROFILE ? { id } : null)) },
    roleplayTemplates: { findById: jest.fn(async (id: string) => ([TEMPLATE, PROJECT_TEMPLATE, USER_TEMPLATE].includes(id) ? { id } : null)) },
    projects: { findById: jest.fn(async (id: string) => (id === PROJECT ? opts.project ?? { id: PROJECT } : null)) },
    imageProfiles: {
      findDefault: jest.fn(async () =>
        opts.defaultImageProfile === undefined ? { id: 'inst-img', apiKeyId: 'key-1' } : opts.defaultImageProfile),
    },
    chatSettings: {
      findByUserId: jest.fn(async () => ({
        userId: USER,
        defaultRoleplayTemplateId: USER_TEMPLATE,
        conciergeSettings: opts.concierge ?? { enabled: true },
      })),
    },
    chats: {
      findById: jest.fn(async (id: string) => {
        if (id === SOURCE) return { id: SOURCE, participants: [], equippedOutfit: {} }
        return created.find((c) => c.id === id) ?? null
      }),
      create: jest.fn(async (data: Record<string, unknown>) => {
        const row = { id: NEW_CHAT, conciergeMode: null, conciergeModeSetBy: null, conciergeModeReason: null, ...data }
        created.push(row)
        return row
      }),
      setOpeningState: jest.fn(async () => true),
      getEquippedOutfit: jest.fn(async () => ({})),
    },
  }
  return repos
}

const seat = (characterId: string, extra: Record<string, unknown> = {}) => ({
  type: 'CHARACTER' as const, characterId, connectionProfileId: PROFILE, ...extra,
})

async function cast(body: Record<string, unknown>, repos = makeRepos()) {
  const input = createChatSchema.parse({ participants: [seat(ALICE)], ...body })
  const result = await castChat(input, { userId: USER, repos: repos as never })
  return { result, repos, row: repos.chats.create.mock.calls[0]?.[0] as Record<string, unknown> | undefined }
}

beforeEach(() => jest.clearAllMocks())

describe('casting calls no model and leaves the chat to be opened', () => {
  it('returns with the Green Room\'s chooser hanging, and keeps the choice for the opening', async () => {
    const { result, repos } = await cast({ outfitSelections: [{ characterId: ALICE, mode: 'llm_choose' }] })
    expect(result.ok).toBe(true)
    expect(chooseLLMOutfit).not.toHaveBeenCalled()
    expect(repos.chats.setOpeningState).toHaveBeenCalledWith(NEW_CHAT, 'pending', null, {
      outfitSelections: [{ characterId: ALICE, mode: 'llm_choose' }],
      sourceChatId: null,
    })
  })

  it('names the chat from its LLM cast', async () => {
    const { row } = await cast({ participants: [seat(ALICE), seat(BOB)] })
    expect(row?.title).toBe('Chat with Alice and Bob')
  })

  it('refuses a seat that still sends the retired per-seat imageProfileId', () => {
    expect(() => createChatSchema.parse({ participants: [seat(ALICE, { imageProfileId: PROFILE })] })).toThrow()
  })

  it('takes the image profile from the request, then the project, then the character', async () => {
    expect((await cast({ imageProfileId: PROFILE })).row?.imageProfileId).toBe(PROFILE)
    expect((await cast({ projectId: PROJECT }, makeRepos({ project: { id: PROJECT, defaultImageProfileId: 'proj-img' } }))).row?.imageProfileId).toBe('proj-img')
    expect((await cast({})).row?.imageProfileId).toBe('char-img')
  })

  it('falls back to the instance default image profile when nothing nearer names one', async () => {
    const bobOnly = { participants: [seat(BOB)] }
    expect((await cast(bobOnly)).row?.imageProfileId).toBe('inst-img')
    // A default that cannot draw (no API key) is passed over.
    expect((await cast(bobOnly, makeRepos({ defaultImageProfile: { id: 'inst-img', apiKeyId: null } }))).row?.imageProfileId).toBeNull()
    expect((await cast(bobOnly, makeRepos({ defaultImageProfile: null }))).row?.imageProfileId).toBeNull()
  })

  it('honours an explicit null as "No image generation" over every default', async () => {
    expect((await cast({ imageProfileId: null })).row?.imageProfileId).toBeNull()
  })
})

describe('the Concierge at creation', () => {
  it('does nothing when nothing is asked and the default is Moderated', async () => {
    await cast({})
    expect(applyConciergeFlip).not.toHaveBeenCalled()
  })

  it('does nothing for an explicit Moderated', async () => {
    await cast({ conciergeState: 'moderated' })
    expect(applyConciergeFlip).not.toHaveBeenCalled()
  })

  it.each(['unmoderated', 'locked'] as const)('applies %s through the flip chokepoint', async (state) => {
    await cast({ conciergeState: state })
    expect(applyConciergeFlip).toHaveBeenCalledWith(NEW_CHAT, state, expect.objectContaining({ id: NEW_CHAT }))
  })

  it('applies the operator\'s newChatsStartAs when the request names no state', async () => {
    await cast({}, makeRepos({ concierge: { enabled: true, newChatsStartAs: 'unmoderated' } }))
    expect(applyConciergeFlip).toHaveBeenCalledWith(NEW_CHAT, 'unmoderated', expect.anything())
  })

  it('lets an explicit Moderated beat an Unmoderated default', async () => {
    await cast({ conciergeState: 'moderated' }, makeRepos({ concierge: { enabled: true, newChatsStartAs: 'unmoderated' } }))
    expect(applyConciergeFlip).not.toHaveBeenCalled()
  })

  it.each(['unmoderated', 'locked'] as const)('ignores %s while the Concierge is off duty', async (state) => {
    await cast({ conciergeState: state }, makeRepos({ concierge: { enabled: false, newChatsStartAs: 'unmoderated' } }))
    expect(applyConciergeFlip).not.toHaveBeenCalled()
  })

  it('flips before the continuation backfill replays the previous chapter', async () => {
    await cast({ conciergeState: 'unmoderated', continuationFromChatId: SOURCE })
    expect((applyConciergeFlip as jest.Mock).mock.invocationCallOrder[0])
      .toBeLessThan((applyChatContinuation as jest.Mock).mock.invocationCallOrder[0])
  })

  it('rejects a state outside the three', () => {
    expect(() => createChatSchema.parse({ participants: [seat(ALICE)], conciergeState: 'dangerous' })).toThrow()
  })
})

describe('the roleplay template', () => {
  it('falls back to the user default', async () => {
    expect((await cast({})).row?.roleplayTemplateId).toBe(USER_TEMPLATE)
  })
  it('prefers the project default over the user default', async () => {
    const repos = makeRepos({ project: { id: PROJECT, defaultRoleplayTemplateId: PROJECT_TEMPLATE } })
    expect((await cast({ projectId: PROJECT }, repos)).row?.roleplayTemplateId).toBe(PROJECT_TEMPLATE)
  })
  it('honours an explicit choice over both', async () => {
    const repos = makeRepos({ project: { id: PROJECT, defaultRoleplayTemplateId: PROJECT_TEMPLATE } })
    expect((await cast({ projectId: PROJECT, roleplayTemplateId: TEMPLATE }, repos)).row?.roleplayTemplateId).toBe(TEMPLATE)
  })
  it('honours an explicit null as "no template"', async () => {
    expect((await cast({ roleplayTemplateId: null })).row?.roleplayTemplateId).toBeNull()
  })
  it('rejects a template that does not exist', async () => {
    const { result } = await cast({ roleplayTemplateId: '99999999-9999-4999-8999-999999999999' })
    expect(result).toEqual({ ok: false, refusal: { status: 400, message: 'Roleplay template not found' } })
  })
})

describe('the scenario (bug 158: it never becomes the summary)', () => {
  it('stores a chosen scenario in scenarioText and leaves contextSummary null', async () => {
    const { row } = await cast({ scenario: 'A rainy night at the club.' })
    expect(row?.scenarioText).toBe('A rainy night at the club.')
    expect(row?.contextSummary).toBeNull()
  })

  it('applies the default scenario when the request names none', async () => {
    const { row } = await cast({})
    expect(resolveScenarioSelection).toHaveBeenCalledWith(expect.objectContaining({ generalScenarioPath: 'Scenarios/salon.md' }), expect.anything())
    expect(row?.scenarioText).toBe('body of Scenarios/salon.md')
    expect(row?.contextSummary).toBeNull()
  })

  it('treats any scenario key as the whole choice: an empty one means no scenario', async () => {
    const { row } = await cast({ scenario: '' })
    expect(resolveScenarioSelection).toHaveBeenCalledWith(expect.not.objectContaining({ generalScenarioPath: expect.anything() }), expect.anything())
    expect(row?.scenarioText).toBeNull()
  })
})

describe('continuations and autonomous rooms', () => {
  const room = (extra: Record<string, unknown> = {}) => ({
    participants: [seat(ALICE), seat(BOB)], chatType: 'autonomous', ...extra,
  })

  it('accepts a continuation into an autonomous room, and replays the source', async () => {
    const { result, row, repos } = await cast(room({ continuationFromChatId: SOURCE }))
    expect(result.ok).toBe(true)
    expect(row).toMatchObject({ chatType: 'autonomous', avatarGenerationEnabled: false, runState: 'idle' })
    expect(applyChatContinuation).toHaveBeenCalledWith(expect.objectContaining({ newChatId: NEW_CHAT, sourceChatId: SOURCE }))
    expect(repos.chats.setOpeningState).toHaveBeenCalledWith(NEW_CHAT, 'pending', null, expect.objectContaining({ sourceChatId: SOURCE }))
  })

  it('persists budgetExcludeCacheHits=0 when the room counts every token', async () => {
    expect((await cast(room({ budgetExcludeCacheHits: false }))).row?.budgetExcludeCacheHits).toBe(0)
  })

  it('still requires two LLM characters', async () => {
    const { result } = await cast({ participants: [seat(ALICE)], chatType: 'autonomous', continuationFromChatId: SOURCE })
    expect(result).toEqual({ ok: false, refusal: { status: 400, message: 'Autonomous rooms require at least two LLM-controlled characters' } })
  })

  it('refuses a continuation of a chat that is not the operator\'s', async () => {
    const { result } = await cast({ continuationFromChatId: '99999999-9999-4999-8999-999999999999' })
    expect(result).toEqual({ ok: false, refusal: { status: 404, message: 'Source chat not found' } })
  })
})
