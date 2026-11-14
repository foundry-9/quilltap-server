/**
 * @jest-environment node
 *
 * Add Participant hands every arriving seat to the one arrival
 * (`seatArrival`, D4 of the opening spec): a new seat is dressed fresh, a
 * returning seat keeps what it had on unless a new outfit was sent, and a
 * watched join (`narrate: true`) answers with the Green Room's stream.
 * `seatArrival` itself is tested in `__tests__/unit/lib/chat/opening/arrival.test.ts`.
 */

jest.mock('@/lib/logger', () => ({
  logger: (() => { const l: Record<string, unknown> = { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() }; l.child = jest.fn(() => l); return l })(),
}))

const handleAddParticipant = jest.fn()
jest.mock('@/app/api/v1/chats/[id]/helpers', () => ({
  enrichParticipant: jest.fn(async (p: unknown) => p),
  handleAddParticipant: (...args: unknown[]) => handleAddParticipant(...args),
  handleParticipantUpdate: jest.fn(),
  handleRemoveParticipant: jest.fn(),
  resolveParticipantCharacterName: jest.fn(async () => 'Echo'),
}))

jest.mock('@/lib/services/host-notifications/writer', () => ({
  postHostRemoveAnnouncement: jest.fn(),
  postHostJoinScenarioAnnouncement: jest.fn(),
}))

const seatArrival = jest.fn()
jest.mock('@/lib/chat/opening/arrival', () => ({
  seatArrival: (...args: unknown[]) => seatArrival(...args),
}))

const { handleAddParticipantAction } = require('@/app/api/v1/chats/[id]/actions/participants')

const chatId = '33333333-3333-4333-8333-333333333333'
const partA = '11111111-1111-4111-8111-111111111111'
const partB = '22222222-2222-4222-8222-222222222222'
const charA = '44444444-4444-4444-8444-444444444444'
const charB = '55555555-5555-4555-8555-555555555555'
const userId = 'user-1'

const makeRequest = (body: unknown): any => ({ json: async () => body })

function makeRepos(overrides: Record<string, unknown> = {}): any {
  return {
    chats: { updateParticipant: jest.fn(), ...overrides },
    characters: { findById: jest.fn(async (id: string) => ({ id, name: 'Echo' })) },
  }
}

const baseChat = {
  id: chatId,
  projectId: null,
  participants: [{ id: partA, type: 'CHARACTER', characterId: charA, controlledBy: 'llm', status: 'active' }],
}

describe('add-participant → the one arrival', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    seatArrival.mockResolvedValue(undefined)
  })

  it('dresses a new seat fresh, with no outfit chosen (the server rule decides)', async () => {
    handleAddParticipant.mockResolvedValue({
      chat: { ...baseChat, participants: [...baseChat.participants, { id: partB, type: 'CHARACTER', characterId: charB, controlledBy: 'llm', status: 'active' }] },
    })
    const repos = makeRepos()
    const res = await handleAddParticipantAction(makeRequest({ type: 'CHARACTER', characterId: charB }), chatId, baseChat, { user: { id: userId }, repos })

    expect(res.status).toBe(201)
    expect(seatArrival).toHaveBeenCalledTimes(1)
    expect(seatArrival).toHaveBeenCalledWith(repos, chatId,
      { characterId: charB, outfitSelection: undefined, redress: true },
      expect.objectContaining({ source: 'participant-added', userId }))
  })

  it('lets a returning seat keep what it had on when nothing new was sent', async () => {
    const removed = { id: partB, type: 'CHARACTER', characterId: charB, controlledBy: 'llm', status: 'removed' }
    const chat = { ...baseChat, participants: [...baseChat.participants, removed] }
    const updatedChat = { ...chat, participants: [chat.participants[0], { ...removed, status: 'active' }] }
    const repos = makeRepos({ updateParticipant: jest.fn(async () => updatedChat) })

    const res = await handleAddParticipantAction(makeRequest({ type: 'CHARACTER', characterId: charB }), chatId, chat, { user: { id: userId }, repos })

    expect(res.status).toBe(200)
    expect(seatArrival).toHaveBeenCalledWith(repos, chatId,
      expect.objectContaining({ characterId: charB, redress: false }),
      expect.objectContaining({ source: 'participant-added' }))
  })

  it('narrates a watched join as a Green Room stream', async () => {
    handleAddParticipant.mockResolvedValue({
      chat: { ...baseChat, participants: [...baseChat.participants, { id: partB, type: 'CHARACTER', characterId: charB, controlledBy: 'llm', status: 'active' }] },
    })
    seatArrival.mockImplementation(async (_r: unknown, _c: unknown, _s: unknown, opts: { narrator: { log: (m: string) => void } }) => {
      opts.narrator.log('Echo settles on a velvet waistcoat.')
    })
    const res = await handleAddParticipantAction(
      makeRequest({ type: 'CHARACTER', characterId: charB, narrate: true }),
      chatId, baseChat, { user: { id: userId }, repos: makeRepos() },
    )

    expect(res.headers.get('content-type')).toContain('text/event-stream')
    const text = await new Response(res.body).text()
    const frames = text.split('\n\n').filter(Boolean).map((l) => JSON.parse(l.slice(6)))
    expect(frames.map((f) => f.greenRoom.event)).toEqual(['phase', 'status', 'log', 'done'])
    expect(frames[2].greenRoom.message).toBe('Echo settles on a velvet waistcoat.')
  })
})
