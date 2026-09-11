/**
 * `POST /api/v1/chats/[id]?action=impersonation-voice-preview`
 *
 * The load-bearing guarantee is that the impersonation is re-derived from the
 * chat row: a client claiming to drive a seat it is not driving gets a 400,
 * never a rehearsal. After that it is the profile fallback chain — override →
 * the seat's own → the character's default → the instance default → 400 — and
 * the rule that a flagged chat's rehearsal follows its turns onto the
 * uncensored route.
 */

jest.mock('@/lib/logger', () => ({
  logger: {
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
  },
}))

jest.mock('@/lib/services/announcer/in-scene-voiced', () => ({
  generateInSceneVoicedLine: jest.fn(),
}))

jest.mock('@/lib/subprompts/subprompts', () => ({
  resolveSelectedSubprompts: jest.fn(async () => []),
}))

jest.mock('@/lib/services/dangerous-content/chat-override', () => ({
  shouldUseUncensoredRoute: jest.fn(() => false),
}))

jest.mock('@/lib/services/dangerous-content/resolver.service', () => ({
  resolveDangerousContentSettings: jest.fn(() => ({ settings: { mode: 'AUTO_ROUTE' } })),
}))

jest.mock('@/lib/services/dangerous-content/provider-routing.service', () => ({
  resolveProviderForDangerousContent: jest.fn(),
}))

import { handleImpersonationVoicePreview } from '@/app/api/v1/chats/[id]/actions/impersonation-voice-preview'
import { generateInSceneVoicedLine } from '@/lib/services/announcer/in-scene-voiced'
import { shouldUseUncensoredRoute } from '@/lib/services/dangerous-content/chat-override'
import { resolveProviderForDangerousContent } from '@/lib/services/dangerous-content/provider-routing.service'

const mockGenerate = generateInSceneVoicedLine as jest.Mock
const mockShouldUseUncensoredRoute = shouldUseUncensoredRoute as jest.Mock
const mockReroute = resolveProviderForDangerousContent as jest.Mock

type AnyRecord = Record<string, unknown>

// Real UUIDs — the request schema validates them before anything else runs.
const SEAT_ID = '11111111-1111-4111-8111-111111111101'
const CHAR_ID = '11111111-1111-4111-8111-111111111102'
const P_SEAT = '11111111-1111-4111-8111-111111111103'
const P_OVERRIDE = '11111111-1111-4111-8111-111111111104'
const P_CHARDEFAULT = '11111111-1111-4111-8111-111111111105'
const P_INSTANCE = '11111111-1111-4111-8111-111111111106'
const P_UNC = '11111111-1111-4111-8111-111111111107'
const SP_FIRST = '11111111-1111-4111-8111-111111111108'
const SP_MARKED = '11111111-1111-4111-8111-111111111109'
const UNKNOWN_SEAT_ID = '11111111-1111-4111-8111-1111111111ff'

const SEAT = {
  id: SEAT_ID,
  type: 'CHARACTER',
  characterId: CHAR_ID,
  status: 'active',
  controlledBy: 'llm',
  connectionProfileId: P_SEAT,
  selectedSystemPromptId: null,
  selectedSubpromptIds: [],
}

const PROFILES: Record<string, AnyRecord> = {
  [P_SEAT]: { id: P_SEAT, name: 'Seat voice', modelName: 'model-seat', isDangerousCompatible: false },
  [P_OVERRIDE]: { id: P_OVERRIDE, name: 'Override', modelName: 'model-over', isDangerousCompatible: false },
  [P_CHARDEFAULT]: { id: P_CHARDEFAULT, name: 'Character default', modelName: 'model-char', isDangerousCompatible: false },
  [P_INSTANCE]: { id: P_INSTANCE, name: 'Instance default', modelName: 'model-inst', isDangerousCompatible: false },
}

function makeChat(over: AnyRecord = {}): AnyRecord {
  return {
    id: 'chat-1',
    participants: [SEAT],
    impersonatingParticipantIds: [SEAT_ID],
    ...over,
  }
}

function makeCtx(over: { character?: AnyRecord | null; instanceDefault?: AnyRecord | null } = {}) {
  const character =
    over.character === undefined
      ? { id: CHAR_ID, name: 'Evangeline', systemPrompts: [], defaultConnectionProfileId: P_CHARDEFAULT }
      : over.character
  return {
    user: { id: 'user-1' },
    repos: {
      characters: { findById: jest.fn(async () => character) },
      chatSettings: { findByUserId: jest.fn(async () => ({})) },
      connections: {
        findById: jest.fn(async (id: string) => PROFILES[id] ?? null),
        findDefault: jest.fn(async () =>
          over.instanceDefault === undefined ? PROFILES[P_INSTANCE] : over.instanceDefault,
        ),
      },
    },
  } as never
}

function makeReq(body: AnyRecord) {
  return { json: jest.fn(async () => body) } as never
}

const BODY = {
  participantId: SEAT_ID,
  seedMarkdown: 'I tell him I will take the job.',
}

beforeEach(() => {
  jest.clearAllMocks()
  mockShouldUseUncensoredRoute.mockReturnValue(false)
  mockGenerate.mockResolvedValue({ success: true, proposedMarkdown: 'She lets the silence sit.' })
})

describe('handleImpersonationVoicePreview', () => {
  it('404s an unknown participant', async () => {
    const res = await handleImpersonationVoicePreview(
      makeReq({ ...BODY, participantId: UNKNOWN_SEAT_ID }),
      'chat-1',
      makeChat() as never,
      makeCtx(),
    )
    expect(res.status).toBe(404)
    expect(mockGenerate).not.toHaveBeenCalled()
  })

  it('400s a seat the chat row says is not being impersonated', async () => {
    const res = await handleImpersonationVoicePreview(
      makeReq(BODY),
      'chat-1',
      makeChat({ impersonatingParticipantIds: [] }) as never,
      makeCtx(),
    )
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: 'That seat is not being impersonated.' })
    expect(mockGenerate).not.toHaveBeenCalled()
  })

  it('400s a seat that is no longer present', async () => {
    const res = await handleImpersonationVoicePreview(
      makeReq(BODY),
      'chat-1',
      makeChat({ participants: [{ ...SEAT, status: 'absent' }] }) as never,
      makeCtx(),
    )
    expect(res.status).toBe(400)
    expect(mockGenerate).not.toHaveBeenCalled()
  })

  it('404s when the character is gone', async () => {
    const res = await handleImpersonationVoicePreview(
      makeReq(BODY),
      'chat-1',
      makeChat() as never,
      makeCtx({ character: null }),
    )
    expect(res.status).toBe(404)
  })

  it('400s when there is no profile to rewrite with', async () => {
    const res = await handleImpersonationVoicePreview(
      makeReq(BODY),
      'chat-1',
      makeChat({ participants: [{ ...SEAT, connectionProfileId: null }] }) as never,
      makeCtx({
        character: { id: CHAR_ID, name: 'Evangeline', systemPrompts: [] },
        instanceDefault: null,
      }),
    )
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: 'No connection profile to rewrite with' })
  })

  describe('profile fallback order', () => {
    it('prefers the operator override', async () => {
      await handleImpersonationVoicePreview(
        makeReq({ ...BODY, connectionProfileId: P_OVERRIDE }),
        'chat-1',
        makeChat() as never,
        makeCtx(),
      )
      expect(mockGenerate.mock.calls[0][0].profile.id).toBe(P_OVERRIDE)
    })

    it("falls back to the seat's own profile", async () => {
      await handleImpersonationVoicePreview(makeReq(BODY), 'chat-1', makeChat() as never, makeCtx())
      expect(mockGenerate.mock.calls[0][0].profile.id).toBe(P_SEAT)
    })

    it("falls back to the character's default", async () => {
      await handleImpersonationVoicePreview(
        makeReq(BODY),
        'chat-1',
        makeChat({ participants: [{ ...SEAT, connectionProfileId: null }] }) as never,
        makeCtx(),
      )
      expect(mockGenerate.mock.calls[0][0].profile.id).toBe(P_CHARDEFAULT)
    })

    it('falls back to the instance default', async () => {
      await handleImpersonationVoicePreview(
        makeReq(BODY),
        'chat-1',
        makeChat({ participants: [{ ...SEAT, connectionProfileId: null }] }) as never,
        makeCtx({ character: { id: CHAR_ID, name: 'Evangeline', systemPrompts: [] } }),
      )
      expect(mockGenerate.mock.calls[0][0].profile.id).toBe(P_INSTANCE)
    })
  })

  it("follows a flagged chat's turns onto the uncensored route", async () => {
    mockShouldUseUncensoredRoute.mockReturnValue(true)
    mockReroute.mockResolvedValue({
      rerouted: true,
      connectionProfile: { id: P_UNC, name: 'Uncensored', modelName: 'model-unc' },
      apiKey: 'ignored',
    })

    await handleImpersonationVoicePreview(makeReq(BODY), 'chat-1', makeChat() as never, makeCtx())
    expect(mockGenerate.mock.calls[0][0].profile.id).toBe(P_UNC)
  })

  it('never reroutes a chat the Concierge has not flagged', async () => {
    await handleImpersonationVoicePreview(makeReq(BODY), 'chat-1', makeChat() as never, makeCtx())
    expect(mockReroute).not.toHaveBeenCalled()
  })

  it('resolves the system prompt through the character fallback chain', async () => {
    await handleImpersonationVoicePreview(
      makeReq(BODY),
      'chat-1',
      makeChat() as never,
      makeCtx({
        character: {
          id: CHAR_ID,
          name: 'Evangeline',
          defaultConnectionProfileId: null,
          systemPrompts: [
            { id: SP_FIRST, name: 'First', isDefault: false },
            { id: SP_MARKED, name: 'Marked default', isDefault: true },
          ],
        },
      }),
    )
    expect(mockGenerate.mock.calls[0][0].systemPromptId).toBe(SP_MARKED)
  })

  it('returns the proposal with the voice it was rewritten through', async () => {
    const res = await handleImpersonationVoicePreview(
      makeReq(BODY),
      'chat-1',
      makeChat() as never,
      makeCtx(),
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      success: true,
      proposedMarkdown: 'She lets the silence sit.',
      profileName: 'Seat voice',
      modelName: 'model-seat',
    })
  })

  it("400s with the service's own error on a failed rewrite", async () => {
    mockGenerate.mockResolvedValue({ success: false, proposedMarkdown: '', error: 'the model refused' })
    const res = await handleImpersonationVoicePreview(
      makeReq(BODY),
      'chat-1',
      makeChat() as never,
      makeCtx(),
    )
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: 'the model refused' })
  })
})
