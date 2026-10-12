/**
 * Tests for `POST /api/v1/chats/[id]?action=scenario`.
 *
 * Changing the scene mid-conversation has to do three things together —
 * persist the text, recompile every identity stack (the text is baked into
 * them), and have the Host announce the revision. A change that does only some
 * of those leaves the room believing something the models can't see, so the
 * coupling is what these tests pin down.
 */

// Uses global jest (not @jest/globals) for proper SWC mock hoisting

jest.mock('@/lib/logger', () => {
  const logger: Record<string, unknown> = { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() }
  logger.child = jest.fn(() => logger)
  return { logger }
})

jest.mock('@/lib/chat/scenario-selection', () => ({
  ...jest.requireActual('@/lib/chat/scenario-selection'),
  resolveScenarioSelection: jest.fn(),
}))

jest.mock('@/lib/scenarios/location', () => ({
  ...jest.requireActual('@/lib/scenarios/location'),
  lookupScenarioRef: jest.fn(),
}))

jest.mock('@/lib/services/host-notifications/writer', () => ({
  postHostScenarioRevisionAnnouncement: jest.fn().mockResolvedValue(null),
}))

jest.mock('@/lib/services/system-prompt-compiler/compiler', () => ({
  compileAllIdentityStacks: jest.fn().mockResolvedValue(undefined),
}))

const { handleSetScenario, handleGetScenarioSource } = require('@/app/api/v1/chats/[id]/actions/scenario')
const { resolveScenarioSelection, ScenarioRefRefusedError, hashScenarioBody } = require('@/lib/chat/scenario-selection')
const { lookupScenarioRef } = require('@/lib/scenarios/location')
const { postHostScenarioRevisionAnnouncement } = require('@/lib/services/host-notifications/writer')
const { compileAllIdentityStacks } = require('@/lib/services/system-prompt-compiler/compiler')

const CHAT_ID = '3f1c9f4a-1111-4a2b-9c3d-000000000001'
const MOUNT = '3f1c9f4a-1111-4a2b-9c3d-0000000000aa'

/** A resolved recipe, as `resolveScenarioSelection` answers. */
function recipe(scenarioText: string | null, source: { path: string; body: string } | null = null, notes: string | null = null) {
  return {
    scenarioText,
    scenarioSource: source ? { mountPointId: MOUNT, path: source.path, bodySha256: hashScenarioBody(source.body) } : null,
    scenarioNotes: notes,
  }
}

function makeRequest(body: unknown): any {
  return { json: async () => body }
}

function makeChat(overrides: Record<string, unknown> = {}) {
  return {
    id: CHAT_ID,
    projectId: null,
    scenarioText: null,
    participants: [
      { id: 'p1', type: 'CHARACTER', characterId: 'char-1', status: 'active' },
    ],
    ...overrides,
  }
}

describe('chats [id] scenario action', () => {
  let ctx: any

  beforeEach(() => {
    jest.clearAllMocks()
    ctx = {
      user: { id: 'user-1' },
      repos: {
        chats: {
          findById: jest.fn().mockResolvedValue(makeChat()),
          update: jest.fn().mockImplementation(async (_id: string, patch: any) => ({
            ...makeChat(),
            ...patch,
          })),
        },
        characters: {
          findById: jest.fn().mockResolvedValue({ id: 'char-1', scenarios: [] }),
        },
      },
    }
  })

  it('404s when the chat is gone', async () => {
    ctx.repos.chats.findById.mockResolvedValue(null)
    const res = await handleSetScenario(makeRequest({}), CHAT_ID, ctx)
    expect(res.status).toBe(404)
    expect(ctx.repos.chats.update).not.toHaveBeenCalled()
  })

  it('persists, recompiles, and announces when the scene changes', async () => {
    resolveScenarioSelection.mockResolvedValue(
      recipe('A rooftop in the rain.', { path: 'Scenarios/rooftop.md', body: 'A rooftop in the rain.' }),
    )

    const res = await handleSetScenario(
      makeRequest({ generalScenarioPath: 'Scenarios/rooftop.md' }),
      CHAT_ID,
      ctx,
    )

    expect(res.status).toBe(200)
    // The recipe travels together: text, source and notes in one write.
    expect(ctx.repos.chats.update).toHaveBeenCalledWith(CHAT_ID, {
      scenarioText: 'A rooftop in the rain.',
      scenarioSource: {
        mountPointId: MOUNT,
        path: 'Scenarios/rooftop.md',
        bodySha256: hashScenarioBody('A rooftop in the rain.'),
      },
      scenarioNotes: null,
    })
    expect(compileAllIdentityStacks).toHaveBeenCalledTimes(1)
    expect(postHostScenarioRevisionAnnouncement).toHaveBeenCalledWith({
      chatId: CHAT_ID,
      scenarioText: 'A rooftop in the rain.',
    })
  })

  it('does nothing at all when the resolved scene matches the current one', async () => {
    ctx.repos.chats.findById.mockResolvedValue(makeChat({ scenarioText: 'A tavern at dusk.' }))
    resolveScenarioSelection.mockResolvedValue(recipe('A tavern at dusk.'))

    const res = await handleSetScenario(
      makeRequest({ scenario: 'A tavern at dusk.' }),
      CHAT_ID,
      ctx,
    )
    const body = await res.json()

    expect(body.changed).toBe(false)
    expect(ctx.repos.chats.update).not.toHaveBeenCalled()
    expect(compileAllIdentityStacks).not.toHaveBeenCalled()
    expect(postHostScenarioRevisionAnnouncement).not.toHaveBeenCalled()
  })

  it('clears the scene when nothing is chosen and nothing is typed', async () => {
    ctx.repos.chats.findById.mockResolvedValue(makeChat({ scenarioText: 'A tavern at dusk.' }))
    resolveScenarioSelection.mockResolvedValue(recipe(null))

    const res = await handleSetScenario(makeRequest({ scenario: '' }), CHAT_ID, ctx)

    expect(res.status).toBe(200)
    expect(ctx.repos.chats.update).toHaveBeenCalledWith(CHAT_ID, {
      scenarioText: null,
      scenarioSource: null,
      scenarioNotes: null,
    })
    expect(postHostScenarioRevisionAnnouncement).toHaveBeenCalledWith({
      chatId: CHAT_ID,
      scenarioText: null,
    })
  })

  it('still announces when recompiling the identity stacks fails', async () => {
    resolveScenarioSelection.mockResolvedValue(recipe('A rooftop in the rain.'))
    compileAllIdentityStacks.mockRejectedValueOnce(new Error('compiler down'))

    const res = await handleSetScenario(
      makeRequest({ generalScenarioPath: 'Scenarios/rooftop.md' }),
      CHAT_ID,
      ctx,
    )

    expect(res.status).toBe(200)
    expect(postHostScenarioRevisionAnnouncement).toHaveBeenCalled()
  })

  it('finds the character that owns a character scenario before resolving', async () => {
    const scenarioId = '9a7b1c22-2222-4a2b-9c3d-000000000002'
    ctx.repos.chats.findById.mockResolvedValue(
      makeChat({
        participants: [
          { id: 'p1', type: 'CHARACTER', characterId: 'char-1', status: 'active' },
          { id: 'p2', type: 'CHARACTER', characterId: 'char-2', status: 'active' },
        ],
      }),
    )
    ctx.repos.characters.findById.mockImplementation(async (id: string) =>
      id === 'char-2'
        ? { id: 'char-2', scenarios: [{ id: scenarioId, content: 'Her scene.' }] }
        : { id: 'char-1', scenarios: [] },
    )
    resolveScenarioSelection.mockResolvedValue(recipe('Her scene.'))

    await handleSetScenario(makeRequest({ scenarioId }), CHAT_ID, ctx)

    expect(resolveScenarioSelection).toHaveBeenCalledWith(
      expect.objectContaining({ scenarioId }),
      expect.objectContaining({ characterId: 'char-2', userId: 'user-1' }),
    )
  })

  it('skips a character whose vault refuses to open', async () => {
    const scenarioId = '9a7b1c22-2222-4a2b-9c3d-000000000002'
    ctx.repos.characters.findById.mockRejectedValue(new Error('vault unavailable'))
    resolveScenarioSelection.mockResolvedValue(recipe(null))

    const res = await handleSetScenario(makeRequest({ scenarioId }), CHAT_ID, ctx)

    expect(res.status).toBe(200)
    expect(resolveScenarioSelection).toHaveBeenCalledWith(
      expect.objectContaining({ scenarioId }),
      expect.objectContaining({ characterId: null }),
    )
  })

  it('400s on a scenarioRef that names no scenario owner', async () => {
    resolveScenarioSelection.mockRejectedValue(new ScenarioRefRefusedError('That store does not hold scenarios'))

    const res = await handleSetScenario(
      makeRequest({ scenarioRef: { mountPointId: MOUNT, path: 'Scenarios/x.md' } }),
      CHAT_ID,
      ctx,
    )

    expect(res.status).toBe(400)
    expect(ctx.repos.chats.update).not.toHaveBeenCalled()
  })

  it('reloads from source: a revised body is a real change, announced as such', async () => {
    const oldSource = { path: 'Scenarios/rooftop.md', body: 'A rooftop.' }
    ctx.repos.chats.findById.mockResolvedValue(
      makeChat({ ...recipe('A rooftop.\n\nRain.', oldSource, 'Rain.') }),
    )
    resolveScenarioSelection.mockResolvedValue(
      recipe('A rooftop at night.\n\nRain.', { path: 'Scenarios/rooftop.md', body: 'A rooftop at night.' }, 'Rain.'),
    )

    const res = await handleSetScenario(
      makeRequest({ scenarioRef: { mountPointId: MOUNT, path: 'Scenarios/rooftop.md' }, scenario: 'Rain.' }),
      CHAT_ID,
      ctx,
    )

    expect((await res.json()).changed).toBe(true)
    expect(ctx.repos.chats.update).toHaveBeenCalledWith(CHAT_ID, expect.objectContaining({ scenarioNotes: 'Rain.' }))
    expect(postHostScenarioRevisionAnnouncement).toHaveBeenCalled()
  })

  it('records a change of provenance alone without a recompile or an announcement', async () => {
    ctx.repos.chats.findById.mockResolvedValue(makeChat({ scenarioText: 'A tavern at dusk.' }))
    resolveScenarioSelection.mockResolvedValue(
      recipe('A tavern at dusk.', { path: 'Scenarios/tavern.md', body: 'A tavern at dusk.' }),
    )

    const res = await handleSetScenario(makeRequest({ generalScenarioPath: 'Scenarios/tavern.md' }), CHAT_ID, ctx)

    expect((await res.json()).changed).toBe(true)
    expect(ctx.repos.chats.update).toHaveBeenCalled()
    expect(compileAllIdentityStacks).not.toHaveBeenCalled()
    expect(postHostScenarioRevisionAnnouncement).not.toHaveBeenCalled()
  })
})

describe('chats [id] scenario-source action', () => {
  const source = { mountPointId: MOUNT, path: 'Scenarios/rooftop.md', bodySha256: hashScenarioBody('A rooftop.') }
  const location = { scope: 'project', id: 'proj-1', ownerName: 'Blackwood', idForPath: () => null }
  let ctx: any

  beforeEach(() => {
    jest.clearAllMocks()
    ctx = {
      user: { id: 'user-1' },
      repos: {
        chats: {
          findById: jest.fn().mockResolvedValue(makeChat({ scenarioSource: source, scenarioNotes: 'Rain.' })),
        },
      },
    }
  })

  it('answers no source for a chat without one', async () => {
    ctx.repos.chats.findById.mockResolvedValue(makeChat())
    const body = await (await handleGetScenarioSource(CHAT_ID, ctx)).json()
    expect(body).toMatchObject({ source: null, exists: false, changed: false })
    expect(lookupScenarioRef).not.toHaveBeenCalled()
  })

  it('names the owner and reports an unchanged shelf copy', async () => {
    lookupScenarioRef.mockResolvedValue({ status: 'ok', location, scenario: { name: 'The Rooftop', body: 'A rooftop.' } })
    const body = await (await handleGetScenarioSource(CHAT_ID, ctx)).json()
    expect(body).toMatchObject({
      source,
      owner: { scope: 'project', id: 'proj-1', name: 'Blackwood' },
      scenarioName: 'The Rooftop',
      exists: true,
      changed: false,
      notes: 'Rain.',
    })
  })

  it('notices a revised shelf copy', async () => {
    lookupScenarioRef.mockResolvedValue({ status: 'ok', location, scenario: { name: 'The Rooftop', body: 'A rooftop at night.' } })
    const body = await (await handleGetScenarioSource(CHAT_ID, ctx)).json()
    expect(body).toMatchObject({ exists: true, changed: true })
  })

  it('notices a shelf copy that is gone', async () => {
    lookupScenarioRef.mockResolvedValue({ status: 'missing', location, path: source.path })
    const body = await (await handleGetScenarioSource(CHAT_ID, ctx)).json()
    expect(body).toMatchObject({ exists: false, changed: false, owner: { name: 'Blackwood' } })
  })
})
