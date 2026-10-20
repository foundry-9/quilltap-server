/**
 * Custom tools — the Inventory read side (inventory-tools-and-pascal
 * §5.3–5.5): the `inventory` / `inventoryCount` subjects (including the null
 * context, which declines every comparator), templated keys, the
 * `{{inventory.*}}` placeholders and their dotted-ref edge cases, the
 * `$inventory` operand and whole-roll dice fallback, the gate, the roster's
 * lazy load, and the bench's mock bag.
 */

jest.mock('@/lib/repositories/factory', () => ({ getRepositories: jest.fn(() => ({})) }))
jest.mock('@/lib/mount-index/tiered-mount-pool', () => ({ resolveTieredMountPool: jest.fn() }))
jest.mock('@/lib/mount-index/database-store', () => ({
  listDatabaseFiles: jest.fn(),
  DatabaseStoreError: class DatabaseStoreError extends Error {},
}))
jest.mock('@/lib/mount-index/read-file', () => ({ readMountFileBytes: jest.fn() }))
jest.mock('@/lib/inventory/context', () => ({ loadInventoryContext: jest.fn() }))

import {
  executeCustomTool,
  matchesWhen,
  renderTemplate,
  resolveCustomToolRoster,
  type OutcomeSubjects,
} from '@/lib/pascal/custom-tools'
import { QtapCustomToolSchema, classifyPlaceholder, type QtapCustomTool, type When } from '@/lib/pascal/custom-tool.types'
import { evaluateToolGate } from '@/lib/pascal/tool-gate'
import { resolveInventoryValue } from '@/lib/pascal/inventory-subjects'
import { mockInventoryContext } from '@/lib/pascal/bench-inventory'
import { inventoryContextFrom, type InventoryContext } from '@/lib/inventory/refs'
import type { ResolvedInventoryItem } from '@/lib/schemas/inventory.types'
import { loadInventoryContext } from '@/lib/inventory/context'
import { getRepositories } from '@/lib/repositories/factory'
import { resolveTieredMountPool } from '@/lib/mount-index/tiered-mount-pool'
import { listDatabaseFiles } from '@/lib/mount-index/database-store'
import { readMountFileBytes } from '@/lib/mount-index/read-file'

function define(doc: unknown): QtapCustomTool {
  const result = QtapCustomToolSchema.safeParse(doc)
  if (!result.success) throw new Error(result.error.issues.map((i) => i.message).join('; '))
  return result.data
}

const T = '2026-10-18T00:00:00.000Z'
function obj(id: string, fields: Partial<ResolvedInventoryItem> = {}): ResolvedInventoryItem {
  return {
    id, kind: 'item', name: 'sword', title: null, equippedByDefault: false, maxEquipped: 1, canCopy: false,
    isArchetype: false, parentId: null, itemIds: [], metadata: {}, folder: '', archivedAt: null, createdAt: T, updatedAt: T,
    ...fields,
  } as ResolvedInventoryItem
}

/** Vivienne: an equipped Excalibur (sword, damage 2d6), two equipped rings, a carried lantern. */
function vivienne(): InventoryContext {
  const items = [
    obj('excalibur', { title: 'Excalibur', description: 'A blade of legend', metadata: { damage: '2d6', bonus: 3 } }),
    obj('r1', { name: 'ring' }),
    obj('r2', { name: 'ring' }),
    obj('lantern', { name: 'lantern' }),
    obj('rope', { name: 'rope', origin: { scope: 'project', id: 'p', name: 'Project' } }),
  ]
  const own = new Set(['excalibur', 'r1', 'r2', 'lantern'])
  return inventoryContextFrom('c-viv', 'chat-1', { items, owns: (id) => own.has(id) }, new Set(['excalibur', 'r1', 'r2']))
}

function subjects(inventory: InventoryContext | null, params: Record<string, string | number | boolean> = {}): OutcomeSubjects {
  return { value: 0.5, roll: 0.5, params, inventory }
}

describe('the inventory subject', () => {
  const when = (w: unknown): When => w as When

  it('tests the four states with eq / neq', () => {
    const ctx = vivienne()
    expect(matchesWhen(when({ inventory: { sword: { eq: 'equipped' } } }), subjects(ctx))).toBe(true)
    expect(matchesWhen(when({ inventory: { lantern: { eq: 'carried' } } }), subjects(ctx))).toBe(true)
    expect(matchesWhen(when({ inventory: { rope: { eq: 'reachable' } } }), subjects(ctx))).toBe(true)
    expect(matchesWhen(when({ inventory: { axe: { eq: 'absent' } } }), subjects(ctx))).toBe(true)
    expect(matchesWhen(when({ inventory: { lantern: { neq: 'carried' } } }), subjects(ctx))).toBe(false)
  })

  it('renders a templated key against the run\'s parameters', () => {
    expect(
      matchesWhen(when({ inventory: { '{{params.weapon}}': { eq: 'equipped' } } }), subjects(vivienne(), { weapon: 'Excalibur' }))
    ).toBe(true)
  })

  it('resolves a $param state operand', () => {
    expect(
      matchesWhen(when({ inventory: { lantern: { eq: { $param: 'want' } } } }), subjects(vivienne(), { want: 'carried' }))
    ).toBe(true)
  })

  it('declines every comparator with no context — eq: "absent" and neq included', () => {
    expect(matchesWhen(when({ inventory: { axe: { eq: 'absent' } } }), subjects(null))).toBe(false)
    expect(matchesWhen(when({ inventory: { axe: { neq: 'equipped' } } }), subjects(null))).toBe(false)
  })
})

describe('the inventoryCount subject', () => {
  it('counts equipped kin', () => {
    const ctx = vivienne()
    expect(matchesWhen({ inventoryCount: { ring: { gte: 2 } } } as When, subjects(ctx))).toBe(true)
    expect(matchesWhen({ inventoryCount: { lantern: { eq: 0 } } } as When, subjects(ctx))).toBe(true)
    expect(matchesWhen({ inventoryCount: { axe: { lt: 1 } } } as When, subjects(ctx))).toBe(true)
  })

  it('declines with no context, even lt: 1', () => {
    expect(matchesWhen({ inventoryCount: { axe: { lt: 1 } } } as When, subjects(null))).toBe(false)
  })
})

describe('{{inventory.*}} placeholders', () => {
  it('classifies by the first .metadata., else a trailing field', () => {
    expect(classifyPlaceholder('inventory.sword.metadata.state')).toEqual({ kind: 'inventory', ref: 'sword', field: 'metadata', key: 'state' })
    expect(classifyPlaceholder('inventory.sword.metadata.name')).toEqual({ kind: 'inventory', ref: 'sword', field: 'metadata', key: 'name' })
    expect(classifyPlaceholder('inventory.old.sword.title')).toEqual({ kind: 'inventory', ref: 'old.sword', field: 'title' })
    expect(classifyPlaceholder('inventory.sword.metadata').kind).toBe('unknown')
    expect(classifyPlaceholder('inventory.sword').kind).toBe('unknown')
  })

  it('renders title, name, description, state and metadata; title falls back to the name', () => {
    const vars = { value: 0, roll: 0, dice: '', params: {}, inventory: vivienne() }
    expect(renderTemplate('{{inventory.sword.title}} / {{inventory.sword.name}}', vars)).toBe('Excalibur / sword')
    expect(renderTemplate('{{inventory.lantern.title}}', vars)).toBe('lantern')
    expect(renderTemplate('{{inventory.sword.description}}', vars)).toBe('A blade of legend')
    expect(renderTemplate('{{inventory.sword.state}} {{inventory.axe.state}}', vars)).toBe('equipped absent')
    expect(renderTemplate('{{inventory.sword.metadata.damage}}', vars)).toBe('2d6')
  })

  it('leaves an absent object\'s fields, and everything with no context, as written', () => {
    const vars = { value: 0, roll: 0, dice: '', params: {}, inventory: vivienne() }
    expect(renderTemplate('{{inventory.axe.title}}', vars)).toBe('{{inventory.axe.title}}')
    expect(renderTemplate('{{inventory.sword.state}}', { ...vars, inventory: null })).toBe('{{inventory.sword.state}}')
  })
})

describe('the $inventory operand', () => {
  it('returns the value only when it has the fallback\'s type', () => {
    const ctx = vivienne()
    expect(resolveInventoryValue({ $inventory: 'sword.metadata.bonus', fallback: 0 }, ctx)).toBe(3)
    expect(resolveInventoryValue({ $inventory: 'sword.metadata.damage', fallback: 0 }, ctx)).toBe(0)
    expect(resolveInventoryValue({ $inventory: 'axe.metadata.bonus', fallback: 1 }, ctx)).toBe(1)
    expect(resolveInventoryValue({ $inventory: 'sword.metadata.bonus', fallback: 1 }, null)).toBe(1)
  })

  it('a whole roll draws the dice an object names, else its fallback', async () => {
    const tool = define({
      name: 'strike',
      description: 'Strike.',
      roll: { $inventory: 'sword.metadata.damage', fallback: '1d4' },
      outcomes: [{ when: true, message: 'With {{inventory.sword.title}}: {{value}}', state: 'info' }],
    })
    const armed = await executeCustomTool(tool, {}, { inventory: vivienne() })
    expect(armed.notation).toBe('2d6')
    expect(armed.message.startsWith('With Excalibur:')).toBe(true)

    const bare = inventoryContextFrom('c', 'chat', { items: [obj('s')], owns: () => true }, new Set(['s']))
    expect((await executeCustomTool(tool, {}, { inventory: bare })).notation).toBe('1d4')
    expect((await executeCustomTool(tool, {}, {})).notation).toBe('1d4')
  })

  it('feeds a comparator operand and a parameter default', async () => {
    const tool = define({
      name: 'parry',
      description: 'Parry.',
      parameters: { bonus: { type: 'number', default: { $inventory: 'sword.metadata.bonus', fallback: 0 } } },
      roll: { min: 0, max: 0, offset: { $param: 'bonus' } },
      outcomes: [
        { when: { gte: { $inventory: 'sword.metadata.bonus', fallback: 99 } }, message: 'held', state: 'success' },
        { when: true, message: 'dropped', state: 'failure' },
      ],
    })
    const result = await executeCustomTool(tool, {}, { inventory: vivienne() })
    expect(result.params.bonus).toBe(3)
    expect(result.message).toBe('held')
  })
})

describe('the gate', () => {
  const gated = define({
    name: 'swing',
    description: 'Swing.',
    availableWhen: { inventory: { sword: { eq: 'equipped' } } },
    outcomes: [{ when: true, message: 'x', state: 'info' }],
  })
  const withheld = define({
    name: 'flee',
    description: 'Flee.',
    withheldWhen: { inventoryCount: { ring: { gte: 2 } } },
    outcomes: [{ when: true, message: 'x', state: 'info' }],
  })

  it('opens for the character carrying the object and not for one without', () => {
    expect(evaluateToolGate(gated, {}, undefined, vivienne()).available).toBe(true)
    expect(evaluateToolGate(gated, {}, undefined, mockInventoryContext([])).available).toBe(false)
  })

  it('a null context keeps availableWhen closed and withheldWhen unsatisfied', () => {
    expect(evaluateToolGate(gated, {}, undefined, null).available).toBe(false)
    expect(evaluateToolGate(withheld, {}, undefined, null).available).toBe(true)
    expect(evaluateToolGate(withheld, {}, undefined, vivienne()).available).toBe(false)
  })
})

describe('the roster loads the inventory lazily', () => {
  const files: Record<string, Record<string, unknown>> = {
    mp: {
      'Tools/swing.tool.json': { name: 'swing', description: 'Swing.', availableWhen: { inventory: { sword: { eq: 'equipped' } } }, outcomes: [{ when: true, message: 'x', state: 'info' }] },
      'Tools/look.tool.json': { name: 'look', description: 'Look.', outcomes: [{ when: true, message: 'x', state: 'info' }] },
    },
  }
  beforeEach(() => {
    jest.clearAllMocks()
    ;(getRepositories as jest.Mock).mockReturnValue({
      docMountPoints: { findById: jest.fn(async (id: string) => ({ id, name: id, enabled: true, mountType: 'database', basePath: '' })) },
      characters: { findById: jest.fn(async () => ({ id: 'c-viv', metadata: {} })) },
    })
    ;(resolveTieredMountPool as jest.Mock).mockResolvedValue({
      characterMountPointId: null, participantMountPointIds: [], groupMountPointIds: [], projectMountPointIds: [], globalMountPointId: 'mp',
    })
    ;(listDatabaseFiles as jest.Mock).mockImplementation(async (mp: string) =>
      Object.keys(files[mp] ?? {}).map((relativePath) => ({ kind: 'file', relativePath, fileName: relativePath.split('/').pop() })))
    ;(readMountFileBytes as jest.Mock).mockImplementation(async (mp: string, path: string) => ({
      bytes: Buffer.from(JSON.stringify(files[mp][path])), mimeType: 'application/json', fileType: 'json',
    }))
  })

  it('loads once, only for a gate naming inventory, and deals by it', async () => {
    ;(loadInventoryContext as jest.Mock).mockResolvedValue({ ...vivienne(), pool: { items: [] }, equippedIds: new Set() })
    const roster = await resolveCustomToolRoster({ userId: 'u', chatId: 'chat-1', characterId: 'c-viv' })
    expect([...roster.tools.keys()].sort()).toEqual(['look', 'swing'])
    expect(loadInventoryContext).toHaveBeenCalledTimes(1)
  })

  it('without a character the gated tool is not listed, and nothing is loaded', async () => {
    const roster = await resolveCustomToolRoster({ userId: 'u', chatId: 'chat-1', characterId: null })
    expect([...roster.tools.keys()]).toEqual(['look'])
    expect(loadInventoryContext).not.toHaveBeenCalled()
  })
})

describe('the bench\'s mock inventory', () => {
  it('reads rows, defaulting counts and absence', () => {
    const ctx = mockInventoryContext([{ ref: 'Sword', state: 'equipped' }, { ref: 'ring', state: 'carried', count: 0 }])
    expect(ctx.state('sword')).toBe('equipped')
    expect(ctx.equippedKinCount('sword')).toBe(1)
    expect(ctx.state('axe')).toBe('absent')
    expect(ctx.item('sword')).toBeNull()
  })
})

describe('the roster description', () => {
  it('names inventory gestures and reads — vocabulary, not odds', () => {
    const { buildRunCustomDescription } = require('@/lib/tools/run-custom-tool')
    const definition = define({
      name: 'loot',
      description: 'Loot the chest.',
      effects: [{ inventory: { action: 'pick_up', items: ['magic bow'] } }, { inventory: { action: 'equip', items: ['Excalibur'] } }],
      outcomes: [
        { when: { inventory: { lantern: { eq: 'equipped' } } }, message: 'lit', state: 'success' },
        { when: true, message: 'dark', state: 'info' },
      ],
    })
    const text = buildRunCustomDescription([{ definition, tier: 'global', mountPointId: 'm', mountName: 'm', definitionPath: 'Tools/loot.tool.json' }])
    expect(text).toContain('Side effects: picks up magic bow; equips Excalibur')
    expect(text).toContain('Reads: your inventory for lantern')
    expect(text).toContain('or what they carry')
  })
})

describe('any-of and inventoryAggregate at run time (pascal-gate-broadening)', () => {
  const when = (w: unknown): When => w as When
  const charm = (state: 'equipped' | 'carried') =>
    inventoryContextFrom('c', 'chat', { items: [obj('charm', { name: 'lucky charm' })], owns: () => true }, new Set(state === 'equipped' ? ['charm'] : []))

  it('an outcome any-of wins on a high roll OR a charm', () => {
    const anyOf = when([{ gte: 0.9 }, { inventory: { 'lucky charm': { eq: 'equipped' } } }])
    expect(matchesWhen(anyOf, { value: 0.95, roll: 0.95, params: {}, inventory: charm('carried') })).toBe(true)
    expect(matchesWhen(anyOf, { value: 0.1, roll: 0.1, params: {}, inventory: charm('equipped') })).toBe(true)
    expect(matchesWhen(anyOf, { value: 0.1, roll: 0.1, params: {}, inventory: charm('carried') })).toBe(false)
    expect(matchesWhen(anyOf, { value: 0.1, roll: 0.1, params: {}, inventory: null })).toBe(false)
  })

  it('short-circuits left to right: a later group is never evaluated once one holds', () => {
    // The second group names an undeclared parameter, which throws if reached.
    const anyOf = when([{ gte: 0.5 }, { params: { ghost: { eq: 1 } } }])
    expect(matchesWhen(anyOf, { value: 0.9, roll: 0.9, params: {} })).toBe(true)
    expect(() => matchesWhen(anyOf, { value: 0.1, roll: 0.1, params: {} })).toThrow(/ghost/)
  })

  it('an effect with an any-of condition fires on either group', async () => {
    const tool = define({
      name: 'flip',
      description: 'Flip.',
      effects: [
        {
          when: [{ outcome: { eq: 'success' } }, { inventory: { 'lucky charm': { eq: 'equipped' } } }],
          target: 'state.lucky',
          value: true,
        },
      ],
      outcomes: [
        { when: { gte: 0.5 }, message: 'up', state: 'success' },
        { when: true, message: 'down', state: 'failure' },
      ],
    })
    const fired = async (inventory: InventoryContext) => {
      const result = await executeCustomTool(tool, {}, { inventory })
      return result.effects?.some((effect) => 'target' in effect) ?? false
    }
    // Run until each branch has been seen; the charm alone must suffice on a low roll.
    const equipped = await fired(charm('equipped'))
    expect(equipped).toBe(true)
    let sawLowWithoutCharm = false
    for (let i = 0; i < 200 && !sawLowWithoutCharm; i++) {
      const result = await executeCustomTool(tool, {}, { inventory: charm('carried') })
      if (result.state === 'failure') {
        sawLowWithoutCharm = true
        expect(result.effects?.some((effect) => 'target' in effect)).toBe(false)
      } else {
        expect(result.effects?.some((effect) => 'target' in effect)).toBe(true)
      }
    }
    expect(sawLowWithoutCharm).toBe(true)
  })

  it('reads an aggregate in a when, with a $param operand', () => {
    const ctx = vivienne()
    const test = when({ inventoryAggregate: { 'equipped.titles': { eq: { $param: 'wanted' } } } })
    expect(matchesWhen(test, { ...subjects(ctx), params: { wanted: 'Excalibur' } })).toBe(true)
    expect(matchesWhen(test, { ...subjects(ctx), params: { wanted: 'lantern' } })).toBe(false)
    expect(matchesWhen(when({ inventoryAggregate: { 'owned.titles': { eq: 'lantern' } } }), subjects(ctx))).toBe(true)
    expect(matchesWhen(when({ inventoryAggregate: { 'equipped.count': { eq: 3 } } }), subjects(ctx))).toBe(true)
    expect(matchesWhen(when({ inventoryAggregate: { 'equipped.metadata.bonus.sum': { eq: 3 } } }), subjects(ctx))).toBe(true)
    expect(matchesWhen(when({ inventoryAggregate: { 'equipped.count': { gte: 0 } } }), subjects(null))).toBe(false)
  })

  it('describes an any-of and an aggregate to the model', () => {
    const { buildRunCustomDescription } = require('@/lib/tools/run-custom-tool')
    const definition = define({
      name: 'jam',
      description: 'Jam the signal.',
      outcomes: [
        {
          when: [
            { gte: 0.5, inventoryAggregate: { 'equipped.metadata.toolVersion.max': { gte: 4 } } },
            { inventoryAggregate: { 'equipped.names': { eq: 'ansible resonator' } } },
          ],
          message: 'Jammed.',
          state: 'success',
        },
        { when: { inventoryAggregate: { 'owned.count': { lt: 1 }, 'owned.metadata.toolAbilities': { ncontains: 'jam' } } }, message: 'Nothing to jam with.', state: 'failure' },
        { when: true, message: 'Static.', state: 'info' },
      ],
    })
    const text: string = buildRunCustomDescription([{ definition, tier: 'general', mountPointId: 'mp' }])
    expect(text).toContain(
      "(value >= 0.5 and your equipped objects' metadata.toolVersion.max >= 4) or your equipped objects' names includes \"ansible resonator\" → success"
    )
    expect(text).toContain(
      "how many objects you own < 1 and your owned objects' metadata.toolAbilities has no entry containing \"jam\" → failure"
    )
    expect(text).toContain('Takes stock of: equipped.metadata.toolVersion.max, equipped.names, owned.count, owned.metadata.toolAbilities')
  })
})

describe('the roster loads the inventory for an aggregate gate, in any group', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    const files: Record<string, unknown> = {
      'Tools/tune.tool.json': {
        name: 'tune',
        description: 'Tune.',
        availableWhen: [{ metadata: { never: { eq: true } } }, { inventoryAggregate: { 'equipped.names': { eq: 'ring' } } }],
        outcomes: [{ when: true, message: 'x', state: 'info' }],
      },
    }
    ;(getRepositories as jest.Mock).mockReturnValue({
      docMountPoints: { findById: jest.fn(async (id: string) => ({ id, name: id, enabled: true, mountType: 'database', basePath: '' })) },
      characters: { findById: jest.fn(async () => ({ id: 'c-viv', metadata: {} })) },
    })
    ;(resolveTieredMountPool as jest.Mock).mockResolvedValue({
      characterMountPointId: null, participantMountPointIds: [], groupMountPointIds: [], projectMountPointIds: [], globalMountPointId: 'mp',
    })
    ;(listDatabaseFiles as jest.Mock).mockImplementation(async () =>
      Object.keys(files).map((relativePath) => ({ kind: 'file', relativePath, fileName: relativePath.split('/').pop() })))
    ;(readMountFileBytes as jest.Mock).mockImplementation(async (_mp: string, path: string) => ({
      bytes: Buffer.from(JSON.stringify(files[path])), mimeType: 'application/json', fileType: 'json',
    }))
  })

  it('deals the tool when the second line holds', async () => {
    ;(loadInventoryContext as jest.Mock).mockResolvedValue(vivienne())
    const roster = await resolveCustomToolRoster({ userId: 'u', chatId: 'chat-1', characterId: 'c-viv' })
    expect([...roster.tools.keys()]).toEqual(['tune'])
    expect(loadInventoryContext).toHaveBeenCalledTimes(1)
  })
})
