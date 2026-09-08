/**
 * Custom tools — the side-effect applier's progress branch.
 *
 * A `progress.<id>.<field>` effect is a metadata write wearing a hat, and that
 * is the load-bearing claim tested here: it folds into the very same
 * `metadataNext` copy and lands in ONE `characters.update`, so the job-child
 * contract (one whole-object replace, no read-your-writes) is untouched.
 *
 * The rest is the applier's own arithmetic: creating a progression nobody
 * authored, normalising a time written as epoch milliseconds, stamping
 * `updatedAt` so the next prompt reports the change regardless of cadence, and
 * rolling back a run whose result the schema refuses — without ever throwing,
 * because the roll has already happened and Pascal announces either way.
 */

import { applyCustomToolEffects } from '@/lib/pascal/side-effects'
import type { ResolvedEffect } from '@/lib/pascal/custom-tools'
import type { StateCascadeResult } from '@/lib/state/state-cascade'
import { ProgressionSchema, type WritableProgressionField } from '@/lib/progressions/schema'
import { UNIT_MS } from '@/lib/progressions/engine'

jest.mock('@/lib/repositories/factory', () => ({ getRepositories: jest.fn() }))
jest.mock('@/lib/mount-index/general-state', () => ({ writeGeneralState: jest.fn() }))
jest.mock('@/lib/logger', () => {
  // `child` matters: modules loaded transitively by the applier build service
  // loggers off this one at import time, and a mock without it fails the whole
  // suite before a single assertion runs.
  const base = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }
  return { logger: { ...base, child: jest.fn(() => ({ ...base, child: jest.fn() })) } }
})

import { getRepositories } from '@/lib/repositories/factory'
const { logger } = require('@/lib/logger') as { logger: Record<string, jest.Mock> }

const mockGetRepositories = getRepositories as jest.Mock

const NOW = Date.parse('2026-09-08T14:00:00Z')
const NOW_ISO = '2026-09-08T14:00:00.000Z'

function repos() {
  return {
    chats: { update: jest.fn() },
    projects: { update: jest.fn() },
    groups: { update: jest.fn() },
    characters: { update: jest.fn() },
  }
}

let db: ReturnType<typeof repos>

beforeEach(() => {
  jest.clearAllMocks()
  db = repos()
  mockGetRepositories.mockReturnValue(db)
})

const cascade = (): StateCascadeResult => ({
  chatState: {},
  projectState: {},
  groupState: {},
  generalState: {},
  merged: {},
  groupTier: { status: 'none', candidates: [] },
})

function progressEffect(
  index: number,
  id: string,
  field: WritableProgressionField,
  value: number | string | boolean,
): ResolvedEffect {
  return { index, target: { kind: 'progress', id, field, raw: `progress.${id}.${field}` }, value }
}

function metadataEffect(index: number, key: string, value: number | string | boolean): ResolvedEffect {
  return { index, target: { kind: 'metadata', key, raw: `metadata.${key}` }, value }
}

function apply(
  effects: ResolvedEffect[],
  overrides: Partial<Parameters<typeof applyCustomToolEffects>[0]> = {},
) {
  return applyCustomToolEffects({
    chatId: 'chat-1',
    toolName: 'fire_cannon',
    effects,
    cascade: cascade(),
    characterId: 'char-1',
    metadataSnapshot: {},
    nowMs: NOW,
    ...overrides,
  })
}

/** The `metadata` object the single character write actually carried. */
function written(): Record<string, unknown> {
  expect(db.characters.update).toHaveBeenCalledTimes(1)
  return db.characters.update.mock.calls[0][1].metadata as Record<string, unknown>
}

/** The progressions record inside that write. */
function writtenProgressions(): Record<string, Record<string, unknown>> {
  return (written().progressions ?? {}) as Record<string, Record<string, unknown>>
}

/** A character already carrying a ten-minute cannon recharge. */
const EXISTING = {
  faction: 'Ordo Aurum',
  progressions: {
    cannon: {
      name: 'Cannon recharge',
      startTime: '2026-09-08T13:50:00Z',
      endTime: '2026-09-08T14:00:00Z',
      timeIncrement: 'minute',
    },
  },
}

describe('one character write', () => {
  it('rides inside the metadata replace, not a write of its own', async () => {
    await apply(
      [
        progressEffect(0, 'cannon', 'startTime', NOW),
        progressEffect(1, 'cannon', 'endTime', NOW + 600_000),
        metadataEffect(2, 'lastFired', NOW),
      ],
      { metadataSnapshot: EXISTING },
    )
    expect(db.characters.update).toHaveBeenCalledTimes(1)
    expect(db.characters.update).toHaveBeenCalledWith('char-1', { metadata: expect.any(Object) })
  })

  it('leaves every other metadata key untouched', async () => {
    await apply([progressEffect(0, 'cannon', 'endTime', NOW + 600_000)], { metadataSnapshot: EXISTING })
    expect(written().faction).toBe('Ordo Aurum')
  })

  it('does not mutate the caller’s snapshot', async () => {
    const snapshot = JSON.parse(JSON.stringify(EXISTING))
    await apply([progressEffect(0, 'cannon', 'endTime', NOW + 600_000)], { metadataSnapshot: snapshot })
    expect(snapshot).toEqual(EXISTING)
  })

  it('skips fail-soft when nobody rolled — a run nobody made re-arms nobody’s cannon', async () => {
    const applied = await apply([progressEffect(0, 'cannon', 'endTime', NOW + 600_000)], {
      characterId: null,
      metadataSnapshot: EXISTING,
    })
    expect(applied).toEqual([])
    expect(db.characters.update).not.toHaveBeenCalled()
  })
})

describe('re-arming an existing progression', () => {
  it('records previous and next for pascalMeta.effects', async () => {
    const applied = await apply(
      [
        progressEffect(0, 'cannon', 'startTime', NOW),
        progressEffect(1, 'cannon', 'endTime', NOW + 600_000),
      ],
      { metadataSnapshot: EXISTING },
    )
    expect(applied).toEqual([
      { target: 'progress.cannon.startTime', previous: '2026-09-08T13:50:00Z', next: NOW_ISO },
      { target: 'progress.cannon.endTime', previous: '2026-09-08T14:00:00Z', next: '2026-09-08T14:10:00.000Z' },
    ])
  })

  it('stamps updatedAt with the run clock, so the next turn reports it regardless of cadence', async () => {
    await apply([progressEffect(0, 'cannon', 'endTime', NOW + 600_000)], { metadataSnapshot: EXISTING })
    expect(writtenProgressions().cannon.updatedAt).toBe(NOW_ISO)
  })

  it('keeps the author’s chosen increment when a tool merely nudges a boundary', async () => {
    const weekly = {
      progressions: {
        pregnancy: {
          name: 'Pregnancy',
          startTime: '2026-08-01T00:00:00Z',
          endTime: '2027-05-01T00:00:00Z',
          timeIncrement: 'week',
        },
      },
    }
    await apply([progressEffect(0, 'pregnancy', 'endTime', Date.parse('2027-04-20T00:00:00Z'))], {
      metadataSnapshot: weekly,
    })
    expect(writtenProgressions().pregnancy.timeIncrement).toBe('week')
  })

  it('lets later effects see earlier ones through the local copy', async () => {
    // endTime first, then startTime — the documented idiom, and the reason the
    // applier works against one copy rather than re-reading the store.
    const applied = await apply(
      [
        progressEffect(0, 'cannon', 'endTime', NOW + 600_000),
        progressEffect(1, 'cannon', 'startTime', NOW),
      ],
      { metadataSnapshot: EXISTING },
    )
    expect(applied).toHaveLength(2)
    expect(writtenProgressions().cannon).toMatchObject({
      startTime: NOW_ISO,
      endTime: '2026-09-08T14:10:00.000Z',
    })
  })
})

describe('create on write', () => {
  it('mints a progression nobody authored, with the documented defaults', async () => {
    await apply([progressEffect(0, 'fuse', 'name', 'Fuse')])
    expect(writtenProgressions().fuse).toMatchObject({
      name: 'Fuse',
      startTime: NOW_ISO,
      endTime: '2026-09-08T15:00:00.000Z',
      updatedAt: NOW_ISO,
    })
  })

  it('names the created progression after its id when nothing says otherwise', async () => {
    await apply([progressEffect(0, 'fuse', 'onComplete', 'once')])
    expect(writtenProgressions().fuse.name).toBe('fuse')
  })

  it('infers the increment from the span a created progression ends up with', async () => {
    await apply([
      progressEffect(0, 'cannon', 'startTime', NOW),
      progressEffect(1, 'cannon', 'endTime', NOW + 10 * UNIT_MS.minute),
    ])
    expect(writtenProgressions().cannon.timeIncrement).toBe('minute')

    db.characters.update.mockClear()
    await apply([
      progressEffect(0, 'gestation', 'startTime', NOW),
      progressEffect(1, 'gestation', 'endTime', NOW + 40 * UNIT_MS.week),
    ])
    expect(writtenProgressions().gestation.timeIncrement).toBe('month')
  })

  it('produces an entry the schema accepts', async () => {
    await apply([
      progressEffect(0, 'cannon', 'startTime', NOW),
      progressEffect(1, 'cannon', 'endTime', NOW + 600_000),
    ])
    expect(ProgressionSchema.safeParse(writtenProgressions().cannon).success).toBe(true)
  })

  it('creates the reserved key on a character who has never had one', async () => {
    await apply([progressEffect(0, 'fuse', 'name', 'Fuse')], { metadataSnapshot: { faction: 'Ordo Aurum' } })
    expect(written()).toHaveProperty('progressions')
    expect(written().faction).toBe('Ordo Aurum')
  })
})

describe('time normalisation', () => {
  it('takes epoch milliseconds and stores ISO', async () => {
    await apply([progressEffect(0, 'cannon', 'endTime', NOW + 600_000)], { metadataSnapshot: EXISTING })
    expect(writtenProgressions().cannon.endTime).toBe('2026-09-08T14:10:00.000Z')
  })

  it('takes an ISO string and normalises it', async () => {
    await apply([progressEffect(0, 'cannon', 'endTime', '2026-09-08T14:10:00+00:00')], {
      metadataSnapshot: EXISTING,
    })
    expect(writtenProgressions().cannon.endTime).toBe('2026-09-08T14:10:00.000Z')
  })

  it('skips a time written as prose or a boolean, rather than storing rubbish', async () => {
    for (const value of ['next Tuesday', true, Number.NaN]) {
      db.characters.update.mockClear()
      const applied = await apply([progressEffect(0, 'cannon', 'endTime', value as never)], {
        metadataSnapshot: EXISTING,
      })
      expect(applied).toEqual([])
    }
  })
})

describe('the quantity block', () => {
  it('writes one field without disturbing the others', async () => {
    const withQuantity = {
      progressions: {
        cannon: {
          ...EXISTING.progressions.cannon,
          endTime: '2026-09-08T14:20:00Z',
          quantity: { total: 1, unit: 'MJ', precision: 1 },
        },
      },
    }
    await apply([progressEffect(0, 'cannon', 'quantity.total', 2.5)], { metadataSnapshot: withQuantity })
    expect(writtenProgressions().cannon.quantity).toEqual({ total: 2.5, unit: 'MJ', precision: 1 })
  })

  it('mints a quantity block when the progression had none', async () => {
    await apply([progressEffect(0, 'cannon', 'quantity.unit', 'rounds')], {
      metadataSnapshot: {
        progressions: { cannon: { ...EXISTING.progressions.cannon, endTime: '2026-09-08T14:20:00Z' } },
      },
    })
    expect(writtenProgressions().cannon.quantity).toMatchObject({ unit: 'rounds' })
  })
})

describe('the remove pseudo-field', () => {
  it('deletes the progression on a write of true', async () => {
    const applied = await apply([progressEffect(0, 'cannon', 'remove', true)], { metadataSnapshot: EXISTING })
    expect(writtenProgressions()).toEqual({})
    expect(applied).toEqual([
      { target: 'progress.cannon.remove', previous: EXISTING.progressions.cannon, next: null },
    ])
  })

  it('does NOT delete on a write of false — that reads as "do not remove it"', async () => {
    const applied = await apply([progressEffect(0, 'cannon', 'remove', false)], { metadataSnapshot: EXISTING })
    expect(applied).toEqual([])
    expect(db.characters.update).not.toHaveBeenCalled()
  })

  it('skips fail-soft when the named progression does not exist', async () => {
    const applied = await apply([progressEffect(0, 'zeppelin', 'remove', true)], { metadataSnapshot: EXISTING })
    expect(applied).toEqual([])
  })

  it('leaves the character’s other progressions alone', async () => {
    const two = {
      progressions: {
        cannon: EXISTING.progressions.cannon,
        fuse: { ...EXISTING.progressions.cannon, name: 'Fuse' },
      },
    }
    await apply([progressEffect(0, 'cannon', 'remove', true)], { metadataSnapshot: two })
    expect(Object.keys(writtenProgressions())).toEqual(['fuse'])
  })
})

describe('post-validation', () => {
  it('drops a run whose result would not validate, and restores the pre-run entry', async () => {
    // endTime moved BEFORE startTime — the schema's one cross-field rule.
    const applied = await apply(
      [progressEffect(0, 'cannon', 'endTime', Date.parse('2026-09-08T13:00:00Z'))],
      { metadataSnapshot: EXISTING },
    )
    expect(applied).toEqual([])
    expect(db.characters.update).not.toHaveBeenCalled()
  })

  it('warns naming the character’s progression and the issue', async () => {
    await apply([progressEffect(0, 'cannon', 'endTime', Date.parse('2026-09-08T13:00:00Z'))], {
      metadataSnapshot: EXISTING,
    })
    expect(logger.warn).toHaveBeenCalledWith(
      'Custom tool progress writes dropped — the result would not validate',
      expect.objectContaining({ progressionId: 'cannon', issue: expect.stringContaining('startTime') }),
    )
  })

  it('never throws — the roll stands and Pascal still announces', async () => {
    await expect(
      apply([progressEffect(0, 'cannon', 'timeIncrement', 'fortnight')], { metadataSnapshot: EXISTING }),
    ).resolves.toEqual([])
  })

  it('drops only the offending progression, keeping a sound one in the same run', async () => {
    const applied = await apply(
      [
        progressEffect(0, 'fuse', 'name', 'Fuse'),
        progressEffect(1, 'cannon', 'timeIncrement', 'fortnight'),
      ],
      { metadataSnapshot: EXISTING },
    )
    expect(applied.map((e) => e.target)).toEqual(['progress.fuse.name'])
    expect(writtenProgressions()).toHaveProperty('fuse')
    expect(writtenProgressions().cannon).toEqual(EXISTING.progressions.cannon)
  })

  it('keeps a metadata write in the same run when a progress write is dropped', async () => {
    const applied = await apply(
      [
        metadataEffect(0, 'lastFired', NOW),
        progressEffect(1, 'cannon', 'timeIncrement', 'fortnight'),
      ],
      { metadataSnapshot: EXISTING },
    )
    expect(applied.map((e) => e.target)).toEqual(['metadata.lastFired'])
    expect(written().lastFired).toBe(NOW)
  })

  it('leaves no empty reserved key behind when every write rolls back on a fresh character', async () => {
    await apply(
      [
        progressEffect(0, 'cannon', 'startTime', NOW),
        progressEffect(1, 'cannon', 'endTime', NOW - 600_000),
      ],
      { metadataSnapshot: { faction: 'Ordo Aurum' } },
    )
    expect(db.characters.update).not.toHaveBeenCalled()
  })

  it('validates a created progression too', async () => {
    const applied = await apply([progressEffect(0, 'fuse', 'reportFrequency', 'sometimes')])
    expect(applied).toEqual([])
  })
})

describe('the metadata snapshot as the RMW base', () => {
  it('folds progress writes over a snapshot whose progressions key is malformed', async () => {
    const applied = await apply([progressEffect(0, 'fuse', 'name', 'Fuse')], {
      metadataSnapshot: { progressions: 'not an object' },
    })
    expect(applied).toHaveLength(1)
    expect(writtenProgressions().fuse.name).toBe('Fuse')
  })

  it('defaults nowMs to the wall clock when a caller omits it', async () => {
    const before = Date.now()
    const params = {
      chatId: 'chat-1',
      toolName: 'fire_cannon',
      effects: [progressEffect(0, 'fuse', 'name', 'Fuse')],
      cascade: cascade(),
      characterId: 'char-1',
      metadataSnapshot: {},
    }
    await applyCustomToolEffects(params)
    const stamped = Date.parse(String(writtenProgressions().fuse.updatedAt))
    expect(stamped).toBeGreaterThanOrEqual(before)
    expect(stamped).toBeLessThanOrEqual(Date.now())
  })
})
