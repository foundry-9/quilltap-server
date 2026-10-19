/**
 * applyCustomToolEffects partitions a run's resolved effects three ways —
 * writes, then wardrobe gestures, then inventory gestures — and merges the
 * applied lists back into effect order.
 */

jest.mock('@/lib/logger', () => {
  const mock = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), child: jest.fn() }
  mock.child.mockReturnValue(mock)
  return { logger: mock }
})
jest.mock('@/lib/repositories/factory', () => ({ getRepositories: jest.fn(() => ({})) }))
jest.mock('@/lib/mount-index/general-state', () => ({ writeGeneralState: jest.fn() }))
jest.mock('@/lib/pascal/wardrobe-effects', () => ({ applyWardrobeEffects: jest.fn() }))
jest.mock('@/lib/pascal/inventory-effects', () => ({ applyInventoryEffects: jest.fn() }))

import { applyCustomToolEffects } from '@/lib/pascal/side-effects'
import { applyWardrobeEffects } from '@/lib/pascal/wardrobe-effects'
import { applyInventoryEffects } from '@/lib/pascal/inventory-effects'

it('runs wardrobe then inventory gestures and merges by index', async () => {
  const order: string[] = []
  ;(applyWardrobeEffects as jest.Mock).mockImplementation(async () => {
    order.push('wardrobe')
    return [{ index: 2, applied: { target: 'wardrobe.wear', next: {} } }]
  })
  ;(applyInventoryEffects as jest.Mock).mockImplementation(async (params) => {
    order.push('inventory')
    expect(params.gestures).toEqual([{ index: 0, inventory: { action: 'equip', items: ['lantern'] } }])
    return [{ index: 0, applied: { target: 'inventory.equip', next: {} } }]
  })
  const applied = await applyCustomToolEffects({
    userId: 'u',
    chatId: 'c',
    toolName: 't',
    effects: [
      { index: 0, inventory: { action: 'equip', items: ['lantern'] } },
      { index: 1, skipped: 'condition did not hold' },
      { index: 2, wardrobe: { action: 'wear', items: ['Hat'] } },
    ],
    cascade: null,
    characterId: 'char',
    metadataSnapshot: {},
  })
  expect(order).toEqual(['wardrobe', 'inventory'])
  expect(applied.map((a) => a.target)).toEqual(['inventory.equip', 'wardrobe.wear'])
})
