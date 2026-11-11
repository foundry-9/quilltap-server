/**
 * @jest-environment node
 *
 * The setup wizard's Validate button used to POST a new `api_keys` row before
 * testing it, on every click: a mistyped key stayed stored, each retry added
 * another "<Provider> (Setup Wizard)" row, and in settings mode an untouched
 * field stored the literal mask "********" as a key. Keys are now tested
 * unsaved, and stored once per provider per wizard run.
 */

import { planKeyValidation } from '@/components/setup-wizard/key-validation'
import { EXISTING_KEY_MASK } from '@/components/setup-wizard/useProviderWizardState'

const base = { requiresKey: true, key: '', apiKeyId: null, storedByWizard: false }

describe('planKeyValidation', () => {
  it('tests the connection alone for a provider that takes no key', () => {
    expect(planKeyValidation({ ...base, requiresKey: false, key: 'ignored' })).toEqual({ kind: 'no-key' })
  })

  it('reports an empty field', () => {
    expect(planKeyValidation({ ...base, key: '   ' })).toEqual({ kind: 'missing' })
  })

  it('tests a typed key unsaved and stores it as a new row the first time', () => {
    expect(planKeyValidation({ ...base, key: ' sk-test ' })).toEqual({ kind: 'new', key: 'sk-test', replaceId: null })
  })

  it('replaces the row this wizard run stored rather than adding another', () => {
    expect(planKeyValidation({ ...base, key: 'sk-second', apiKeyId: 'k1', storedByWizard: true }))
      .toEqual({ kind: 'new', key: 'sk-second', replaceId: 'k1' })
  })

  it('never overwrites a key the operator already had', () => {
    expect(planKeyValidation({ ...base, key: 'sk-new', apiKeyId: 'existing', storedByWizard: false }))
      .toEqual({ kind: 'new', key: 'sk-new', replaceId: null })
  })

  it('tests an existing key by id when the field still shows the mask', () => {
    expect(planKeyValidation({ ...base, key: EXISTING_KEY_MASK, apiKeyId: 'existing' }))
      .toEqual({ kind: 'stored', apiKeyId: 'existing' })
  })

  it('never stores the mask itself as a key', () => {
    expect(planKeyValidation({ ...base, key: EXISTING_KEY_MASK, apiKeyId: null })).toEqual({ kind: 'missing' })
  })
})
