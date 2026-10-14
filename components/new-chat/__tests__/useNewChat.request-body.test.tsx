/**
 * useNewChat — what the create request actually carries.
 *
 * The New Chat form gained a Concierge picker whose default (Moderated) is
 * deliberately *omitted* from `POST /api/v1/chats`, so a plain create stays
 * byte-identical to what it has always been. This suite pins that: absent on
 * Moderated, present verbatim on the other two.
 *
 * `jest.setup.ts` leaves `global.fetch` as a bare stub with no `ok`, so this
 * suite installs its own reference-data responder.
 *
 * Uses global jest (not @jest/globals) so the bare jest.mock factories hoist.
 */

import { act, renderHook, waitFor } from '@testing-library/react'
import { useNewChat } from '../hooks/useNewChat'
import type { SelectedCharacter } from '../types'
import type { ConciergeState } from '@/lib/services/dangerous-content/chat-override'

// --- Stub the ambient app shell the hook reaches for ----------------------

const navigate = jest.fn()
jest.mock('@/components/workspace/useWorkspaceNavigate', () => ({
  useWorkspaceNavigate: () => navigate,
}))

jest.mock('@/components/providers/creation-progress-provider', () => ({
  useCreationProgress: () => null,
}))

jest.mock('@/lib/toast', () => ({
  showSuccessToast: jest.fn(),
  showErrorToast: jest.fn(),
}))

// --- Fixtures --------------------------------------------------------------

const CHAR_ID = 'char-alice'
const PROFILE_ID = 'profile-1'
const NEW_CHAT_ID = 'chat-new'

const ALICE: SelectedCharacter = {
  character: { id: CHAR_ID, name: 'Alice' },
  connectionProfileId: PROFILE_ID,
  controlledBy: 'llm',
}

/**
 * Answer every reference-data GET with an empty-but-valid payload, and the one
 * create POST with a chat id. Every list the hook reads is keyed off a
 * different property name, so one object satisfies them all.
 */
function installFetchStub(): jest.Mock {
  const stub = jest.fn(async (_url: string, init?: RequestInit) => ({
    ok: true,
    status: init?.method === 'POST' ? 201 : 200,
    json: async () => ({
      chat: { id: NEW_CHAT_ID },
      characters: [],
      profiles: [],
      projects: [],
      scenarios: [],
      templates: [],
    }),
  }))
  global.fetch = stub as unknown as typeof fetch
  return stub
}

let fetchStub: jest.Mock

/** The body of the one POST /api/v1/chats the hook sent. */
function createdBody(): Record<string, unknown> {
  const call = fetchStub.mock.calls.find(
    ([, init]) => (init as RequestInit | undefined)?.method === 'POST'
  )
  expect(call).toBeDefined()
  return JSON.parse((call![1] as RequestInit).body as string)
}

async function createWith(conciergeState: ConciergeState) {
  const { result } = renderHook(() => useNewChat())
  await waitFor(() => expect(result.current.loading).toBe(false))

  act(() => {
    result.current.setSelectedCharacters([ALICE])
    result.current.setState((prev) => ({ ...prev, conciergeState }))
  })

  await act(async () => {
    await result.current.handleCreateChat()
  })

  return createdBody()
}

// --- Tests -----------------------------------------------------------------

describe('useNewChat create request — Concierge state', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    fetchStub = installFetchStub()
  })

  it('defaults to Moderated on the form', async () => {
    const { result } = renderHook(() => useNewChat())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.state.conciergeState).toBe('moderated')
  })

  it('omits conciergeState entirely when Moderated', async () => {
    const body = await createWith('moderated')
    expect(body).not.toHaveProperty('conciergeState')
    // The rest of the request is unchanged — the participant still rides along.
    expect(body.participants).toHaveLength(1)
  })

  it.each(['unmoderated', 'locked'] as const)(
    'sends conciergeState verbatim when %s',
    async (state) => {
      const body = await createWith(state)
      expect(body.conciergeState).toBe(state)
    }
  )
})

describe('useNewChat create request — subprompts', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    fetchStub = installFetchStub()
  })

  async function createWithCast(cast: SelectedCharacter[]) {
    const { result } = renderHook(() => useNewChat())
    await waitFor(() => expect(result.current.loading).toBe(false))
    act(() => {
      result.current.setSelectedCharacters(cast)
    })
    await act(async () => {
      await result.current.handleCreateChat()
    })
    return createdBody()
  }

  it('omits selectedSubpromptIds when none are ticked, so a plain create is unchanged', async () => {
    const body = await createWithCast([ALICE])
    const [participant] = body.participants as Array<Record<string, unknown>>
    expect(participant).not.toHaveProperty('selectedSubpromptIds')
  })

  it('sends the ticked subprompt ids verbatim for an LLM seat', async () => {
    const body = await createWithCast([{ ...ALICE, selectedSubpromptIds: ['terse', 'verse'] }])
    const [participant] = body.participants as Array<Record<string, unknown>>
    expect(participant.selectedSubpromptIds).toEqual(['terse', 'verse'])
  })

  it('never sends subprompts for a user-controlled seat', async () => {
    const body = await createWithCast([
      { ...ALICE, selectedSubpromptIds: ['terse'] },
      {
        character: { id: 'char-bob', name: 'Bob' },
        connectionProfileId: '',
        controlledBy: 'user',
        selectedSubpromptIds: ['stray'],
      },
    ])
    const participants = body.participants as Array<Record<string, unknown>>
    expect(participants[0].selectedSubpromptIds).toEqual(['terse'])
    expect(participants[1]).not.toHaveProperty('selectedSubpromptIds')
  })
})

describe('useNewChat create request — scenario', () => {
  const PROJECT_ID = 'proj-1'
  const PROJECT_DEFAULT = {
    path: 'Scenarios/atrium.md',
    filename: 'atrium.md',
    name: 'The Atrium',
    isDefault: true,
    body: 'Glass overhead.',
  }
  const GENERAL_DEFAULT = {
    path: 'Scenarios/moor.md',
    filename: 'moor.md',
    name: 'The Moor',
    isDefault: true,
    body: 'Fog at dawn.',
  }
  const STUDY = { id: 'sc-study', title: 'Her Study', content: 'Books to the ceiling.' }
  const ALICE_WITH_DEFAULT: SelectedCharacter = {
    ...ALICE,
    character: { ...ALICE.character, scenarios: [STUDY], defaultScenarioId: STUDY.id },
  }

  /** Like installFetchStub, but each scenario tier answers with its own default. */
  function installScenarioStub(): jest.Mock {
    const stub = jest.fn(async (url: string, init?: RequestInit) => {
      const body = (() => {
        if (init?.method === 'POST') return { chat: { id: NEW_CHAT_ID } }
        if (url.startsWith(`/api/v1/projects/${PROJECT_ID}/scenarios`)) return { scenarios: [PROJECT_DEFAULT] }
        if (url.startsWith(`/api/v1/projects/${PROJECT_ID}`)) return { project: { id: PROJECT_ID, name: 'Glasshouse' } }
        if (url.startsWith('/api/v1/scenarios')) return { scenarios: [GENERAL_DEFAULT] }
        return { characters: [], profiles: [], projects: [], scenarios: [], templates: [], groupScenarios: [] }
      })()
      return { ok: true, status: init?.method === 'POST' ? 201 : 200, json: async () => body }
    })
    global.fetch = stub as unknown as typeof fetch
    return stub
  }

  beforeEach(() => {
    jest.clearAllMocks()
    fetchStub = installScenarioStub()
  })

  async function renderLoaded(projectId?: string) {
    const hook = renderHook(() => useNewChat(projectId ? { projectId } : {}))
    await waitFor(() => expect(hook.result.current.loading).toBe(false))
    return hook
  }

  async function submit(result: { current: ReturnType<typeof useNewChat> }) {
    await act(async () => {
      await result.current.handleCreateChat()
    })
    return createdBody()
  }

  it("shows and sends the character's default over the project's (regression: display and submit agreed to differ)", async () => {
    const { result } = await renderLoaded(PROJECT_ID)
    act(() => {
      result.current.setSelectedCharacters([ALICE_WITH_DEFAULT])
    })

    await waitFor(() =>
      expect(result.current.state.scenarioSelection).toEqual({ kind: 'character', scenarioId: STUDY.id }),
    )

    const body = await submit(result)
    expect(body.scenarioId).toBe(STUDY.id)
    expect(body).not.toHaveProperty('projectScenarioPath')
    expect(body).not.toHaveProperty('generalScenarioPath')
    expect(body).not.toHaveProperty('scenarioRef')
  })

  it('falls to the project default when the character has none', async () => {
    const { result } = await renderLoaded(PROJECT_ID)
    act(() => {
      result.current.setSelectedCharacters([ALICE])
    })
    await waitFor(() =>
      expect(result.current.state.scenarioSelection).toEqual({ kind: 'project', path: PROJECT_DEFAULT.path }),
    )

    const body = await submit(result)
    expect(body.projectScenarioPath).toBe(PROJECT_DEFAULT.path)
    expect(body).not.toHaveProperty('scenarioId')
    expect(body).not.toHaveProperty('generalScenarioPath')
  })

  it('falls to the general default with no project', async () => {
    const { result } = await renderLoaded()
    act(() => {
      result.current.setSelectedCharacters([ALICE])
    })
    await waitFor(() =>
      expect(result.current.state.scenarioSelection).toEqual({ kind: 'general', path: GENERAL_DEFAULT.path }),
    )

    const body = await submit(result)
    expect(body.generalScenarioPath).toBe(GENERAL_DEFAULT.path)
  })

  it('never re-seeds a selection the user picked by hand', async () => {
    const { result } = await renderLoaded(PROJECT_ID)
    act(() => {
      result.current.setState((prev) => ({
        ...prev,
        scenarioSelection: { kind: 'custom' },
        scenarioTouched: true,
        scenario: 'My own scene.',
      }))
    })
    // A cast change brings a character default along; the hand pick stands.
    act(() => {
      result.current.setSelectedCharacters([ALICE_WITH_DEFAULT])
    })
    await waitFor(() => expect(result.current.selectedCharacters).toHaveLength(1))
    expect(result.current.state.scenarioSelection).toEqual({ kind: 'custom' })

    const body = await submit(result)
    expect(body.scenario).toBe('My own scene.')
    for (const key of ['scenarioId', 'projectScenarioPath', 'generalScenarioPath', 'groupScenarioPath', 'scenarioRef']) {
      expect(body).not.toHaveProperty(key)
    }
  })

  it('sends a store pick as a scenarioRef, with the notes beside it', async () => {
    const { result } = await renderLoaded()
    act(() => {
      result.current.setSelectedCharacters([ALICE])
      result.current.setState((prev) => ({
        ...prev,
        scenarioSelection: { kind: 'store', mountPointId: 'mp-9', path: 'Scenarios/borrowed.md', label: 'Bob › Borrowed' },
        scenarioTouched: true,
        scenario: 'And it is raining.',
      }))
    })

    const body = await submit(result)
    expect(body.scenarioRef).toEqual({ mountPointId: 'mp-9', path: 'Scenarios/borrowed.md' })
    expect(body.scenario).toBe('And it is raining.')
    expect(body).not.toHaveProperty('generalScenarioPath')
  })
})
