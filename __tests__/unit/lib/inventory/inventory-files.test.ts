/**
 * @jest-environment node
 *
 * Inventory files — the parser, the predicate pair, the serialiser and the
 * object shape rules (spec §5.2–5.3).
 */

jest.mock('@/lib/logger', () => {
  const mock = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), child: jest.fn() }
  mock.child.mockReturnValue(mock)
  return { logger: mock }
})
jest.mock('@/lib/repositories/factory', () => ({ getRepositories: jest.fn() }))

import { logger } from '@/lib/logger'
import {
  isInventoryItemDocument,
  isInventoryItemDocumentPath,
  parseInventoryItemFile,
} from '@/lib/database/repositories/vault-overlay/inventory-readers'
import { serializeInventoryRecord } from '@/lib/database/repositories/vault-overlay/inventory-writes'
import { createInventorySchema, inventoryShapeIssues, updateInventorySchema } from '@/lib/schemas/inventory.types'

const SWORD_ID = '0b0b5f3e-6a5e-4d3c-9a1b-2c3d4e5f6a7b'
const BOW_ID = '1c1c5f3e-6a5e-4d3c-9a1b-2c3d4e5f6a7b'
const T = '2026-10-18T12:00:00.000Z'

const doc = (relativePath: string, content: unknown) => ({
  relativePath,
  content: typeof content === 'string' ? content : JSON.stringify(content),
  mountPointId: 'mp-1',
})

describe('isInventoryItemDocumentPath', () => {
  it('accepts .json at any depth under Inventory/ and nothing else', () => {
    expect(isInventoryItemDocumentPath('Inventory/sword.json')).toBe(true)
    expect(isInventoryItemDocumentPath('inventory/Weapons/Edged/sword.JSON')).toBe(true)
    expect(isInventoryItemDocumentPath('Inventory/notes.md')).toBe(false)
    expect(isInventoryItemDocumentPath('Inventory/images/abc/meta.json')).toBe(false)
    expect(isInventoryItemDocumentPath('Wardrobe/sword.json')).toBe(false)
    expect(isInventoryItemDocumentPath('Inventory/')).toBe(false)
  })
})

describe('parseInventoryItemFile', () => {
  beforeEach(() => jest.clearAllMocks())

  it('fills a standalone object in whole and derives the folder from the path', () => {
    const record = parseInventoryItemFile(
      doc('Inventory/Weapons/Excalibur.json', { id: SWORD_ID, name: 'sword', title: 'Excalibur', createdAt: T, updatedAt: T }),
    )
    expect(record).toMatchObject({
      id: SWORD_ID,
      kind: 'item',
      name: 'sword',
      title: 'Excalibur',
      equippedByDefault: false,
      maxEquipped: 1,
      canCopy: false,
      isArchetype: false,
      parentId: null,
      itemIds: [],
      metadata: {},
      folder: 'Weapons',
      fileStem: 'Excalibur',
    })
  })

  it('keeps an instance sparse: nothing it omits is defaulted', () => {
    const record = parseInventoryItemFile(
      doc('Inventory/Heartseeker.json', { id: BOW_ID, parentId: SWORD_ID, title: 'Heartseeker', createdAt: T, updatedAt: T }),
    )
    expect(record).toEqual({
      id: BOW_ID,
      parentId: SWORD_ID,
      title: 'Heartseeker',
      createdAt: T,
      updatedAt: T,
      folder: '',
      fileStem: 'Heartseeker',
    })
  })

  it('skips (with a warn) bad JSON, a missing or non-UUID id, and a shape violation', () => {
    expect(parseInventoryItemFile(doc('Inventory/a.json', '{not json'))).toBeNull()
    expect(parseInventoryItemFile(doc('Inventory/b.json', { name: 'x' }))).toBeNull()
    expect(parseInventoryItemFile(doc('Inventory/c.json', { id: 'sword-1', name: 'x' }))).toBeNull()
    expect(parseInventoryItemFile(doc('Inventory/d.json', { id: SWORD_ID, name: 'kit', kind: 'kit', itemIds: [] }))).toBeNull()
    expect(parseInventoryItemFile(doc('Inventory/e.json', { id: SWORD_ID, parentId: BOW_ID, isArchetype: true }))).toBeNull()
    expect(logger.warn).toHaveBeenCalledTimes(5)
  })

  it('drops unknown top-level keys with a warn; metadata is where free-form data lives', () => {
    const record = parseInventoryItemFile(
      doc('Inventory/x.json', { id: SWORD_ID, name: 'sword', weight: 3, metadata: { weight: 3 }, createdAt: T, updatedAt: T }),
    )
    expect(record).not.toHaveProperty('weight')
    expect(record?.metadata).toEqual({ weight: 3 })
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('outside metadata'),
      expect.objectContaining({ keys: ['weight'] }),
    )
  })

  it('falls back to the document timestamps for a hand-written file', () => {
    const record = parseInventoryItemFile({ ...doc('Inventory/x.json', { id: SWORD_ID, name: 'sword' }), createdAt: T, updatedAt: T })
    expect(record).toMatchObject({ createdAt: T, updatedAt: T })
  })
})

describe('isInventoryItemDocument', () => {
  it('owns exactly the files that parse; a note or a broken file is never swept', () => {
    expect(isInventoryItemDocument(doc('Inventory/x.json', { id: SWORD_ID, name: 'sword', createdAt: T, updatedAt: T }))).toBe(true)
    expect(isInventoryItemDocument(doc('Inventory/x.json', '{"id": "nope"}'))).toBe(false)
    expect(isInventoryItemDocument(doc('Inventory/readme.md', '# notes'))).toBe(false)
    expect(logger.warn).not.toHaveBeenCalled()
  })
})

describe('serializeInventoryRecord round-trip', () => {
  it('writes known keys only, never folder or fileStem, and parses back to the same record', () => {
    const parsed = parseInventoryItemFile(
      doc('Inventory/Rings/ring.json', {
        id: SWORD_ID,
        name: 'signet ring',
        description: 'Proves the bearer is of House Vane.',
        equippedByDefault: true,
        metadata: { house: 'Vane' },
        createdAt: T,
        updatedAt: T,
      }),
    )!
    const text = serializeInventoryRecord(parsed)
    expect(text.endsWith('\n')).toBe(true)
    const json = JSON.parse(text)
    expect(json).not.toHaveProperty('folder')
    expect(json).not.toHaveProperty('fileStem')
    expect(Object.keys(json)[0]).toBe('id')
    const again = parseInventoryItemFile(doc('Inventory/Rings/ring.json', text))
    expect(again).toEqual(parsed)
  })

  it('keeps an instance sparse on the way out', () => {
    const parsed = parseInventoryItemFile(doc('Inventory/i.json', { id: BOW_ID, parentId: SWORD_ID, createdAt: T, updatedAt: T }))!
    expect(JSON.parse(serializeInventoryRecord(parsed))).toEqual({ id: BOW_ID, parentId: SWORD_ID, createdAt: T, updatedAt: T })
  })
})

describe('object shape rules', () => {
  it('names each problem', () => {
    expect(inventoryShapeIssues({ isArchetype: true, parentId: SWORD_ID })).toHaveLength(1)
    expect(inventoryShapeIssues({ isArchetype: true, kind: 'kit', itemIds: [SWORD_ID] })).toHaveLength(1)
    expect(inventoryShapeIssues({ kind: 'kit', itemIds: [] })).toHaveLength(1)
    expect(inventoryShapeIssues({ kind: 'item', itemIds: [SWORD_ID] })).toHaveLength(1)
    expect(inventoryShapeIssues({ kind: 'kit', itemIds: [SWORD_ID] })).toEqual([])
  })

  it('the create body refuses a broken shape and a parentId (instances come from instantiate)', () => {
    expect(createInventorySchema.safeParse({ name: 'kit', kind: 'kit' }).success).toBe(false)
    expect(createInventorySchema.safeParse({ name: 'bow', parentId: SWORD_ID }).success).toBe(false)
    expect(createInventorySchema.safeParse({ name: 'bow', isArchetype: true }).success).toBe(true)
  })

  it('the update body defaults nothing, so an omitted field stays omitted', () => {
    expect(updateInventorySchema.parse({ title: 'Heartseeker' })).toEqual({ title: 'Heartseeker' })
    expect(updateInventorySchema.parse({ description: null })).toEqual({ description: null })
  })
})
