/**
 * Search-and-replace is the one message-writing path outside the funnel.
 *
 * `ChatSearchReplaceOps.replaceInMessages` rewrites `chat_messages` rows
 * directly — it does not go through add/update/delete — so nothing in
 * `ChatMessagesOps` sees it happen. Without an explicit announcement the
 * transcript counter would not move and the realtime hint would never fly, so
 * an open Salon would go on being told "unchanged" while every line it is
 * displaying had its text rewritten underneath it.
 *
 * Design of record: docs/developer/features/complete/salon-realtime-transcript.md
 */

import { ChatMessagesOps } from '@/lib/database/repositories/chats-messages.ops'
import { ChatSearchReplaceOps } from '@/lib/database/repositories/chats-search.ops'
import type { ChatOpsContext } from '@/lib/database/repositories/chats-ops-context'
import type { ChatMetadata } from '@/lib/schemas/types'

const publishRealtime = jest.fn()
jest.mock('@/lib/realtime/bus', () => ({
  publishRealtime: (...args: unknown[]) => publishRealtime(...args),
}))

const NOW = '2026-09-11T12:49:25.818Z'
const CHAT_ID = '00000000-0000-4000-8000-00000000c0a7'

let chatRowWrites: Array<Record<string, unknown>>

function makeOps(messages: Array<Record<string, unknown>>) {
  chatRowWrites = []
  publishRealtime.mockClear()

  const messagesCollection = {
    insertOne: jest.fn(async () => ({})),
    find: jest.fn(async () => messages),
    findOne: jest.fn(async () => null),
    updateOne: jest.fn(async () => ({})),
    deleteOne: jest.fn(async () => 1),
    deleteMany: jest.fn(async () => 1),
  }

  const chatCollection = {
    updateOne: jest.fn(async (_filter: unknown, update: Record<string, unknown>) => {
      chatRowWrites.push(update)
      return {}
    }),
  }

  const ctx: ChatOpsContext = {
    findById: jest.fn(async () => ({ id: CHAT_ID, participants: [] }) as unknown as ChatMetadata),
    update: jest.fn(async () => null),
    getCollection: jest.fn(async () => chatCollection as never),
    getMessagesCollection: jest.fn(async () => messagesCollection as never),
    isSQLiteBackend: () => true,
    generateId: () => '00000000-0000-4000-8000-000000000abc',
    getCurrentTimestamp: () => NOW,
  }

  return new ChatSearchReplaceOps(ctx, new ChatMessagesOps(ctx))
}

function msg(content: string, id = '00000000-0000-4000-8000-000000000001') {
  return { type: 'message', id, role: 'ASSISTANT', content, createdAt: NOW }
}

describe('replaceInMessages announces the transcript change', () => {
  it('bumps the counter and publishes when text was replaced', async () => {
    const ops = makeOps([msg('the orchard was quiet')])

    const replaced = await ops.replaceInMessages(CHAT_ID, 'orchard', 'arbour')

    expect(replaced).toBe(1)
    expect(chatRowWrites).toEqual([{ $inc: { transcriptVersion: 1 } }])
    expect(publishRealtime).toHaveBeenCalledWith('chats', CHAT_ID)
  })

  it('says nothing when no message matched', async () => {
    const ops = makeOps([msg('the orchard was quiet')])

    const replaced = await ops.replaceInMessages(CHAT_ID, 'conservatory', 'arbour')

    expect(replaced).toBe(0)
    expect(chatRowWrites).toEqual([])
    expect(publishRealtime).not.toHaveBeenCalled()
  })
})
