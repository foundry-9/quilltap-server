/**
 * The FTS5 query translator.
 *
 * The fixture list is the measured table in the module doc: prefix semantics,
 * phrases, quote doubling, FTS operator words that must stay literal, `C++`
 * (the case that must NOT use the index), and the empty/punctuation queries.
 *
 * @jest-environment node
 */

import {
  buildFtsMatchExpression,
  escapeLikePattern,
  tokenizeLikeUnicode61,
} from '@/lib/database/repositories/fts-query'

describe('tokenizeLikeUnicode61', () => {
  it('splits on everything outside letters and numbers', () => {
    expect(tokenizeLikeUnicode61('Mr. Smith')).toEqual(['Mr', 'Smith'])
    expect(tokenizeLikeUnicode61('the estate')).toEqual(['the', 'estate'])
    expect(tokenizeLikeUnicode61("don't")).toEqual(['don', 't'])
    expect(tokenizeLikeUnicode61('C++')).toEqual(['C'])
    expect(tokenizeLikeUnicode61('room 12b')).toEqual(['room', '12b'])
  })

  it('keeps non-ASCII letters whole', () => {
    expect(tokenizeLikeUnicode61('café')).toEqual(['café'])
    expect(tokenizeLikeUnicode61('Ίσταμβουλ')).toEqual(['Ίσταμβουλ'])
  })

  it('returns nothing for punctuation or whitespace alone', () => {
    expect(tokenizeLikeUnicode61('   ')).toEqual([])
    expect(tokenizeLikeUnicode61('--')).toEqual([])
    expect(tokenizeLikeUnicode61('')).toEqual([])
  })
})

describe('escapeLikePattern', () => {
  it('escapes the wildcards and the escape character itself', () => {
    expect(escapeLikePattern('100%')).toBe('100\\%')
    expect(escapeLikePattern('a_b')).toBe('a\\_b')
    expect(escapeLikePattern('back\\slash')).toBe('back\\\\slash')
  })

  it('escapes the backslash first, so added escapes are not re-escaped', () => {
    expect(escapeLikePattern('\\%')).toBe('\\\\\\%')
  })

  it('leaves regex metacharacters alone — this is LIKE, not a regex', () => {
    expect(escapeLikePattern('Mr. Smith (esq.)')).toBe('Mr. Smith (esq.)')
  })
})

describe('buildFtsMatchExpression', () => {
  it('wraps a single word as a prefix phrase', () => {
    const plan = buildFtsMatchExpression('walk')
    expect(plan.kind).toBe('fts')
    expect(plan.kind === 'fts' && plan.match).toBe('"walk"*')
  })

  it('keeps a multi-word query as ONE phrase, so word order still matters', () => {
    const plan = buildFtsMatchExpression('the estate')
    expect(plan.kind === 'fts' && plan.match).toBe('"the estate"*')
  })

  it('doubles embedded quotes rather than breaking the phrase', () => {
    const plan = buildFtsMatchExpression('he said "hi"')
    expect(plan.kind === 'fts' && plan.match).toBe('"he said ""hi"""*')
  })

  it('leaves FTS operator syntax literal inside the phrase', () => {
    for (const q of ['cats OR dogs', 'NEAR(a b)', '-excluded', 'col:value']) {
      const plan = buildFtsMatchExpression(q)
      expect(plan.kind).toBe('fts')
      expect(plan.kind === 'fts' && plan.match).toBe(`"${q}"*`)
    }
  })

  it('keeps punctuation the tokenizer will discard (it costs nothing)', () => {
    const plan = buildFtsMatchExpression('Mr. Smith')
    expect(plan.kind === 'fts' && plan.match).toBe('"Mr. Smith"*')
  })

  it('falls back for a query whose tokens are all single characters', () => {
    const plan = buildFtsMatchExpression('C++')
    expect(plan.kind).toBe('fallback')
    expect(plan.kind === 'fallback' && plan.reason).toBe('tokens-too-short')
    expect(plan.kind === 'fallback' && plan.likePattern).toBe('%C++%')
  })

  it('falls back for a query with no tokens at all', () => {
    const plan = buildFtsMatchExpression('---')
    expect(plan.kind).toBe('fallback')
    expect(plan.kind === 'fallback' && plan.reason).toBe('no-tokens')
  })

  it('uses the index when at least one token is long enough', () => {
    const plan = buildFtsMatchExpression('walk C++')
    expect(plan.kind).toBe('fts')
  })

  it('escapes the wildcard characters in the fallback pattern', () => {
    const plan = buildFtsMatchExpression('%_')
    expect(plan.kind === 'fallback' && plan.likePattern).toBe('%\\%\\_%')
  })
})
