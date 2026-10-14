/**
 * Document-store naming rules (bug 186): one case-insensitive namespace, each
 * live vault named after its character, every unlinked vault retired to
 * "<Name> Version <timestamp> Store".
 *
 * @jest-environment node
 */

import {
  characterVaultName,
  planStoreNames,
  retiredVaultName,
  storeNameTimestamp,
  vaultBaseName,
  type StoreNameRow,
  type VaultOwnerRow,
} from '@/lib/mount-index/store-names'

const store = (id: string, name: string, createdAt: string, storeType = 'character'): StoreNameRow => ({
  id,
  name,
  storeType,
  createdAt,
})
const character = (id: string, name: string, vault: string | null, createdAt = '2026-01-01T00:00:00.000Z'): VaultOwnerRow => ({
  id,
  name,
  characterDocumentMountPointId: vault,
  createdAt,
})

/** Apply a plan so a test can check the end state and run a second pass. */
function apply(stores: StoreNameRow[], characters: VaultOwnerRow[]) {
  const renames = planStoreNames(stores, characters)
  const after = stores.map((s) => ({ ...s, name: renames.find((r) => r.id === s.id)?.to ?? s.name }))
  return { renames, after, names: Object.fromEntries(after.map((s) => [s.id, s.name])) }
}

describe('name helpers', () => {
  it('builds and parses vault names', () => {
    expect(characterVaultName(' Tester ')).toBe('Tester Character Vault')
    expect(vaultBaseName('Tester Character Vault')).toBe('Tester')
    expect(vaultBaseName('tester character vault (3)')).toBe('tester')
    expect(vaultBaseName('Lorian Character Vault (2) (2)')).toBe('Lorian')
    expect(vaultBaseName('Tester Version 2026-10-09T164506Z Store')).toBeNull()
    expect(vaultBaseName('Group Files: Aeronauts Club')).toBeNull()
  })

  it('stamps a retired vault without colons', () => {
    expect(storeNameTimestamp('2026-10-09T16:45:06.123Z')).toBe('2026-10-09T164506Z')
    expect(retiredVaultName('Tester', '2026-10-09T16:45:06.123Z')).toBe('Tester Version 2026-10-09T164506Z Store')
  })
})

describe('planStoreNames', () => {
  it('names the live vault plainly and retires the old ones (the V4test case)', () => {
    const stores = [
      store('old-1', 'Lorian Character Vault', '2026-09-01T10:00:00.000Z'),
      store('old-2', 'Lorian Character Vault (2)', '2026-09-15T10:00:00.000Z'),
      store('live', 'Lorian Character Vault (3)', '2026-10-01T10:00:00.000Z'),
      store('general', 'Quilltap General', '2026-01-01T00:00:00.000Z', 'documents'),
    ]
    const { names, after } = apply(stores, [character('lorian', 'Lorian', 'live')])

    expect(names).toEqual({
      'old-1': 'Lorian Version 2026-09-01T100000Z Store',
      'old-2': 'Lorian Version 2026-09-15T100000Z Store',
      live: 'Lorian Character Vault',
      general: 'Quilltap General',
    })
    // Idempotent.
    expect(planStoreNames(after, [character('lorian', 'Lorian', 'live')])).toEqual([])
  })

  it('follows a character rename', () => {
    const { names } = apply([store('v', 'Tester Character Vault', '2026-01-01T00:00:00.000Z')], [character('t', 'Testy', 'v')])
    expect(names.v).toBe('Testy Character Vault')
  })

  it('retires the vault of a deleted character', () => {
    const { renames } = apply([store('v', 'Tester Character Vault', '2026-03-04T05:06:07.000Z')], [])
    expect(renames).toEqual([
      { id: 'v', from: 'Tester Character Vault', to: 'Tester Version 2026-03-04T050607Z Store', reason: 'retired-vault' },
    ])
  })

  it('lets the holder of the plain name keep it when two live characters share a name', () => {
    const stores = [
      store('copy', 'Tester Character Vault (2)', '2026-10-09T00:00:00.000Z'),
      store('orig', 'Tester Character Vault', '2026-10-09T00:00:00.000Z'),
    ]
    const characters = [
      character('t-copy', 'Tester', 'copy', '2026-01-01T00:00:00.000Z'),
      character('t-orig', 'Tester', 'orig', '2026-06-01T00:00:00.000Z'),
    ]
    expect(planStoreNames(stores, characters)).toEqual([])
  })

  it('gives a namesake the lowest free suffix, whatever it arrived with', () => {
    const stores = [
      store('orig', 'Lorian Character Vault', '2026-01-01T00:00:00.000Z'),
      store('copy', 'Lorian Character Vault (3)', '2026-10-09T00:00:00.000Z'),
      store('orphan', 'Lorian Character Vault (2) (2)', '2026-08-13T19:40:40.000Z'),
    ]
    const characters = [
      character('a', 'Lorian', 'orig', '2026-01-01T00:00:00.000Z'),
      character('b', 'Lorian', 'copy', '2026-10-09T00:00:00.000Z'),
    ]
    expect(apply(stores, characters).names).toEqual({
      orig: 'Lorian Character Vault',
      copy: 'Lorian Character Vault (2)',
      orphan: 'Lorian Version 2026-08-13T194040Z Store',
    })
  })

  it('gives the older character the plain name when neither holds it', () => {
    const stores = [
      store('a', 'Old Name Character Vault', '2026-01-01T00:00:00.000Z'),
      store('b', 'Other Character Vault', '2026-01-01T00:00:00.000Z'),
    ]
    const characters = [
      character('young', 'Tester', 'a', '2026-06-01T00:00:00.000Z'),
      character('old', 'Tester', 'b', '2026-01-01T00:00:00.000Z'),
    ]
    expect(apply(stores, characters).names).toEqual({ a: 'Tester Character Vault (2)', b: 'Tester Character Vault' })
  })

  it('leaves alone an unlinked vault a character without a vault could still adopt', () => {
    const stores = [store('v', 'Riya Character Vault', '2026-01-01T00:00:00.000Z')]
    expect(planStoreNames(stores, [character('r', 'Riya', null)])).toEqual([])
  })

  it('leaves alone an unlinked vault the operator renamed', () => {
    expect(planStoreNames([store('v', "Riya's old things", '2026-01-01T00:00:00.000Z')], [])).toEqual([])
  })

  it('suffixes colliding stores, oldest first, and puts a live vault ahead of any other store', () => {
    const stores = [
      store('docs-old', 'Notes', '2026-01-01T00:00:00.000Z', 'documents'),
      store('docs-new', 'NOTES', '2026-02-01T00:00:00.000Z', 'documents'),
      store('impostor', 'Tester Character Vault', '2025-01-01T00:00:00.000Z', 'documents'),
      store('vault', 'Something Else', '2026-01-01T00:00:00.000Z'),
    ]
    const { names, after } = apply(stores, [character('t', 'Tester', 'vault')])
    expect(names).toEqual({
      'docs-old': 'Notes',
      'docs-new': 'NOTES (2)',
      impostor: 'Tester Character Vault (2)',
      vault: 'Tester Character Vault',
    })
    const lowered = after.map((s) => s.name.toLowerCase())
    expect(new Set(lowered).size).toBe(lowered.length)
  })
})
