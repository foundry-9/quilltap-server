/**
 * Which templates get the composer's prose mode (the no-dialogue warning and
 * the narration / out-of-character preview).
 *
 * Lives outside `lib/punctuation-lint/` because that directory may not import
 * app code, and the case that matters is the seeded Novel template itself.
 */

import { isProseTemplate } from '@/lib/punctuation-lint/prose-mode'
import { NOVEL_TEMPLATE } from '@/lib/chat/novel-template'
describe('isProseTemplate', () => {
  it('accepts unmarked narration with quoted dialogue (Novel)', () => {
    expect(isProseTemplate(NOVEL_TEMPLATE)).toBe(true)
  })

  it('refuses a template whose narration is marked', () => {
    expect(isProseTemplate({ ...NOVEL_TEMPLATE, narrationDelimiters: '*' })).toBe(false)
  })

  it('refuses unmarked narration without quoted dialogue', () => {
    expect(isProseTemplate({ narrationDelimiters: null, delimiters: [{ kind: 'wrap', delimiters: ['((', '))'] }] })).toBe(false)
  })

  it('refuses no template', () => {
    expect(isProseTemplate(null)).toBe(false)
  })
})
