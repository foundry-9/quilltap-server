/**
 * The message funnel is where a transcript change is announced.
 *
 * `addMessage` / `addMessages` / `updateMessage` / `deleteMessagesByIds` /
 * `clearMessages` are the single write path for every message in the system —
 * a composer send, an Aurora wardrobe note, a Lantern backdrop announcement, a
 * Commonplace whisper and its later sweep. Each one must do two things
 * together: bump the chat's `transcriptVersion`, and publish
 * `{topic:'chats', id}` so an open Salon tab knows to look again.
 *
 * They must stay together. A hint without a bump would be answered "unchanged"
 * by the conditional read and the change would never reach the display; a bump
 * without a hint would sit in the database until something else happened to
 * trigger a read — which is exactly the bug this feature exists to close.
 *
 * The bump must also be an atomic `SET v = v + 1` rather than a read-then-write
 * of a snapshot. Two messages landing together would otherwise both compute the
 * same next value, and a tab that read in between would be told "unchanged" for
 * the second one — the very failure this counter exists to prevent.
 *
 * Design of record: docs/developer/features/complete/salon-realtime-transcript.md
 */

import { ChatMessagesOps } from '@/lib/database/repositories/chats-messages.ops'
import type { ChatOpsContext } from '@/lib/database/repositories/chats-ops-context'
import type { ChatEvent, ChatMetadata } from '@/lib/schemas/types'

const publishRealtime = jest.fn()
jest.mock('@/lib/realtime/bus', () => ({
  publishRealtime: (...args: unknown[]) => publishRealtime(...args),
}))

const NOW = '2026-09-11T12:49:25.818Z'
const CHAT_ID = '00000000-0000-4000-8000-00000000c0a7'
const MESSAGE_ID = '00000000-0000-4000-8000-000000000001'

let rows: Record<string, unknown>[]
let updates: Array<Partial<ChatMetadata>>
/** Every `updateOne` issued against the `chats` row itself. */
let chatRowWrites: Array<Record<string, unknown>>

/** `null` stands for a chat row that predates the counter column. */
function makeOps(startingVersion: number | null = 7): ChatMessagesOps {
  rows = []
  updates = []
  chatRowWrites = []
  publishRealtime.mockClear()

  const messagesCollection = {
    insertOne: jest.fn(async (doc: Record<string, unknown>) => {
      rows.push(doc)
      return doc
    }),
    find: jest.fn(async () => rows),
    findOne: jest.fn(async () => rows.find((r) => r.id === MESSAGE_ID) ?? null),
    updateOne: jest.fn(async () => ({})),
    deleteOne: jest.fn(async (filter: { id: string }) => {
      const at = rows.findIndex((r) => r.id === filter.id)
      if (at < 0) return 0
      rows.splice(at, 1)
      return 1
    }),
    deleteMany: jest.fn(async () => {
      rows = []
      return 1
    }),
  }

  const chatCollection = {
    updateOne: jest.fn(async (_filter: unknown, update: Record<string, unknown>) => {
      chatRowWrites.push(update)
      return {}
    }),
  }

  const ctx: ChatOpsContext = {
    findById: jest.fn(async () => ({
      id: CHAT_ID,
      participants: [],
      transcriptVersion: startingVersion ?? undefined,
    }) as unknown as ChatMetadata),
    update: jest.fn(async (_id: string, data: Partial<ChatMetadata>) => {
      updates.push(data)
      return null
    }),
    getCollection: jest.fn(async () => chatCollection as never),
    getMessagesCollection: jest.fn(async () => messagesCollection as never),
    isSQLiteBackend: () => true,
    generateId: () => MESSAGE_ID,
    getCurrentTimestamp: () => NOW,
  }

  return new ChatMessagesOps(ctx)
}

function msg(overrides: Record<string, unknown> = {}): ChatEvent {
  return {
    type: 'message',
    id: MESSAGE_ID,
    role: 'ASSISTANT',
    content: 'hello',
    createdAt: NOW,
    ...overrides,
  } as unknown as ChatEvent
}

/** Every atomic counter bump this write issued, in order. */
function bumps(): Array<Record<string, unknown>> {
  return chatRowWrites
    .map((w) => (w as { $inc?: Record<string, unknown> }).$inc)
    .filter((inc): inc is Record<string, unknown> => Boolean(inc))
}

/** No metadata patch may carry the counter — Zod would strip it anyway. */
function metadataPatchesCarryingVersion(): number {
  return updates.filter((u) => 'transcriptVersion' in (u as Record<string, unknown>)).length
}

describe('the funnel bumps and announces together', () => {
  it('addMessage', async () => {
    const ops = makeOps()
    await ops.addMessage(CHAT_ID, msg())
    expect(bumps()).toEqual([{ transcriptVersion: 1 }])
    expect(publishRealtime).toHaveBeenCalledWith('chats', CHAT_ID)
  })

  it('addMessages', async () => {
    const ops = makeOps()
    await ops.addMessages(CHAT_ID, [
      msg(),
      msg({ id: '00000000-0000-4000-8000-000000000002' }),
    ])
    // One bump for the batch, not one per row: the tab asks "has this changed?",
    // not "by how much".
    expect(bumps()).toEqual([{ transcriptVersion: 1 }])
    expect(publishRealtime).toHaveBeenCalledTimes(1)
  })

  it('updateMessage — an edited row is a transcript change', async () => {
    const ops = makeOps()
    await ops.addMessage(CHAT_ID, msg())
    publishRealtime.mockClear()
    updates.length = 0
    chatRowWrites.length = 0

    await ops.updateMessage(CHAT_ID, MESSAGE_ID, { content: 'edited' } as Partial<ChatEvent>)
    expect(bumps()).toEqual([{ transcriptVersion: 1 }])
    expect(publishRealtime).toHaveBeenCalledWith('chats', CHAT_ID)
  })

  it('updateMessage — says nothing when the message is not there', async () => {
    const ops = makeOps()
    await ops.updateMessage(CHAT_ID, 'no-such-message', { content: 'x' } as Partial<ChatEvent>)
    expect(publishRealtime).not.toHaveBeenCalled()
  })

  it('deleteMessagesByIds — a swept whisper', async () => {
    const ops = makeOps()
    await ops.addMessage(CHAT_ID, msg())
    publishRealtime.mockClear()
    updates.length = 0
    chatRowWrites.length = 0

    await ops.deleteMessagesByIds(CHAT_ID, [MESSAGE_ID])
    expect(bumps()).toEqual([{ transcriptVersion: 1 }])
    expect(publishRealtime).toHaveBeenCalledWith('chats', CHAT_ID)
  })

  it('deleteMessagesByIds — says nothing when nothing was removed', async () => {
    const ops = makeOps()
    await ops.deleteMessagesByIds(CHAT_ID, ['no-such-message'])
    expect(publishRealtime).not.toHaveBeenCalled()
  })

  it('clearMessages', async () => {
    const ops = makeOps()
    await ops.clearMessages(CHAT_ID)
    expect(bumps()).toEqual([{ transcriptVersion: 1 }])
    expect(publishRealtime).toHaveBeenCalledWith('chats', CHAT_ID)
  })

  it('never writes the counter through a metadata patch', async () => {
    // The column is deliberately outside ChatMetadataSchema, so a repository
    // update — which rewrites the whole validated row from a snapshot it read
    // moments earlier — cannot rewind it. A patch carrying the counter would
    // mean that protection had been given up.
    const ops = makeOps()
    await ops.addMessage(CHAT_ID, msg())
    expect(metadataPatchesCarryingVersion()).toBe(0)
  })

  it('bumps relative to the stored value, never to a snapshot it read', async () => {
    // Two writes landing together must leave the counter two ahead, not one.
    // Computing `snapshot + 1` twice would leave a tab that read in between
    // being told "unchanged" for the second message.
    const ops = makeOps()
    await Promise.all([
      ops.addMessage(CHAT_ID, msg()),
      ops.addMessage(CHAT_ID, msg({ id: '00000000-0000-4000-8000-000000000009' })),
    ])
    expect(bumps()).toEqual([{ transcriptVersion: 1 }, { transcriptVersion: 1 }])
  })
})
