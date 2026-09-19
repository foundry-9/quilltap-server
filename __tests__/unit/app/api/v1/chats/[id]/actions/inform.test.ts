/**
 * Tests for the Salon's **Inform** actions —
 * `POST ?action=inform`, `GET ?action=informs`, `POST ?action=cancel-inform`.
 *
 * Three things here are easy to get subtly wrong and expensive to notice later:
 * who counts as a seat that can be informed, whether the transcript's record is
 * public or whispered (coverage decides, not how the operator clicked), and
 * what a cancel is allowed to take back once somebody has already read the
 * passage. Each of those is pinned down below.
 */

// Uses global jest (not @jest/globals) for proper SWC mock hoisting

jest.mock('@/lib/logger', () => ({
  logger: {
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
  },
}))

jest.mock('@/lib/services/announcer/writer', () => ({
  postInformRecord: jest.fn(),
}))

jest.mock('@/lib/services/announcer/audience', () => ({
  resolveAnnouncementAudience: jest.fn(),
}))

jest.mock('@/lib/realtime/bus', () => ({
  publishRealtime: jest.fn(),
}))

const {
  handleInform,
  handleGetInforms,
  handleCancelInform,
} = require('@/app/api/v1/chats/[id]/actions/inform')
const { postInformRecord } = require('@/lib/services/announcer/writer')
const { resolveAnnouncementAudience } = require('@/lib/services/announcer/audience')
const { publishRealtime } = require('@/lib/realtime/bus')

const CHAT_ID = '3f1c9f4a-1111-4a2b-9c3d-000000000001'
const ALICE = '3f1c9f4a-1111-4a2b-9c3d-00000000000a'
const BOB = '3f1c9f4a-1111-4a2b-9c3d-00000000000b'
const OPERATOR = '3f1c9f4a-1111-4a2b-9c3d-00000000000c'
const DEPARTED = '3f1c9f4a-1111-4a2b-9c3d-00000000000d'
const BATCH_ID = '3f1c9f4a-1111-4a2b-9c3d-00000000000e'
const RECORD_ID = '3f1c9f4a-1111-4a2b-9c3d-00000000000f'

const BODY = 'You notice the clock has stopped.'

function makeRequest(body: unknown): any {
  return { json: async () => body }
}

function makeChat(overrides: Record<string, unknown> = {}) {
  return {
    id: CHAT_ID,
    participants: [
      { id: ALICE, type: 'CHARACTER', controlledBy: 'llm', status: 'active', removedAt: null },
      { id: BOB, type: 'CHARACTER', controlledBy: 'llm', status: 'silent', removedAt: null },
      { id: OPERATOR, type: 'CHARACTER', controlledBy: 'user', status: 'active', removedAt: null },
      { id: DEPARTED, type: 'CHARACTER', controlledBy: 'llm', status: 'removed', removedAt: '2026-01-01T00:00:00.000Z' },
    ],
    ...overrides,
  }
}

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'row-1',
    chatId: CHAT_ID,
    batchId: BATCH_ID,
    participantId: ALICE,
    contentMarkdown: BODY,
    recordMessageId: RECORD_ID,
    createdAt: '2026-01-01T21:14:00.000Z',
    updatedAt: '2026-01-01T21:14:00.000Z',
    consumedAt: null,
    consumedByMessageId: null,
    ...overrides,
  }
}

describe('chats [id] inform actions', () => {
  let ctx: any

  beforeEach(() => {
    jest.clearAllMocks()

    postInformRecord.mockResolvedValue({ id: RECORD_ID, type: 'message' })
    // Default: every requested id is a live participant of this chat.
    resolveAnnouncementAudience.mockImplementation(async (_chatId: string, requested: string[] | null) => ({
      targetParticipantIds: requested && requested.length > 0 ? [...new Set(requested)] : null,
      targetNames: [],
      unknownIds: [],
    }))

    ctx = {
      user: { id: 'user-1' },
      repos: {
        chats: {
          findById: jest.fn().mockResolvedValue(makeChat()),
          deleteMessagesByIds: jest.fn().mockResolvedValue(1),
        },
        chatInforms: {
          createBatch: jest.fn().mockImplementation(async ({ participantIds }: any) =>
            participantIds.map((participantId: string, i: number) =>
              makeRow({ id: `row-${i}`, participantId }),
            ),
          ),
          findPendingBatches: jest.fn().mockResolvedValue([]),
          findByBatchId: jest.fn().mockResolvedValue([]),
          deletePendingByBatch: jest.fn().mockResolvedValue(0),
        },
      },
    }
  })

  // ==========================================================================
  // POST ?action=inform
  // ==========================================================================

  describe('handleInform', () => {
    it('404s when the chat is gone', async () => {
      ctx.repos.chats.findById.mockResolvedValue(null)

      const res = await handleInform(
        makeRequest({ contentMarkdown: BODY, targetParticipantIds: null }),
        CHAT_ID,
        ctx,
      )

      expect(res.status).toBe(404)
      expect(ctx.repos.chatInforms.createBatch).not.toHaveBeenCalled()
    })

    it('null targets reach every eligible seat, silent ones included, and post a public record', async () => {
      const res = await handleInform(
        makeRequest({ contentMarkdown: BODY, targetParticipantIds: null }),
        CHAT_ID,
        ctx,
      )
      const body = await res.json()

      expect(res.status).toBe(201)
      // Alice and silent Bob — never the operator's seat, never the departed one.
      expect(ctx.repos.chatInforms.createBatch).toHaveBeenCalledWith({
        chatId: CHAT_ID,
        contentMarkdown: BODY,
        participantIds: [ALICE, BOB],
        recordMessageId: RECORD_ID,
      })
      expect(postInformRecord).toHaveBeenCalledWith({
        chatId: CHAT_ID,
        contentMarkdown: BODY,
        targetParticipantIds: null,
      })
      expect(body.batchId).toBe(BATCH_ID)
      expect(body.targetParticipantIds).toBeNull()
    })

    it('an explicit list covering every eligible seat still posts a PUBLIC record', async () => {
      const res = await handleInform(
        makeRequest({ contentMarkdown: BODY, targetParticipantIds: [ALICE, BOB] }),
        CHAT_ID,
        ctx,
      )
      const body = await res.json()

      expect(res.status).toBe(201)
      expect(postInformRecord).toHaveBeenCalledWith(
        expect.objectContaining({ targetParticipantIds: null }),
      )
      expect(body.targetParticipantIds).toBeNull()
    })

    it('a subset whispers the record to just those seats', async () => {
      const res = await handleInform(
        makeRequest({ contentMarkdown: BODY, targetParticipantIds: [ALICE] }),
        CHAT_ID,
        ctx,
      )
      const body = await res.json()

      expect(res.status).toBe(201)
      expect(postInformRecord).toHaveBeenCalledWith(
        expect.objectContaining({ targetParticipantIds: [ALICE] }),
      )
      expect(ctx.repos.chatInforms.createBatch).toHaveBeenCalledWith(
        expect.objectContaining({ participantIds: [ALICE] }),
      )
      expect(body.targetParticipantIds).toEqual([ALICE])
    })

    it('400s on an id that is not a participant of this chat', async () => {
      resolveAnnouncementAudience.mockResolvedValue({
        targetParticipantIds: null,
        targetNames: [],
        unknownIds: [DEPARTED],
      })

      const res = await handleInform(
        makeRequest({ contentMarkdown: BODY, targetParticipantIds: [DEPARTED] }),
        CHAT_ID,
        ctx,
      )

      expect(res.status).toBe(400)
      expect((await res.json()).error).toContain(DEPARTED)
      expect(ctx.repos.chatInforms.createBatch).not.toHaveBeenCalled()
    })

    it('400s on a user-controlled seat, naming it', async () => {
      const res = await handleInform(
        makeRequest({ contentMarkdown: BODY, targetParticipantIds: [ALICE, OPERATOR] }),
        CHAT_ID,
        ctx,
      )

      expect(res.status).toBe(400)
      expect((await res.json()).error).toContain(OPERATOR)
      expect(postInformRecord).not.toHaveBeenCalled()
      expect(ctx.repos.chatInforms.createBatch).not.toHaveBeenCalled()
    })

    it('400s when the room has nobody an LLM speaks for', async () => {
      ctx.repos.chats.findById.mockResolvedValue(
        makeChat({
          participants: [
            { id: OPERATOR, type: 'CHARACTER', controlledBy: 'user', status: 'active', removedAt: null },
          ],
        }),
      )

      const res = await handleInform(
        makeRequest({ contentMarkdown: BODY, targetParticipantIds: null }),
        CHAT_ID,
        ctx,
      )

      expect(res.status).toBe(400)
      expect((await res.json()).error).toBe('No LLM-controlled seat to inform.')
    })

    it('still creates the batch when the record cannot be written', async () => {
      postInformRecord.mockResolvedValue(null)

      const res = await handleInform(
        makeRequest({ contentMarkdown: BODY, targetParticipantIds: null }),
        CHAT_ID,
        ctx,
      )
      const body = await res.json()

      expect(res.status).toBe(201)
      expect(ctx.repos.chatInforms.createBatch).toHaveBeenCalledWith(
        expect.objectContaining({ recordMessageId: null }),
      )
      expect(body.message).toBeNull()
      expect(body.batchId).toBe(BATCH_ID)
    })
  })

  // ==========================================================================
  // GET ?action=informs
  // ==========================================================================

  describe('handleGetInforms', () => {
    it('returns the pending batches', async () => {
      ctx.repos.chatInforms.findPendingBatches.mockResolvedValue([
        {
          batchId: BATCH_ID,
          contentMarkdown: BODY,
          createdAt: '2026-01-01T21:14:00.000Z',
          recordMessageId: RECORD_ID,
          pendingParticipantIds: [ALICE, BOB],
        },
      ])

      const res = await handleGetInforms(CHAT_ID, ctx)
      const body = await res.json()

      expect(res.status).toBe(200)
      expect(body.batches).toHaveLength(1)
      expect(body.batches[0].pendingParticipantIds).toEqual([ALICE, BOB])
    })

    it('filters seats that have left, and drops a batch left with nobody', async () => {
      ctx.repos.chatInforms.findPendingBatches.mockResolvedValue([
        {
          batchId: BATCH_ID,
          contentMarkdown: BODY,
          createdAt: '2026-01-01T21:14:00.000Z',
          recordMessageId: RECORD_ID,
          pendingParticipantIds: [ALICE, DEPARTED],
        },
        {
          batchId: 'batch-2',
          contentMarkdown: 'gone',
          createdAt: '2026-01-01T21:15:00.000Z',
          recordMessageId: null,
          pendingParticipantIds: [DEPARTED],
        },
      ])

      const res = await handleGetInforms(CHAT_ID, ctx)
      const body = await res.json()

      expect(body.batches).toHaveLength(1)
      expect(body.batches[0].pendingParticipantIds).toEqual([ALICE])
    })

    it('404s when the chat is gone', async () => {
      ctx.repos.chats.findById.mockResolvedValue(null)
      const res = await handleGetInforms(CHAT_ID, ctx)
      expect(res.status).toBe(404)
    })
  })

  // ==========================================================================
  // POST ?action=cancel-inform
  // ==========================================================================

  describe('handleCancelInform', () => {
    it('takes the record with it when nobody has read the passage', async () => {
      ctx.repos.chatInforms.findByBatchId.mockResolvedValue([
        makeRow({ id: 'row-0', participantId: ALICE }),
        makeRow({ id: 'row-1', participantId: BOB }),
      ])
      ctx.repos.chatInforms.deletePendingByBatch.mockResolvedValue(2)

      const res = await handleCancelInform(makeRequest({ batchId: BATCH_ID }), CHAT_ID, ctx)
      const body = await res.json()

      expect(res.status).toBe(200)
      expect(body).toEqual({ success: true, removed: 2, recordDeleted: true })
      expect(ctx.repos.chats.deleteMessagesByIds).toHaveBeenCalledWith(CHAT_ID, [RECORD_ID])
      expect(publishRealtime).toHaveBeenCalledWith('chats', CHAT_ID)
    })

    it('keeps the record once any seat has consumed its row', async () => {
      ctx.repos.chatInforms.findByBatchId.mockResolvedValue([
        makeRow({ id: 'row-0', participantId: ALICE, consumedAt: '2026-01-01T21:20:00.000Z', consumedByMessageId: 'msg-1' }),
        makeRow({ id: 'row-1', participantId: BOB }),
      ])
      ctx.repos.chatInforms.deletePendingByBatch.mockResolvedValue(1)

      const res = await handleCancelInform(makeRequest({ batchId: BATCH_ID }), CHAT_ID, ctx)
      const body = await res.json()

      expect(body).toEqual({ success: true, removed: 1, recordDeleted: false })
      expect(ctx.repos.chats.deleteMessagesByIds).not.toHaveBeenCalled()
      expect(publishRealtime).toHaveBeenCalledWith('chats', CHAT_ID)
    })

    it('still answers when the record message refuses to go', async () => {
      ctx.repos.chatInforms.findByBatchId.mockResolvedValue([makeRow()])
      ctx.repos.chatInforms.deletePendingByBatch.mockResolvedValue(1)
      ctx.repos.chats.deleteMessagesByIds.mockRejectedValue(new Error('locked'))

      const res = await handleCancelInform(makeRequest({ batchId: BATCH_ID }), CHAT_ID, ctx)
      const body = await res.json()

      expect(res.status).toBe(200)
      expect(body).toEqual({ success: true, removed: 1, recordDeleted: false })
      expect(publishRealtime).toHaveBeenCalledWith('chats', CHAT_ID)
    })

    it('404s on an unknown batch', async () => {
      ctx.repos.chatInforms.findByBatchId.mockResolvedValue([])

      const res = await handleCancelInform(makeRequest({ batchId: BATCH_ID }), CHAT_ID, ctx)

      expect(res.status).toBe(404)
      expect(ctx.repos.chatInforms.deletePendingByBatch).not.toHaveBeenCalled()
    })

    it('400s on a batch belonging to another conversation', async () => {
      ctx.repos.chatInforms.findByBatchId.mockResolvedValue([
        makeRow({ chatId: 'someone-elses-chat' }),
      ])

      const res = await handleCancelInform(makeRequest({ batchId: BATCH_ID }), CHAT_ID, ctx)

      expect(res.status).toBe(400)
      expect(ctx.repos.chatInforms.deletePendingByBatch).not.toHaveBeenCalled()
    })
  })
})
