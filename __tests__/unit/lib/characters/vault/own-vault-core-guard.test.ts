/**
 * @jest-environment node
 *
 * The own-vault core guard: an opaque character's `doc_*` tools cannot reach
 * the core folders of their own vault — `Atlas/` among them, like `Wardrobe/`
 * and `Inventory/` (atlas spec §5.11).
 */

import {
  CHARACTER_VAULT_CORE_FOLDERS,
  isOwnVaultCorePath,
  isOwnVaultEntryHidden,
} from '@/lib/characters/vault/core-guard'

it('lists Atlas among the core folders', () => {
  expect(CHARACTER_VAULT_CORE_FOLDERS).toEqual(expect.arrayContaining(['Wardrobe', 'Inventory', 'Atlas']))
})

it.each(['Atlas', 'Atlas/Convertible.md', 'atlas/Vehicles/Car.md', 'Atlas/images/x/pic.webp'])(
  'refuses a file under %s',
  (p) => {
    expect(isOwnVaultCorePath(p, 'file')).toBe(true)
  },
)

it('hides the Atlas folder from a root listing', () => {
  expect(isOwnVaultEntryHidden('Atlas', 'folder')).toBe(true)
})

it('leaves an ordinary folder alone', () => {
  expect(isOwnVaultCorePath('Knowledge/Atlas notes.md', 'file')).toBe(false)
})
