import { describe, it, expect } from '@jest/globals'
import {
  memoryArchivedLabel,
  formatSearchScriptoriumResults,
} from '@/lib/tools/handlers/search-scriptorium-handler'

describe('search tool — archived (cold) memory labelling', () => {
  it('labels a superseded cold row with its digest id', () => {
    expect(memoryArchivedLabel({ tier: 'cold', supersededById: 'dig-9' })).toBe('(archived — superseded by dig-9)')
  })
  it('labels a cold row with no digest plainly', () => {
    expect(memoryArchivedLabel({ tier: 'cold', supersededById: null })).toBe('(archived)')
  })
  it('does not label hot rows', () => {
    expect(memoryArchivedLabel({ tier: 'hot', supersededById: null })).toBeUndefined()
    expect(memoryArchivedLabel({})).toBeUndefined()
  })
  it('prints the label where the model reads the result header', () => {
    const out = formatSearchScriptoriumResults([{
      content: 'old shard', sourceType: 'memory', relevanceScore: 0.8,
      metadata: { memoryId: 'm1', summary: 's', importance: 0.5, archivedLabel: '(archived — superseded by dig-9)' },
    }])
    expect(out).toContain('[Result 1 - Memory (archived — superseded by dig-9)]')
  })
})
