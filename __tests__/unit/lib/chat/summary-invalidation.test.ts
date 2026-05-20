/**
 * Phase 4: edit-aware summary invalidation hook tests.
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals'

const findById = jest.fn<(...args: any[]) => any>()
const update = jest.fn<(...args: any[]) => any>()

jest.mock('@/lib/repositories/factory', () => ({
  getRepositories: () => ({
    chats: { findById, update },
  }),
}))

jest.mock('@/lib/logger', () => {
  const stub = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), child: jest.fn() }
  stub.child.mockReturnValue(stub)
  return { logger: stub }
})

const {
  invalidateContextSummaryIfMessageCovered,
} = require('@/lib/chat/context-summary') as typeof import('@/lib/chat/context-summary')

function makeChat(overrides: any = {}) {
  return {
    id: 'chat-1',
    contextSummary: 'an existing summary',
    summaryAnchorMessageIds: ['m-1', 'm-2', 'm-3'],
    compactionGeneration: 5,
    lastSummaryTurn: 10,
    lastFullRebuildTurn: 0,
    ...overrides,
  }
}

describe('invalidateContextSummaryIfMessageCovered', () => {
  beforeEach(() => {
    findById.mockReset()
    update.mockReset()
    update.mockResolvedValue(undefined)
  })

  it('returns false on empty messageIds without DB read', async () => {
    const r = await invalidateContextSummaryIfMessageCovered('chat-1', [])
    expect(r).toBe(false)
    expect(findById).not.toHaveBeenCalled()
  })

  it('returns false when chat has no summary', async () => {
    findById.mockResolvedValue(makeChat({ contextSummary: null }))
    const r = await invalidateContextSummaryIfMessageCovered('chat-1', ['m-1'])
    expect(r).toBe(false)
    expect(update).not.toHaveBeenCalled()
  })

  it('returns false when no anchor IDs are stored', async () => {
    findById.mockResolvedValue(makeChat({ summaryAnchorMessageIds: [] }))
    const r = await invalidateContextSummaryIfMessageCovered('chat-1', ['m-1'])
    expect(r).toBe(false)
    expect(update).not.toHaveBeenCalled()
  })

  it('returns false when changed message is not covered (typo on a fresh msg)', async () => {
    findById.mockResolvedValue(makeChat())
    const r = await invalidateContextSummaryIfMessageCovered('chat-1', ['m-99'])
    expect(r).toBe(false)
    expect(update).not.toHaveBeenCalled()
  })

  it('clears summary and bumps generation when changed message is covered', async () => {
    findById.mockResolvedValue(makeChat())
    const r = await invalidateContextSummaryIfMessageCovered('chat-1', ['m-2'])

    expect(r).toBe(true)
    expect(update).toHaveBeenCalledTimes(1)
    const [, updateData] = update.mock.calls[0]
    expect(updateData.contextSummary).toBeNull()
    expect(updateData.summaryAnchorMessageIds).toEqual([])
    expect(updateData.compactionGeneration).toBe(6) // 5 + 1
    expect(updateData.lastSummaryTurn).toBe(0)
    expect(updateData.lastFullRebuildTurn).toBe(0)
  })

  it('invalidates if any one of multiple changed IDs is covered', async () => {
    findById.mockResolvedValue(makeChat())
    const r = await invalidateContextSummaryIfMessageCovered('chat-1', ['m-99', 'm-3'])
    expect(r).toBe(true)
    expect(update).toHaveBeenCalledTimes(1)
  })

  it('survives findById failure without throwing', async () => {
    findById.mockRejectedValue(new Error('db error'))
    const r = await invalidateContextSummaryIfMessageCovered('chat-1', ['m-1'])
    expect(r).toBe(false)
  })
})
