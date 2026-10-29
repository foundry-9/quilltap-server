/**
 * Punctuation warnings engine tests.
 *
 * The corpus is the contract with quilltap-v5, so it drives most of this suite.
 * The hand-written cases pin invariants the adapter relies on.
 */

import {
  classifyProse,
  lintPunctuation,
  PUNCTUATION_RULE_MESSAGES,
  type LintCaret,
  type ProseSpan,
  type PunctuationIssue,
} from '../engine'
import vectors from '../fixtures/punctuation-vectors.json'
import proseVectors from '../fixtures/prose-vectors.json'

interface VectorCase {
  name: string
  blocks: (string | null)[]
  caret?: LintCaret
  expect: PunctuationIssue[]
}

describe('lintPunctuation', () => {
  describe('corpus (lib/punctuation-lint/fixtures/punctuation-vectors.json)', () => {
    const cases = vectors.cases as unknown as VectorCase[]

    it('has a corpus to run', () => {
      expect(cases.length).toBeGreaterThan(20)
    })

    it.each(cases.map((c) => [c.name, c] as const))('%s', (_name, testCase) => {
      expect(lintPunctuation(testCase.blocks, { caret: testCase.caret ?? null })).toEqual(testCase.expect)
    })
  })

  it('has a message for every rule it can return', () => {
    const cases = vectors.cases as unknown as VectorCase[]
    for (const c of cases) {
      for (const issue of c.expect) expect(PUNCTUATION_RULE_MESSAGES[issue.rule]).toBeTruthy()
    }
  })

  it('reports offsets relative to the block, not the paragraph', () => {
    const issues = lintPunctuation(['Fine.\n\nShe said "hi "  there.'])
    expect(issues).toHaveLength(1)
    expect(issues[0].start).toBe('Fine.\n\nShe said "hi '.length)
  })

  it('never flags a mark inside a null (code) block', () => {
    expect(lintPunctuation([null, null])).toEqual([])
  })

  it('without a caret, a quote typed last is judged as it stands', () => {
    // The adapter passes no caret when the editor has no selection; the same
    // text with a caret after the quote is the "still typing" case.
    expect(lintPunctuation(['He said "'])).toEqual([
      { block: 0, start: 8, end: 9, rule: 'floating-quote' },
    ])
    expect(lintPunctuation(['He said "'], { caret: { block: 0, offset: 9 } })).toEqual([])
  })
})

describe('prose mode', () => {
  interface ProseLintCase {
    name: string
    blocks: (string | null)[]
    caret?: LintCaret
    expect: PunctuationIssue[]
  }
  interface ProseClassifyCase {
    name: string
    blocks: (string | null)[]
    expect: ProseSpan[]
  }

  describe('corpus (lib/punctuation-lint/fixtures/prose-vectors.json)', () => {
    const lintCases = proseVectors.lint as unknown as ProseLintCase[]
    const classifyCases = proseVectors.classify as unknown as ProseClassifyCase[]

    it.each(lintCases.map((c) => [c.name, c] as const))('lint: %s', (_name, testCase) => {
      expect(lintPunctuation(testCase.blocks, { caret: testCase.caret ?? null, proseMode: true })).toEqual(
        testCase.expect,
      )
    })

    it.each(classifyCases.map((c) => [c.name, c] as const))('classify: %s', (_name, testCase) => {
      expect(classifyProse(testCase.blocks)).toEqual(testCase.expect)
    })
  })

  it('never flags a missing dialogue outside prose mode', () => {
    expect(lintPunctuation(['She set the cup down.'])).toEqual([])
  })

  it('has a message for the no-dialogue rule', () => {
    expect(PUNCTUATION_RULE_MESSAGES['no-dialogue']).toBeTruthy()
  })
})
