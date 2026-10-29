/**
 * The wardrobe_rollback and wardrobe_history handlers: rollback delegates to
 * rollbackWardrobe and reports refusals as errors; history windows to the last
 * `limit` entries, keeps the current one when it falls outside, and labels who
 * made each change.
 *
 * @jest-environment node
 */

jest.mock('@/lib/logger', () => {
  const mock = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), child: jest.fn() }
  mock.child.mockReturnValue(mock)
  return { logger: mock }
})

jest.mock('@/lib/repositories/factory', () => ({ getRepositories: jest.fn() }))

jest.mock('@/lib/wardrobe/history/rollback', () => ({ rollbackWardrobe: jest.fn() }))

jest.mock('@/lib/tools/handlers/wardrobe-handler-shared', () => ({
  ...jest.requireActual('@/lib/tools/handlers/wardrobe-handler-shared'),
  loadToolPool: jest.fn(),
}))

import { getRepositories } from '@/lib/repositories/factory'
import { rollbackWardrobe } from '@/lib/wardrobe/history/rollback'
import { loadToolPool } from '@/lib/tools/handlers/wardrobe-handler-shared'
import {
  executeWardrobeRollbackTool,
  formatWardrobeRollbackResults,
} from '@/lib/tools/handlers/wardrobe-rollback-handler'
import {
  executeWardrobeHistoryTool,
  formatWardrobeHistoryResults,
  windowHistory,
} from '@/lib/tools/handlers/wardrobe-history-handler'
import { makeEmptyEquippedSlots, type EquippedSlots } from '@/lib/schemas/wardrobe.types'
import type { ChatWardrobeHistoryRow } from '@/lib/schemas/chat-wardrobe-history.types'

const mockRepos = getRepositories as jest.Mock
const mockRollback = rollbackWardrobe as jest.Mock
const mockPool = loadToolPool as jest.Mock

const CHAT = 'chat-1'
const CHAR = 'char-1'
const OTHER = 'char-2'

const CONTEXT = {
  userId: 'u1',
  chatId: CHAT,
  characterId: CHAR,
  provenance: { source: 'character' as const, actorCharacterId: CHAR },
}

function slots(partial: Partial<EquippedSlots>): EquippedSlots {
  return { ...makeEmptyEquippedSlots(), ...partial }
}

const ITEMS = new Map([
  ['dress', { id: 'dress', title: 'Green Dress', types: ['top', 'bottom'] }],
  ['coat', { id: 'coat', title: 'Greatcoat', types: ['top'], archivedAt: '2026-10-01T00:00:00.000Z' }],
])
const POOL = {
  characterId: CHAR,
  byId: ITEMS,
  get: (id: string) => ITEMS.get(id),
  getMany: (ids: string[]) => ids.map((id) => ITEMS.get(id)).filter(Boolean),
}

function row(entryIndex: number, isCurrent = false, extra: Partial<ChatWardrobeHistoryRow> = {}): ChatWardrobeHistoryRow {
  return {
    id: `row-${entryIndex}`,
    chatId: CHAT,
    characterId: CHAR,
    entryIndex,
    slots: slots({ top: ['dress'] }),
    slotsHash: 'x'.repeat(16),
    source: 'character',
    actorCharacterId: CHAR,
    isCurrent,
    createdAt: `2026-10-16T00:00:${String(entryIndex).padStart(2, '0')}.000Z`,
    ...extra,
  }
}

describe('wardrobe_rollback handler', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockPool.mockResolvedValue(POOL)
    mockRepos.mockReturnValue({
      chats: { getEquippedOutfitForCharacter: jest.fn().mockResolvedValue(slots({ top: ['dress'] })) },
    })
  })

  it('returns to the restored outfit, as a tool-sourced change with the turn context', async () => {
    mockRollback.mockResolvedValue({
      ok: true,
      previousIndex: 3,
      restoredIndex: 2,
      slots: slots({ top: ['dress'] }),
      skipped: [{ itemId: 'coat', title: 'Greatcoat', reason: 'archived' }],
    })

    const out = await executeWardrobeRollbackTool({ index: 2 }, CONTEXT)

    expect(mockRollback).toHaveBeenCalledWith(
      expect.anything(),
      { chatId: CHAT, pool: POOL, index: 2, context: CONTEXT, source: 'tool' },
      expect.any(String),
    )
    expect(out).toMatchObject({
      success: true,
      previous_index: 3,
      restored_index: 2,
      current_state: slots({ top: ['dress'] }),
      skipped: [{ item_id: 'coat', title: 'Greatcoat', reason: 'archived' }],
    })
    const text = formatWardrobeRollbackResults(out)
    expect(text).toContain('Returned to outfit 2 (from 3).')
    expect(text).toContain('the Greatcoat could not be put back on: it has been archived.')
  })

  it('reports a refusal as an error', async () => {
    mockRollback.mockResolvedValue({ ok: false, reason: 'at_first', message: 'Already at 0.' })
    const out = await executeWardrobeRollbackTool({}, CONTEXT)
    expect(out).toEqual({ success: false, error: 'Already at 0.' })
  })

  it('rejects a negative index without touching anything', async () => {
    const out = await executeWardrobeRollbackTool({ index: -1 }, CONTEXT)
    expect(out.success).toBe(false)
    expect(mockRollback).not.toHaveBeenCalled()
  })
})

describe('wardrobe_history handler', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockPool.mockResolvedValue(POOL)
  })

  function reposWith(rows: ChatWardrobeHistoryRow[]) {
    const repos = {
      wardrobeHistory: { findEntries: jest.fn().mockResolvedValue(rows) },
      characters: { findByIdRaw: jest.fn().mockResolvedValue({ name: 'Jeeves' }) },
    }
    mockRepos.mockReturnValue(repos)
    return repos
  }

  it('lists entries ascending with labels and stale tags', async () => {
    reposWith([
      row(0, false, { source: 'chat-start', actorCharacterId: null }),
      row(1, false, { source: 'character', actorCharacterId: OTHER, slots: slots({ top: ['coat'], accessories: ['gone'] }) }),
      row(2, true, { source: 'operator', actorCharacterId: null }),
    ])

    const out = await executeWardrobeHistoryTool({}, CONTEXT)

    expect(out).toMatchObject({ success: true, current_index: 2, total: 3 })
    expect(out.entries.map((e) => [e.index, e.changed_by, e.is_current])).toEqual([
      [0, 'chat opened', false],
      [1, 'Jeeves', false],
      [2, 'the operator', true],
    ])
    expect(out.entries[1].summary).toContain('Greatcoat (archived)')
    expect(out.entries[1].summary).toContain('gone (no longer exists)')
    expect(formatWardrobeHistoryResults(out)).toContain('← wearing now')
  })

  it('labels the character\'s own change "you"', async () => {
    reposWith([row(0, true)])
    const out = await executeWardrobeHistoryTool({}, CONTEXT)
    expect(out.entries[0].changed_by).toBe('you')
  })

  it('keeps the current entry when the cursor sits outside the window', async () => {
    const rows = [row(0), row(1, true), row(2), row(3), row(4)]
    reposWith(rows)
    const out = await executeWardrobeHistoryTool({ limit: 2 }, CONTEXT)
    expect(out.entries.map((e) => e.index)).toEqual([1, 3, 4])
    expect(out.gap_before_window).toBe(true)
    expect(formatWardrobeHistoryResults(out)).toContain('…')
  })

  it('windowHistory adds nothing when the current entry is in the window', () => {
    const rows = [row(0), row(1), row(2, true)]
    expect(windowHistory(rows, 2)).toEqual({ rows: [rows[1], rows[2]], gapBeforeWindow: false })
  })

  it('says so when nothing is recorded', async () => {
    reposWith([])
    const out = await executeWardrobeHistoryTool({}, CONTEXT)
    expect(out).toEqual({ success: true, current_index: null, total: 0, entries: [] })
    expect(formatWardrobeHistoryResults(out)).toContain('No outfits recorded yet')
  })

  it('rejects a limit over 100', async () => {
    const out = await executeWardrobeHistoryTool({ limit: 500 }, CONTEXT)
    expect(out.success).toBe(false)
  })
})
