/**
 * @jest-environment node
 *
 * filterForCollage (lib/dynamic-backgrounds/eligibility.ts): the one judge of
 * whether a picture may hang in a collage (spec §5).
 */

import { filterForCollage } from '@/lib/dynamic-backgrounds/eligibility'

const sha = (c: string) => c.repeat(64)

function file(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    sha256: sha(id[0]),
    generationModeration: null,
    linkedTo: [] as string[],
    ...over,
  } as never
}

function repos(opts: {
  uncensoredShas?: string[]
  chats?: Array<Record<string, unknown>>
} = {}) {
  const findUncensoredBySha256s = jest.fn(async (shas: readonly string[]) =>
    (opts.uncensoredShas ?? [])
      .filter((s) => shas.includes(s))
      .map((s) => ({ sha256: s, generationModeration: 'uncensored-profile' })),
  )
  const findByIds = jest.fn(async (ids: string[]) =>
    (opts.chats ?? []).filter((c) => ids.includes(c.id as string)),
  )
  return { files: { findUncensoredBySha256s }, chats: { findByIds } } as never as {
    files: { findUncensoredBySha256s: jest.Mock }
    chats: { findByIds: jest.Mock }
  }
}

const ids = (files: Array<{ id: string }>) => files.map((f) => f.id)

describe('filterForCollage', () => {
  it('returns everything, asking nothing, when uncensored pictures are allowed', async () => {
    const r = repos({ uncensoredShas: [sha('a')] })
    const out = await filterForCollage([file('a1', { generationModeration: 'uncensored-routed' }), file('b1')], { allowUncensored: true }, r as never)
    expect(ids(out)).toEqual(['a1', 'b1'])
    expect(r.files.findUncensoredBySha256s).not.toHaveBeenCalled()
  })

  it('leaves out a picture whose own row is uncensored', async () => {
    const r = repos({ uncensoredShas: [sha('a')] })
    const out = await filterForCollage([file('a1', { generationModeration: 'uncensored-failover' }), file('b1', { generationModeration: 'moderated' })], { allowUncensored: false }, r as never)
    expect(ids(out)).toEqual(['b1'])
  })

  it('leaves out a moderated-looking row whose bytes carry an uncensored record elsewhere', async () => {
    const r = repos({ uncensoredShas: [sha('a')] })
    const out = await filterForCollage([file('a1', { generationModeration: null })], { allowUncensored: false }, r as never)
    expect(out).toEqual([])
  })

  it('keeps a moderated picture even when its chat is Unmoderated now', async () => {
    const r = repos({ chats: [{ id: 'chat-1', conciergeMode: 'unmoderated' }] })
    const out = await filterForCollage([file('m1', { generationModeration: 'moderated', linkedTo: ['chat-1'] })], { allowUncensored: false }, r as never)
    expect(ids(out)).toEqual(['m1'])
  })

  describe('an unknown (null) picture', () => {
    it('is out when a linked chat is Unmoderated', async () => {
      const r = repos({ chats: [{ id: 'chat-1', conciergeMode: 'unmoderated' }] })
      expect(await filterForCollage([file('n1', { linkedTo: ['chat-1', 'char-1'] })], { allowUncensored: false }, r as never)).toEqual([])
    })

    it('is out when a linked chat was flagged by the classifier', async () => {
      const r = repos({ chats: [{ id: 'chat-1', conciergeMode: 'moderated', isDangerousChat: true }] })
      expect(await filterForCollage([file('n1', { linkedTo: ['chat-1'] })], { allowUncensored: false }, r as never)).toEqual([])
    })

    it('is in when its chats are clean (a Locked chat counts as clean)', async () => {
      const r = repos({ chats: [{ id: 'chat-1', conciergeMode: 'locked', isDangerousChat: false }, { id: 'chat-2' }] })
      const out = await filterForCollage([file('n1', { linkedTo: ['chat-1', 'chat-2'] })], { allowUncensored: false }, r as never)
      expect(ids(out)).toEqual(['n1'])
    })

    it('is in when it is linked to no surviving chat', async () => {
      const r = repos({ chats: [] })
      const out = await filterForCollage([file('n1', { linkedTo: ['gone'] }), file('o1')], { allowUncensored: false }, r as never)
      expect(ids(out)).toEqual(['n1', 'o1'])
    })

    it('reads the chats in one batch for the whole pool', async () => {
      const r = repos({ chats: [] })
      await filterForCollage([file('n1', { linkedTo: ['c1'] }), file('o1', { linkedTo: ['c1', 'c2'] })], { allowUncensored: false }, r as never)
      expect(r.chats.findByIds).toHaveBeenCalledTimes(1)
      expect(r.chats.findByIds.mock.calls[0][0].sort()).toEqual(['c1', 'c2'])
    })
  })
})
