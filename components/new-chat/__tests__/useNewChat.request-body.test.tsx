/**
 * useNewChat — what the create request carries, and what the form shows.
 *
 * The form shows the server's casting defaults (`?action=casting-defaults`)
 * with the operator's overrides laid over them, and the create request carries
 * the cast plus the overrides alone: absent means "use the default". This
 * suite pins that an untouched form sends nothing but the cast (and the
 * project / continuation / chat type it was opened with), that each override
 * appears only once changed, that the scenario travels as one unit, and that a
 * cast change re-seeds the shown defaults without touching an override.
 *
 * Uses global jest (not @jest/globals) so the bare jest.mock factories hoist.
 */

import { act, renderHook, waitFor } from '@testing-library/react'
import { createQueryWrapper } from '@/__tests__/helpers/renderWithQuery'
import { useNewChat, type UseNewChatOptions } from '../hooks/useNewChat'
import type { Character, SelectedCharacter } from '../types'
import type { CastingDefaults } from '@/lib/chat/opening/defaults'

// --- Stub the ambient app shell the hook reaches for ----------------------

const navigate = jest.fn()
jest.mock('@/components/workspace/useWorkspaceNavigate', () => ({
  useWorkspaceNavigate: () => navigate,
}))

jest.mock('@/hooks/useRealtime', () => ({
  useRealtimeTopic: () => undefined,
}))

jest.mock('@/lib/toast', () => ({
  showSuccessToast: jest.fn(),
  showErrorToast: jest.fn(),
}))

// --- Fixtures --------------------------------------------------------------

const ALICE_ID = '11111111-1111-4111-8111-111111111111'
const BOB_ID = '22222222-2222-4222-8222-222222222222'
const PROFILE_ID = 'profile-1'
const PROJECT_ID = '33333333-3333-4333-8333-333333333333'
const SOURCE_CHAT_ID = '44444444-4444-4444-8444-444444444444'
const NEW_CHAT_ID = 'chat-new'

const ALICE_CHAR: Character = { id: ALICE_ID, name: 'Alice' }
const BOB_CHAR: Character = { id: BOB_ID, name: 'Bob' }

const ALICE: SelectedCharacter = { character: ALICE_CHAR, connectionProfileId: PROFILE_ID, controlledBy: 'llm' }
const BOB: SelectedCharacter = { character: BOB_CHAR, connectionProfileId: PROFILE_ID, controlledBy: 'llm' }

/** The server's defaults: Alice alone opens on the moor; with Bob, in the atrium. */
function defaultsFor(characterIds: string[]): CastingDefaults {
  const both = characterIds.includes(BOB_ID)
  return {
    title: 'Chat with Alice',
    timestampConfig: null,
    imageProfileId: null,
    roleplayTemplateId: both ? 'tpl-duet' : 'tpl-solo',
    avatarGenerationEnabled: null,
    toolDefaults: { disabledTools: [], disabledToolGroups: [] },
    documentEditingMode: false,
    conciergeState: 'moderated',
    scenario: both ? { kind: 'general', path: 'Scenarios/atrium.md' } : { kind: 'general', path: 'Scenarios/moor.md' },
    outfitModes: Object.fromEntries(characterIds.map((id) => [id, 'default'])),
    previousOutfits: null,
  }
}

let fetchStub: jest.Mock

function installFetchStub(): jest.Mock {
  const stub = jest.fn(async (url: string, init?: RequestInit) => {
    const body = (() => {
      if (init?.method === 'POST') return { chat: { id: NEW_CHAT_ID } }
      if (url.includes('action=casting-defaults')) {
        const ids = new URL(url, 'http://x').searchParams.get('characterIds')!.split(',')
        return { defaults: defaultsFor(ids) }
      }
      if (url.startsWith('/api/v1/characters')) return { characters: [ALICE_CHAR, BOB_CHAR] }
      if (url.startsWith('/api/v1/connection-profiles')) return { profiles: [{ id: PROFILE_ID, name: 'P' }] }
      if (url.startsWith('/api/v1/image-profiles')) return { profiles: [] }
      if (url.startsWith('/api/v1/projects')) return { projects: [], scenarios: [] }
      if (url.startsWith('/api/v1/roleplay-templates')) return []
      if (url.startsWith('/api/v1/settings/chat')) return {}
      if (url.startsWith('/api/v1/groups/scenarios')) return { groupScenarios: [] }
      return { scenarios: [] }
    })()
    return {
      ok: true,
      status: init?.method === 'POST' ? 201 : 200,
      statusText: 'OK',
      json: async () => body,
    }
  })
  global.fetch = stub as unknown as typeof fetch
  return stub
}

/** The body of the one POST /api/v1/chats the hook sent. */
function createdBody(): Record<string, unknown> {
  const call = fetchStub.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === 'POST')
  expect(call).toBeDefined()
  return JSON.parse((call![1] as RequestInit).body as string)
}

async function renderLoaded(options: UseNewChatOptions = {}) {
  const { wrapper } = createQueryWrapper()
  const hook = renderHook(() => useNewChat(options), { wrapper })
  await waitFor(() => expect(hook.result.current.loading).toBe(false))
  return hook
}

async function withCast(result: { current: ReturnType<typeof useNewChat> }, cast: SelectedCharacter[]) {
  act(() => {
    result.current.setSelectedCharacters(cast)
  })
  await waitFor(() => expect(result.current.defaults).not.toBeNull())
}

async function submit(result: { current: ReturnType<typeof useNewChat> }) {
  await act(async () => {
    await result.current.handleCreateChat()
  })
  return createdBody()
}

beforeEach(() => {
  jest.clearAllMocks()
  fetchStub = installFetchStub()
})

// --- Absent means default --------------------------------------------------

describe('useNewChat create request — absent means default', () => {
  it('sends only the cast for an untouched form, while showing the server defaults', async () => {
    const { result } = await renderLoaded()
    await withCast(result, [ALICE])

    expect(result.current.state.roleplayTemplateId).toBe('tpl-solo')
    expect(result.current.state.scenarioSelection).toEqual({ kind: 'general', path: 'Scenarios/moor.md' })
    expect(result.current.state.conciergeState).toBe('moderated')

    const body = await submit(result)
    expect(Object.keys(body)).toEqual(['participants'])
    expect(body.participants).toEqual([
      { type: 'CHARACTER', characterId: ALICE_ID, connectionProfileId: PROFILE_ID, controlledBy: 'llm' },
    ])
    expect(navigate).toHaveBeenCalledWith(`/salon/${NEW_CHAT_ID}`)
  })

  it('adds only projectId, continuation and chat type when the dialog was opened with them', async () => {
    const { result } = await renderLoaded({ projectId: PROJECT_ID, continuationFromChatId: SOURCE_CHAT_ID })
    await withCast(result, [ALICE])
    const body = await submit(result)
    expect(Object.keys(body).sort()).toEqual(['continuationFromChatId', 'participants', 'projectId'])

    fetchStub = installFetchStub()
    const auto = await renderLoaded({ initialAutonomous: true })
    await withCast(auto.result, [ALICE, BOB])
    const autoBody = await submit(auto.result)
    expect(Object.keys(autoBody).sort()).toEqual(['chatType', 'participants'])
    expect(autoBody.chatType).toBe('autonomous')
  })

  it('reads the defaults for the cast, the operator\'s seat and the project', async () => {
    const { result } = await renderLoaded({ projectId: PROJECT_ID })
    await withCast(result, [ALICE, { ...BOB, controlledBy: 'user', connectionProfileId: '' }])
    const call = fetchStub.mock.calls.find(([u]) => String(u).includes('action=casting-defaults'))
    const params = new URL(String(call![0]), 'http://x').searchParams
    expect(params.get('characterIds')).toBe(`${ALICE_ID},${BOB_ID}`)
    expect(params.get('userCharacterIds')).toBe(BOB_ID)
    expect(params.get('projectId')).toBe(PROJECT_ID)
    expect(params.get('chatType')).toBe('salon')
  })
})

// --- Each override appears once changed -------------------------------------

describe('useNewChat create request — overrides', () => {
  it.each(['moderated', 'unmoderated', 'locked'] as const)('sends a chosen Concierge state (%s)', async (state) => {
    const { result } = await renderLoaded()
    await withCast(result, [ALICE])
    act(() => result.current.setOverrides((prev) => ({ ...prev, conciergeState: state })))
    const body = await submit(result)
    expect(body.conciergeState).toBe(state)
  })

  it('sends a chosen roleplay template, including an explicit "no template"', async () => {
    const { result } = await renderLoaded()
    await withCast(result, [ALICE])
    act(() => result.current.setOverrides((prev) => ({ ...prev, roleplayTemplateId: null })))
    expect(result.current.state.roleplayTemplateId).toBeNull()
    const body = await submit(result)
    expect(body).toHaveProperty('roleplayTemplateId', null)
  })

  it('sends timestamp, image profile, avatar generation and outfit choices only once changed', async () => {
    const { result } = await renderLoaded()
    await withCast(result, [ALICE])
    act(() =>
      result.current.setOverrides((prev) => ({
        ...prev,
        timestampConfig: { mode: 'NONE' } as never,
        imageProfileId: '55555555-5555-4555-8555-555555555555',
        avatarGenerationEnabled: false,
        outfitSelections: [{ characterId: ALICE_ID, mode: 'none' }],
      })),
    )
    const body = await submit(result)
    expect(body.timestampConfig).toEqual({ mode: 'NONE' })
    expect(body.imageProfileId).toBe('55555555-5555-4555-8555-555555555555')
    expect(body.avatarGenerationEnabled).toBe(false)
    expect(body.outfitSelections).toEqual([{ characterId: ALICE_ID, mode: 'none' }])
  })

  it('sends only the autonomous fields the operator changed', async () => {
    const { result } = await renderLoaded({ initialAutonomous: true })
    await withCast(result, [ALICE, BOB])
    act(() =>
      result.current.setOverrides((prev) => ({ ...prev, autonomous: { budgetMaxTurns: 12, scheduleFreshnessHours: 2 } })),
    )
    const body = await submit(result)
    expect(body.budgetMaxTurns).toBe(12)
    expect(body.scheduleFreshnessWindowMs).toBe(2 * 60 * 60 * 1000)
    for (const key of ['scheduleCron', 'budgetMaxTokens', 'runVisibility', 'runDestructiveToolsAllowed', 'budgetExcludeCacheHits']) {
      expect(body).not.toHaveProperty(key)
    }
  })

  it('sends a continuation\'s carried-over choices as overrides', async () => {
    const { result } = await renderLoaded({
      continuationFromChatId: SOURCE_CHAT_ID,
      initialConciergeState: 'unmoderated',
      initialAvatarGenerationEnabled: true,
    })
    await withCast(result, [ALICE])
    const body = await submit(result)
    expect(body.conciergeState).toBe('unmoderated')
    expect(body.avatarGenerationEnabled).toBe(true)
  })
})

// --- The scenario is one unit ------------------------------------------------

describe('useNewChat create request — the scenario is one unit', () => {
  const SCENARIO_KEYS = ['scenario', 'scenarioRef', 'scenarioId', 'projectScenarioPath', 'groupScenarioPath', 'groupScenarioGroupId', 'generalScenarioPath']

  it('sends no scenario key while the picker is untouched', async () => {
    const { result } = await renderLoaded()
    await withCast(result, [ALICE])
    const body = await submit(result)
    for (const key of SCENARIO_KEYS) expect(body).not.toHaveProperty(key)
  })

  it('sends a picked preset alone, with no notes key', async () => {
    const { result } = await renderLoaded()
    await withCast(result, [ALICE])
    act(() =>
      result.current.setOverrides((prev) => ({
        ...prev,
        scenario: { selection: { kind: 'store', mountPointId: 'mp-9', path: 'Scenarios/borrowed.md', label: 'Bob › Borrowed' }, notes: '' },
      })),
    )
    const body = await submit(result)
    expect(body.scenarioRef).toEqual({ mountPointId: 'mp-9', path: 'Scenarios/borrowed.md' })
    expect(body).not.toHaveProperty('scenario')
    expect(body).not.toHaveProperty('generalScenarioPath')
  })

  it('sends notes with the shown preset beside them', async () => {
    const { result } = await renderLoaded()
    await withCast(result, [ALICE])
    act(() =>
      result.current.setOverrides((prev) => ({
        ...prev,
        scenario: { selection: result.current.state.scenarioSelection, notes: 'And it is raining.' },
      })),
    )
    const body = await submit(result)
    expect(body.generalScenarioPath).toBe('Scenarios/moor.md')
    expect(body.scenario).toBe('And it is raining.')
  })

  it('sends an empty scenario for Custom with no notes — an explicit "no scenario"', async () => {
    const { result } = await renderLoaded()
    await withCast(result, [ALICE])
    act(() => result.current.setOverrides((prev) => ({ ...prev, scenario: { selection: { kind: 'custom' }, notes: '' } })))
    const body = await submit(result)
    expect(body).toHaveProperty('scenario', '')
    for (const key of SCENARIO_KEYS.filter((k) => k !== 'scenario')) expect(body).not.toHaveProperty(key)
  })

  it("drops a character's own scenario when the cast changes, keeping the notes", async () => {
    const { result } = await renderLoaded()
    await withCast(result, [ALICE])
    act(() =>
      result.current.setOverrides((prev) => ({
        ...prev,
        scenario: { selection: { kind: 'character', scenarioId: 'sc-1' }, notes: 'notes' },
      })),
    )
    act(() => result.current.handleCastChanged())
    expect(result.current.overrides.scenario).toEqual({ selection: { kind: 'custom' }, notes: 'notes' })
  })
})

// --- A cast change re-seeds the defaults, never an override -----------------

describe('useNewChat — a cast change', () => {
  it('re-seeds the shown defaults without touching an override', async () => {
    const { result } = await renderLoaded()
    await withCast(result, [ALICE])
    act(() => result.current.setOverrides((prev) => ({ ...prev, conciergeState: 'locked' })))
    expect(result.current.state.roleplayTemplateId).toBe('tpl-solo')

    act(() => result.current.setSelectedCharacters([ALICE, BOB]))
    await waitFor(() => expect(result.current.state.roleplayTemplateId).toBe('tpl-duet'))
    expect(result.current.state.scenarioSelection).toEqual({ kind: 'general', path: 'Scenarios/atrium.md' })
    expect(result.current.state.conciergeState).toBe('locked')
    expect(result.current.overrides).toEqual({ conciergeState: 'locked' })

    const body = await submit(result)
    expect(body).not.toHaveProperty('roleplayTemplateId')
    expect(body.conciergeState).toBe('locked')
  })
})

// --- Subprompts ride on the seat --------------------------------------------

describe('useNewChat create request — subprompts', () => {
  it('omits selectedSubpromptIds when none are ticked', async () => {
    const { result } = await renderLoaded()
    await withCast(result, [ALICE])
    const body = await submit(result)
    const [participant] = body.participants as Array<Record<string, unknown>>
    expect(participant).not.toHaveProperty('selectedSubpromptIds')
  })

  it('sends ticked subprompt ids for an LLM seat, never for a user seat', async () => {
    const { result } = await renderLoaded()
    await withCast(result, [
      { ...ALICE, selectedSubpromptIds: ['terse', 'verse'] },
      { ...BOB, controlledBy: 'user', connectionProfileId: '', selectedSubpromptIds: ['stray'] },
    ])
    const body = await submit(result)
    const participants = body.participants as Array<Record<string, unknown>>
    expect(participants[0].selectedSubpromptIds).toEqual(['terse', 'verse'])
    expect(participants[1]).not.toHaveProperty('selectedSubpromptIds')
  })
})
