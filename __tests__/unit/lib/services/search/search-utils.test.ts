/**
 * Unit Tests for Search Utilities
 *
 * Tests for search-utils.ts functions including query parsing,
 * content matching, snippet generation, and search prioritization.
 */

import {
  createSnippet,
  parseQueryTerms,
  getMatchPriority,
  matchesQueryMultiTerm,
  findMatchedField,
  createWithinTypeSorter,
  type MatchPriority,
} from '@/lib/services/search/search-utils'

// Mock logger
jest.mock('@/lib/logger', () => ({
  logger: {
    child: () => ({
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }),
  },
}))

describe('parseQueryTerms', () => {
  it('should parse simple query into terms', () => {
    const result = parseQueryTerms('hello world')
    expect(result).toEqual(['hello', 'world'])
  })

  it('should convert to lowercase', () => {
    const result = parseQueryTerms('Hello World')
    expect(result).toEqual(['hello', 'world'])
  })

  it('should filter out single-character terms', () => {
    const result = parseQueryTerms('a bb c dd')
    expect(result).toEqual(['bb', 'dd'])
  })

  it('should handle multiple spaces', () => {
    const result = parseQueryTerms('hello    world')
    expect(result).toEqual(['hello', 'world'])
  })

  it('should handle empty query', () => {
    const result = parseQueryTerms('')
    expect(result).toEqual([])
  })

  it('should handle whitespace-only query', () => {
    const result = parseQueryTerms('   ')
    expect(result).toEqual([])
  })

  it('should handle special characters', () => {
    const result = parseQueryTerms('hello-world test_case')
    expect(result).toEqual(['hello-world', 'test_case'])
  })

  it('should handle query with tabs and newlines', () => {
    const result = parseQueryTerms('hello\tworld\ntest')
    expect(result).toEqual(['hello', 'world', 'test'])
  })
})

describe('createSnippet', () => {
  it('should create snippet around query match', () => {
    const content = 'The quick brown fox jumps over the lazy dog'
    const result = createSnippet(content, 'fox', 100)
    expect(result).toContain('fox')
    expect(result.length).toBeLessThanOrEqual(107) // 100 + "..." prefix/suffix
  })

  it('should handle empty content', () => {
    const result = createSnippet('', 'query', 100)
    expect(result).toBe('')
  })

  it('should truncate long content when no match', () => {
    const content = 'a'.repeat(200)
    const result = createSnippet(content, 'notfound', 100)
    expect(result).toHaveLength(103) // 100 + "..."
    expect(result.endsWith('...')).toBe(true)
  })

  it('should add prefix ellipsis when match is not at start', () => {
    const content = 'The quick brown fox jumps over the lazy dog'
    const result = createSnippet(content, 'lazy', 100)
    expect(result.startsWith('...')).toBe(true)
  })

  it('should add suffix ellipsis when match is not at end', () => {
    const content = 'The quick brown fox jumps over the lazy dog and continues for a very long time with more text'
    const result = createSnippet(content, 'quick', 50)
    expect(result.endsWith('...')).toBe(true)
  })

  it('should be case insensitive', () => {
    const content = 'The Quick Brown Fox'
    const result = createSnippet(content, 'quick', 100)
    expect(result).toContain('Quick')
  })

  it('should return short content as-is when shorter than maxLength', () => {
    const content = 'Short text'
    const result = createSnippet(content, 'notfound', 100)
    expect(result).toBe('Short text')
  })

  it('should handle match at start of content', () => {
    const content = 'Hello world, this is a test'
    const result = createSnippet(content, 'Hello', 100)
    expect(result).toBe('Hello world, this is a test')
  })

  it('should handle match at end of content', () => {
    const content = 'This is a test'
    const result = createSnippet(content, 'test', 100)
    expect(result).toContain('test')
  })

  it('should use default maxLength of 100', () => {
    const content = 'a'.repeat(200)
    const result = createSnippet(content, 'notfound')
    expect(result).toHaveLength(103)
  })
})

describe('getMatchPriority', () => {
  const terms = parseQueryTerms('hello world')

  it('should return priority 0 for exact phrase match', () => {
    const result = getMatchPriority('hello world is here', 'hello world', terms)
    expect(result).toBe(0)
  })

  it('should return priority 1 for all terms match (AND)', () => {
    const result = getMatchPriority('world hello there', 'hello world', terms)
    expect(result).toBe(1)
  })

  it('should return priority 2 for single term match', () => {
    const result = getMatchPriority('hello there', 'hello world', terms)
    expect(result).toBe(2)
  })

  it('should return priority 3 for no match', () => {
    const result = getMatchPriority('foo bar', 'hello world', terms)
    expect(result).toBe(3)
  })

  it('should be case insensitive', () => {
    const result = getMatchPriority('HELLO WORLD', 'hello world', terms)
    expect(result).toBe(0)
  })

  it('should handle null value', () => {
    const result = getMatchPriority(null, 'hello world', terms)
    expect(result).toBe(3)
  })

  it('should handle undefined value', () => {
    const result = getMatchPriority(undefined, 'hello world', terms)
    expect(result).toBe(3)
  })

  it('should handle empty string', () => {
    const result = getMatchPriority('', 'hello world', terms)
    expect(result).toBe(3)
  })

  it('should handle single term query', () => {
    const singleTerms = parseQueryTerms('hello')
    const result = getMatchPriority('hello world', 'hello', singleTerms)
    expect(result).toBe(0)
  })

  it('should prioritize exact match over all terms match', () => {
    const value = 'hello world'
    const exact = getMatchPriority(value, 'hello world', terms)
    const allTerms = getMatchPriority('world and hello', 'hello world', terms)
    expect(exact).toBeLessThan(allTerms)
  })
})

describe('matchesQueryMultiTerm', () => {
  const terms = parseQueryTerms('hello world')

  it('should return true for exact phrase match', () => {
    const result = matchesQueryMultiTerm('hello world', 'hello world', terms)
    expect(result).toBe(true)
  })

  it('should return true for all terms match', () => {
    const result = matchesQueryMultiTerm('world hello', 'hello world', terms)
    expect(result).toBe(true)
  })

  it('should return true for single term match', () => {
    const result = matchesQueryMultiTerm('hello there', 'hello world', terms)
    expect(result).toBe(true)
  })

  it('should return false for no match', () => {
    const result = matchesQueryMultiTerm('foo bar', 'hello world', terms)
    expect(result).toBe(false)
  })

  it('should return false for null value', () => {
    const result = matchesQueryMultiTerm(null, 'hello world', terms)
    expect(result).toBe(false)
  })

  it('should return false for undefined value', () => {
    const result = matchesQueryMultiTerm(undefined, 'hello world', terms)
    expect(result).toBe(false)
  })
})

describe('findMatchedField', () => {
  const query = 'test query'
  const terms = parseQueryTerms(query)
  const fields = ['name', 'description', 'title']

  it('should find exact match in first field', () => {
    const obj = {
      name: 'This is a test query',
      description: 'Some description',
      title: 'A title',
    }
    const result = findMatchedField(obj, query, fields, terms)
    expect(result).not.toBeNull()
    expect(result?.field).toBe('name')
    expect(result?.priority).toBe(0)
  })

  it('should find match in second field', () => {
    const obj = {
      name: 'No match here',
      description: 'This has test query',
      title: 'A title',
    }
    const result = findMatchedField(obj, query, fields, terms)
    expect(result?.field).toBe('description')
  })

  it('should return best match (lowest priority)', () => {
    const obj = {
      name: 'Just test',
      description: 'test query exact',
      title: 'A title',
    }
    const result = findMatchedField(obj, query, fields, terms)
    expect(result?.field).toBe('description')
    expect(result?.priority).toBe(0)
  })

  it('should return null when no match found', () => {
    const obj = {
      name: 'No match',
      description: 'No match',
      title: 'No match',
    }
    const result = findMatchedField(obj, query, fields, terms)
    expect(result).toBeNull()
  })

  it('should handle non-string field values', () => {
    const obj = {
      name: 123,
      description: 'test query',
      title: null,
    }
    const result = findMatchedField(obj, query, fields, terms)
    expect(result?.field).toBe('description')
  })

  it('should stop at exact match (priority 0)', () => {
    const obj = {
      name: 'test query exact',
      description: 'also test query',
      title: 'test query too',
    }
    const result = findMatchedField(obj, query, fields, terms)
    expect(result?.field).toBe('name')
    expect(result?.priority).toBe(0)
  })

  it('should handle empty fields array', () => {
    const obj = { name: 'test query' }
    const result = findMatchedField(obj, query, [], terms)
    expect(result).toBeNull()
  })

  it('should handle missing fields in object', () => {
    const obj = { other: 'test query' }
    const result = findMatchedField(obj, query, fields, terms)
    expect(result).toBeNull()
  })
})

describe('createWithinTypeSorter', () => {
  const lowerQuery = 'search'

  it('should sort by match priority first', () => {
    const items = [
      { matchPriority: 2 as MatchPriority, name: 'Item A', updatedAt: '2024-01-01', matchedTag: undefined },
      { matchPriority: 0 as MatchPriority, name: 'Item B', updatedAt: '2024-01-01', matchedTag: undefined },
      { matchPriority: 1 as MatchPriority, name: 'Item C', updatedAt: '2024-01-01', matchedTag: undefined },
    ]
    const sorted = [...items].sort(createWithinTypeSorter(lowerQuery))
    expect(sorted[0].matchPriority).toBe(0)
    expect(sorted[1].matchPriority).toBe(1)
    expect(sorted[2].matchPriority).toBe(2)
  })

  it('should prioritize name matches within same priority', () => {
    const items = [
      { matchPriority: 1 as MatchPriority, name: 'Other', updatedAt: '2024-01-01', matchedTag: undefined },
      { matchPriority: 1 as MatchPriority, name: 'Search term', updatedAt: '2024-01-01', matchedTag: undefined },
    ]
    const sorted = [...items].sort(createWithinTypeSorter(lowerQuery))
    expect(sorted[0].name).toBe('Search term')
  })

  it('should deprioritize tag matches', () => {
    const items = [
      { matchPriority: 1 as MatchPriority, name: 'Direct', updatedAt: '2024-01-01', matchedTag: undefined },
      { matchPriority: 1 as MatchPriority, name: 'Tagged', updatedAt: '2024-01-01', matchedTag: { id: '1', name: 'tag' } },
    ]
    const sorted = [...items].sort(createWithinTypeSorter(lowerQuery))
    expect(sorted[0].name).toBe('Direct')
  })

  it('should prioritize tag matches over non-tag when both have no name match', () => {
    const items = [
      { matchPriority: 1 as MatchPriority, name: 'Other A', updatedAt: '2024-01-01', matchedTag: { id: '1', name: 'tag' } },
      { matchPriority: 1 as MatchPriority, name: 'Other B', updatedAt: '2024-01-01', matchedTag: undefined },
    ]
    const sorted = [...items].sort(createWithinTypeSorter(lowerQuery))
    expect(sorted[0].name).toBe('Other B')
    expect(sorted[1].name).toBe('Other A')
  })

  it('should sort by date when priorities and name matches are equal', () => {
    const items = [
      { matchPriority: 1 as MatchPriority, name: 'Item A', updatedAt: '2024-01-01T00:00:00Z', matchedTag: undefined },
      { matchPriority: 1 as MatchPriority, name: 'Item B', updatedAt: '2024-12-31T00:00:00Z', matchedTag: undefined },
    ]
    const sorted = [...items].sort(createWithinTypeSorter(lowerQuery))
    expect(sorted[0].name).toBe('Item B') // More recent
  })

  it('should handle case-insensitive name matching', () => {
    const items = [
      { matchPriority: 1 as MatchPriority, name: 'Other', updatedAt: '2024-01-01', matchedTag: undefined },
      { matchPriority: 1 as MatchPriority, name: 'SEARCH TERM', updatedAt: '2024-01-01', matchedTag: undefined },
    ]
    const sorted = [...items].sort(createWithinTypeSorter(lowerQuery))
    expect(sorted[0].name).toBe('SEARCH TERM')
  })

  it('should handle complex sorting scenario', () => {
    const items = [
      { matchPriority: 2 as MatchPriority, name: 'Old Search', updatedAt: '2020-01-01', matchedTag: undefined },
      { matchPriority: 1 as MatchPriority, name: 'Search New', updatedAt: '2024-01-01', matchedTag: undefined },
      { matchPriority: 0 as MatchPriority, name: 'Exact', updatedAt: '2020-01-01', matchedTag: undefined },
      { matchPriority: 1 as MatchPriority, name: 'Other', updatedAt: '2024-12-31', matchedTag: undefined },
    ]
    const sorted = [...items].sort(createWithinTypeSorter(lowerQuery))
    expect(sorted[0].matchPriority).toBe(0)
    expect(sorted[1].name).toBe('Search New')
    expect(sorted[2].name).toBe('Other')
    expect(sorted[3].name).toBe('Old Search')
  })
})

describe('Edge Cases and Integration', () => {
  it('should handle very long query strings', () => {
    const longQuery = 'a'.repeat(1000)
    const terms = parseQueryTerms(longQuery)
    expect(terms).toEqual(['a'.repeat(1000)])
  })

  it('should handle special characters in query', () => {
    const query = 'test@example.com'
    const terms = parseQueryTerms(query)
    expect(terms).toEqual(['test@example.com'])
  })

  it('should handle unicode characters', () => {
    const query = '你好 world'
    const terms = parseQueryTerms(query)
    expect(terms).toEqual(['你好', 'world'])
  })

  it('should handle emoji in query', () => {
    const query = 'hello 👋 world'
    const terms = parseQueryTerms(query)
    expect(terms.length).toBeGreaterThan(0)
  })

  it('should handle numerical queries', () => {
    const query = '123 456'
    const terms = parseQueryTerms(query)
    expect(terms).toEqual(['123', '456'])
  })

  it('should handle mixed case content matching', () => {
    const content = 'ThE qUiCk BrOwN fOx'
    const result = getMatchPriority(content, 'quick brown', parseQueryTerms('quick brown'))
    expect(result).toBe(0)
  })

  it('should create snippet with very short maxLength', () => {
    const content = 'Hello world'
    const result = createSnippet(content, 'world', 5)
    expect(result.length).toBeLessThanOrEqual(11) // 5 + "..." on both sides
  })

  it('should handle partial word matches', () => {
    const content = 'testing'
    const priority = getMatchPriority(content, 'test', parseQueryTerms('test'))
    expect(priority).toBe(0) // 'test' is contained in 'testing'
  })
})
