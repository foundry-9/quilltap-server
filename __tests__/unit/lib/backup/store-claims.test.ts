/**
 * The restore's store claim map (bug 185): an entity keeps the archived store
 * its pointer names when the archive carries it, the first claimant wins, and
 * only a positive kind mismatch is refused.
 */

import { makeStoreClaimMap } from '@/lib/backup/restore/store-claims'

describe('makeStoreClaimMap', () => {
  const claims = () =>
    makeStoreClaimMap([
      { id: 'vault', storeType: 'character' },
      { id: 'docs', storeType: 'documents' },
      { id: 'untyped', storeType: null },
    ])

  it('binds an entity to the carried store its pointer names', () => {
    const map = claims()
    expect(map.claim('character', 'c1', 'vault')).toEqual({ bound: true, mountPointId: 'vault' })
    expect(map.claim('project', 'p1', 'docs')).toEqual({ bound: true, mountPointId: 'docs' })
  })

  it('falls through when there is no pointer or the store is not carried', () => {
    const map = claims()
    expect(map.claim('character', 'c1', null)).toEqual({ bound: false, reason: 'no-pointer' })
    expect(map.claim('group', 'g1', 'elsewhere')).toEqual({ bound: false, reason: 'not-carried' })
  })

  it('refuses a vault to a project or group, and a documents store to a character', () => {
    const map = claims()
    expect(map.claim('group', 'g1', 'vault')).toEqual({ bound: false, reason: 'wrong-kind' })
    expect(map.claim('character', 'c1', 'docs')).toEqual({ bound: false, reason: 'wrong-kind' })
  })

  it('accepts a store whose kind the archive never recorded', () => {
    expect(claims().claim('character', 'c1', 'untyped')).toEqual({ bound: true, mountPointId: 'untyped' })
    expect(claims().claim('project', 'p1', 'untyped')).toEqual({ bound: true, mountPointId: 'untyped' })
  })

  it('gives a store to the first claimant only, across entity kinds', () => {
    const map = claims()
    expect(map.claim('project', 'p1', 'untyped').bound).toBe(true)
    expect(map.claim('character', 'c1', 'untyped')).toEqual({
      bound: false,
      reason: 'already-claimed',
      claimedBy: { kind: 'project', id: 'p1' },
    })
  })
})
