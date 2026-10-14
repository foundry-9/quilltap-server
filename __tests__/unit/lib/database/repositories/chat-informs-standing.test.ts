/**
 * @jest-environment node
 *
 * `ChatInformsRepository` and standing informs (`permanent: true`).
 *
 * A standing row is in force for every generation its seat makes in the chat
 * until withdrawn; `consumedAt` on it records only the first delivery. What
 * these pin:
 *   - The prompt-path read returns standing rows whether or not they have been
 *     delivered, ahead of one-shot rows, and still drops consumed one-shots.
 *   - The chip's batch read keeps a delivered standing batch and says it is
 *     standing.
 *   - Withdrawal deletes every row of a standing batch, but still keeps a
 *     consumed one-shot row (a swipe's anchor).
 *   - `createBatch` writes the flag, defaulting to a one-shot.
 */

jest.mock('@/lib/logger', () => {
  const mock = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), child: jest.fn() }
  mock.child.mockReturnValue(mock)
  return { logger: mock }
})

import { ChatInformsRepository } from '@/lib/database/repositories/chat-informs.repository'

const CHAT = '00000000-0000-4000-8000-000000000001'
const SEAT = '00000000-0000-4000-8000-000000000002'

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 'row-x',
    chatId: CHAT,
    batchId: 'batch-x',
    participantId: SEAT,
    contentMarkdown: 'A passage.',
    recordMessageId: null,
    permanent: false,
    createdAt: '2026-10-01T10:00:00.000Z',
    updatedAt: '2026-10-01T10:00:00.000Z',
    consumedAt: null,
    consumedByMessageId: null,
    ...overrides,
  }
}

function repoWith(rows: ReturnType<typeof row>[]) {
  const repo = new ChatInformsRepository()
  const internals = repo as unknown as {
    findByFilter: jest.Mock
  }
  internals.findByFilter = jest.fn().mockResolvedValue(rows)
  const deleted: string[] = []
  repo.delete = jest.fn(async (id: string) => {
    deleted.push(id)
    return true
  })
  return { repo, deleted }
}

const oneShotOld = row({ id: 'oneshot-old', createdAt: '2026-10-01T09:00:00.000Z' })
const oneShotSpent = row({
  id: 'oneshot-spent',
  consumedAt: '2026-10-01T09:30:00.000Z',
  consumedByMessageId: 'msg-1',
})
const standingDelivered = row({
  id: 'standing-delivered',
  batchId: 'batch-standing',
  permanent: true,
  createdAt: '2026-10-01T11:00:00.000Z',
  consumedAt: '2026-10-01T11:05:00.000Z',
  consumedByMessageId: 'msg-2',
})

describe('ChatInformsRepository — standing informs', () => {
  it('delivers standing rows first, delivered or not, and drops spent one-shots', async () => {
    const { repo } = repoWith([oneShotOld, oneShotSpent, standingDelivered])

    const rows = await repo.findPendingForParticipant(CHAT, SEAT)

    expect(rows.map(r => r.id)).toEqual(['standing-delivered', 'oneshot-old'])
  })

  it('lists a delivered standing batch for the chip, marked as standing', async () => {
    const { repo } = repoWith([oneShotSpent, standingDelivered])

    const batches = await repo.findPendingBatches(CHAT)

    expect(batches).toEqual([
      expect.objectContaining({
        batchId: 'batch-standing',
        permanent: true,
        pendingParticipantIds: [SEAT],
      }),
    ])
  })

  it('withdraws every row of a standing batch, delivered or not', async () => {
    const { repo, deleted } = repoWith([
      standingDelivered,
      row({ id: 'standing-undelivered', batchId: 'batch-standing', permanent: true }),
    ])

    const removed = await repo.deletePendingByBatch('batch-standing')

    expect(removed).toBe(2)
    expect(deleted).toEqual(['standing-delivered', 'standing-undelivered'])
  })

  it('still keeps a consumed one-shot row when its batch is cancelled', async () => {
    const { repo, deleted } = repoWith([oneShotSpent, oneShotOld])

    await repo.deletePendingByBatch('batch-x')

    expect(deleted).toEqual(['oneshot-old'])
  })

  it('writes the flag on createBatch, defaulting to a one-shot', async () => {
    const repo = new ChatInformsRepository()
    const create = jest.fn(async (data: Record<string, unknown>) => ({ ...row(), ...data }))
    repo.create = create as never

    await repo.createBatch({ chatId: CHAT, contentMarkdown: 'x', participantIds: [SEAT] })
    await repo.createBatch({ chatId: CHAT, contentMarkdown: 'x', participantIds: [SEAT], permanent: true })

    expect(create.mock.calls[0][0]).toMatchObject({ permanent: false })
    expect(create.mock.calls[1][0]).toMatchObject({ permanent: true })
  })
})
