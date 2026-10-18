/**
 * @jest-environment node
 *
 * Prompt and image delivery (spec §5.7) over the in-memory store: the
 * trailing section names what is carried by its `description`, kits never
 * appear, an object with only an `imageDescription` is silent to the model
 * but depicted, and setting things down removes both.
 */

jest.mock('@/lib/logger', () => {
  const mock = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), child: jest.fn() }
  mock.child.mockReturnValue(mock)
  return { logger: mock }
})
jest.mock('@/lib/repositories/factory', () => require('@/__tests__/helpers/inventory-fake-store').factoryModule())
jest.mock('@/lib/mount-index/database-store', () => require('@/__tests__/helpers/inventory-fake-store').databaseStoreModule())
jest.mock('@/lib/mount-index/folder-paths', () => require('@/__tests__/helpers/inventory-fake-store').folderPathsModule())
jest.mock('@/lib/instance-settings', () => require('@/__tests__/helpers/inventory-fake-store').instanceSettingsModule())
jest.mock('@/lib/mount-index/tiered-mount-pool', () => require('@/__tests__/helpers/inventory-fake-store').tieredPoolModule())
jest.mock('@/lib/mount-index/ensure-owner-store', () => ({ ensureOwnerOfficialStore: jest.fn() }))
jest.mock('@/lib/inventory/item-images', () => ({ cleanupInventoryItemImages: jest.fn(async () => undefined) }))
jest.mock('@/lib/realtime/bus', () => ({ publishRealtime: jest.fn() }))
jest.mock('@/lib/services/pascal/writer', () => ({ postPascalInventoryChange: jest.fn(async () => null) }))
jest.mock('@/lib/wardrobe/outfit-change-effects', () => ({ refreshAvatarForAppearance: jest.fn(async () => undefined) }))

import { addCharacter, getFakeRepos, resetStore, state } from '@/__tests__/helpers/inventory-fake-store'
import { resolveInventoryLocation, type InventoryLocation } from '@/lib/inventory/location'
import { createInventoryItem } from '@/lib/inventory/item-mutations'
import { equipItems, unequipItems } from '@/lib/inventory/equip'
import { buildInventorySection, renderInventorySection } from '@/lib/inventory/prompt-section'
import { loadCarryingPhrase } from '@/lib/inventory/image-description'
import type { InventoryCreateBody } from '@/lib/schemas/inventory.types'

const repos = () => getFakeRepos() as never
const CTX = { userId: 'user-1', provenance: 'operator' as const, announce: false }
const body = (fields: Partial<InventoryCreateBody>): InventoryCreateBody =>
  ({ kind: 'item', equippedByDefault: false, maxEquipped: 1, canCopy: false, isArchetype: false, parentId: null, itemIds: [], metadata: {}, ...fields }) as InventoryCreateBody

let viv: InventoryLocation
const chat = () => state.chats.get('chat-1')!

beforeEach(async () => {
  resetStore()
  addCharacter('c-viv', 'Vivienne')
  state.chats.set('chat-1', { id: 'chat-1', projectId: null, participants: [{ id: 'p', characterId: 'c-viv', status: 'active' }] })
  viv = (await resolveInventoryLocation('character', 'c-viv', repos(), 'user-1')) as InventoryLocation
})

describe('the trailing section', () => {
  it('renders title-first lines sorted by label, and nothing for kits or the undescribed', () => {
    const item = (fields: Record<string, unknown>) => ({ kind: 'item', isArchetype: false, itemIds: [], ...fields }) as never
    expect(renderInventorySection([
      item({ name: 'signet ring', description: 'Proves the bearer is of House Vane.' }),
      item({ name: 'sword', title: 'Excalibur', description: 'A longsword whose blade is never dulled.' }),
      item({ name: 'lamp', imageDescription: 'a brass lamp' }),
      item({ name: 'kit', kind: 'kit', description: 'never shown' }),
    ])).toBe(
      '## Carried and equipped\n- Excalibur (sword): A longsword whose blade is never dulled.\n- signet ring: Proves the bearer is of House Vane.',
    )
    expect(renderInventorySection([item({ name: 'lamp', imageDescription: 'a brass lamp' })])).toBeNull()
  })

  it('a carried sword with a description reaches the model; an image-only one only the pictures; setting down removes both', async () => {
    const sword = await createInventoryItem(repos(), viv, body({
      name: 'sword', title: 'Excalibur', description: 'Never dulled.', imageDescription: 'a longsword with a jewelled pommel',
    }))
    const ring = await createInventoryItem(repos(), viv, body({ name: 'signet ring', imageDescription: 'a brass signet ring on the left hand' }))

    expect(await buildInventorySection({ chat: chat(), characterId: 'c-viv', repos: repos() })).toBeNull()
    expect(await loadCarryingPhrase(repos(), chat(), 'c-viv')).toBeNull()

    await equipItems(repos(), chat(), 'c-viv', [ring.id], CTX)
    expect(await buildInventorySection({ chat: chat(), characterId: 'c-viv', repos: repos() })).toBeNull()
    expect(await loadCarryingPhrase(repos(), chat(), 'c-viv')).toBe('carrying a brass signet ring on the left hand')

    await equipItems(repos(), chat(), 'c-viv', [sword.id], CTX)
    expect(await buildInventorySection({ chat: chat(), characterId: 'c-viv', repos: repos() })).toBe(
      '## Carried and equipped\n- Excalibur (sword): Never dulled.',
    )
    expect(await loadCarryingPhrase(repos(), chat(), 'c-viv')).toBe(
      'carrying a longsword with a jewelled pommel, a brass signet ring on the left hand',
    )

    await unequipItems(repos(), chat(), 'c-viv', [sword.id, ring.id], CTX)
    expect(await buildInventorySection({ chat: chat(), characterId: 'c-viv', repos: repos() })).toBeNull()
    expect(await loadCarryingPhrase(repos(), chat(), 'c-viv')).toBeNull()
  })
})
