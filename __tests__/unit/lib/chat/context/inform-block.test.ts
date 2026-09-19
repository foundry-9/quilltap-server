/**
 * The inform block — the one reader of `chat_informs` on the prompt path.
 *
 * What these pin:
 *   - Stacking order and the `---` join, so two passages posted before a seat
 *     speaks arrive in the order they were written.
 *   - The regeneration set: a swipe sees exactly the rows that line's
 *     generation consumed, and no pending row — a brand-new passage has no
 *     business landing in a re-roll and being spent there.
 *   - Empty is *absent*, not an empty string. The caller pushes nothing, which
 *     is what keeps a turn without informs byte-identical to one built before
 *     the feature existed.
 *   - It never writes. Selection is not delivery.
 */

import { buildInformBlock, INFORM_BLOCK_SEPARATOR } from '@/lib/chat/context/inform-block'

const CHAT = 'chat-1'
const SEAT = 'participant-a'

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 'row-1',
    chatId: CHAT,
    batchId: 'batch-1',
    participantId: SEAT,
    contentMarkdown: 'You notice the clock has stopped.',
    recordMessageId: 'msg-record',
    createdAt: '2026-09-19T10:00:00.000Z',
    updatedAt: '2026-09-19T10:00:00.000Z',
    consumedAt: null,
    consumedByMessageId: null,
    ...overrides,
  }
}

function makeRepos(pending: unknown[] = [], consumed: unknown[] = []) {
  return {
    chatInforms: {
      findPendingForParticipant: jest.fn().mockResolvedValue(pending),
      findConsumedByMessages: jest.fn().mockResolvedValue(consumed),
      markConsumed: jest.fn(),
      createBatch: jest.fn(),
      deletePendingByBatch: jest.fn(),
    },
  } as never
}

describe('buildInformBlock', () => {
  it('returns the pending passage verbatim, with no framing of any kind', async () => {
    const repos = makeRepos([row()])

    const result = await buildInformBlock({ repos, chatId: CHAT, participantId: SEAT })

    expect(result.content).toBe('You notice the clock has stopped.')
    expect(result.rowIds).toEqual(['row-1'])
  })

  it('joins several pending passages in order with a rule between them', async () => {
    const repos = makeRepos([
      row({ id: 'row-1', contentMarkdown: 'First thing.' }),
      row({ id: 'row-2', batchId: 'batch-2', contentMarkdown: 'Second thing.' }),
    ])

    const result = await buildInformBlock({ repos, chatId: CHAT, participantId: SEAT })

    expect(result.content).toBe(`First thing.${INFORM_BLOCK_SEPARATOR}Second thing.`)
    expect(result.rowIds).toEqual(['row-1', 'row-2'])
  })

  it('is absent, not empty, when the seat is owed nothing', async () => {
    const repos = makeRepos([])

    const result = await buildInformBlock({ repos, chatId: CHAT, participantId: SEAT })

    expect(result.content).toBeNull()
    expect(result.rowIds).toEqual([])
  })

  it('treats a whitespace-only passage as nothing to deliver', async () => {
    const repos = makeRepos([row({ contentMarkdown: '   \n  ' })])

    const result = await buildInformBlock({ repos, chatId: CHAT, participantId: SEAT })

    expect(result.content).toBeNull()
    expect(result.rowIds).toEqual([])
  })

  describe('regeneration (swipe)', () => {
    it('reads the rows that generation consumed, not the pending ones', async () => {
      const pending = [row({ id: 'pending-row', contentMarkdown: 'Brand new.' })]
      const consumed = [
        row({
          id: 'consumed-row',
          contentMarkdown: 'What she knew at the time.',
          consumedAt: '2026-09-19T10:05:00.000Z',
          consumedByMessageId: 'msg-target',
        }),
      ]
      const repos = makeRepos(pending, consumed)

      const result = await buildInformBlock({
        repos,
        chatId: CHAT,
        participantId: SEAT,
        regenerationOfMessageIds: ['msg-target', 'msg-sibling'],
      })

      expect(result.content).toBe('What she knew at the time.')
      expect(result.content).not.toContain('Brand new.')
      expect((repos as never as ReturnType<typeof makeRepos> & { chatInforms: Record<string, jest.Mock> })
        .chatInforms.findConsumedByMessages)
        .toHaveBeenCalledWith(CHAT, SEAT, ['msg-target', 'msg-sibling'])
      expect((repos as never as { chatInforms: Record<string, jest.Mock> })
        .chatInforms.findPendingForParticipant)
        .not.toHaveBeenCalled()
    })

    it('never hands back row ids, so a swipe cannot consume', async () => {
      const repos = makeRepos([], [
        row({ id: 'consumed-row', consumedAt: 'x', consumedByMessageId: 'msg-target' }),
      ])

      const result = await buildInformBlock({
        repos,
        chatId: CHAT,
        participantId: SEAT,
        regenerationOfMessageIds: ['msg-target'],
      })

      expect(result.content).not.toBeNull()
      expect(result.rowIds).toEqual([])
    })

    it('falls back to the pending set when the regeneration list is empty', async () => {
      const repos = makeRepos([row()])

      const result = await buildInformBlock({
        repos,
        chatId: CHAT,
        participantId: SEAT,
        regenerationOfMessageIds: [],
      })

      expect(result.rowIds).toEqual(['row-1'])
    })
  })

  it('never writes — selection is not delivery', async () => {
    const repos = makeRepos([row()])

    await buildInformBlock({ repos, chatId: CHAT, participantId: SEAT })

    const informs = (repos as never as { chatInforms: Record<string, jest.Mock> }).chatInforms
    expect(informs.markConsumed).not.toHaveBeenCalled()
    expect(informs.createBatch).not.toHaveBeenCalled()
    expect(informs.deletePendingByBatch).not.toHaveBeenCalled()
  })
})
