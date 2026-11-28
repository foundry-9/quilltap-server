/**
 * #284 — the server sends `imported` as a counts object, so the success
 * message's "(N entities imported)" never showed.
 */

import { totalImportedCount } from '@/components/settings/ai-import/hooks/useAIImport'

jest.mock('@/lib/hooks/use-profiles', () => ({ useConnectionProfilesQuery: jest.fn() }))

describe('totalImportedCount', () => {
  it('sums a counts object', () => {
    expect(totalImportedCount({ characters: 1, memories: 5, chats: 2 })).toBe(8)
  })

  it('ignores non-numeric entries', () => {
    expect(totalImportedCount({ characters: 1, note: 'x', bad: Number.NaN })).toBe(1)
  })

  it('accepts a bare number and treats nothing as zero', () => {
    expect(totalImportedCount(3)).toBe(3)
    expect(totalImportedCount(undefined)).toBe(0)
    expect(totalImportedCount(null)).toBe(0)
  })
})
