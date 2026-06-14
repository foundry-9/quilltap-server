/**
 * @jest-environment node
 *
 * Unit tests for the pure formatting-toolbar transforms. These back BOTH toolbar
 * paths (source textarea + Lexical APPLY_DELIMITER_COMMAND), so the edge cases
 * here are the contract for "the buttons behave consistently across edit kinds."
 */

import { toggleWrap, toggleLinePrefix, insertTagPrefix } from '@/lib/chat/text-transforms'

describe('toggleWrap', () => {
  it('inserts open+close and places the cursor between them when nothing is selected', () => {
    const r = toggleWrap({ value: 'ab', start: 1, end: 1 }, '*', '*')
    expect(r.value).toBe('a**b')
    expect(r.cursor).toBe(2) // between the two asterisks
  })

  it('wraps a selection and places the cursor after the close delimiter', () => {
    const r = toggleWrap({ value: 'say hi now', start: 4, end: 6 }, '*', '*')
    expect(r.value).toBe('say *hi* now')
    expect(r.cursor).toBe(8) // after '*hi*'
  })

  it('unwraps a selection that is already wrapped', () => {
    const r = toggleWrap({ value: 'say *hi* now', start: 4, end: 8 }, '*', '*')
    expect(r.value).toBe('say hi now')
    expect(r.cursor).toBe(6) // end of the inner text
  })

  it('supports asymmetric delimiters', () => {
    const r = toggleWrap({ value: 'go there', start: 3, end: 8 }, '[', ']')
    expect(r.value).toBe('go [there]')
    expect(r.cursor).toBe(10)
  })

  it('wraps a multi-line selection as a single whole span', () => {
    const r = toggleWrap({ value: 'line one\nline two', start: 0, end: 17 }, '*', '*')
    expect(r.value).toBe('*line one\nline two*')
  })

  it('does not treat a single delimiter char as already-wrapped', () => {
    const r = toggleWrap({ value: '*', start: 0, end: 1 }, '*', '*')
    expect(r.value).toBe('***') // wraps, does not slice into nothing
  })
})

describe('toggleLinePrefix', () => {
  it('adds the marker to the current line', () => {
    const r = toggleLinePrefix({ value: 'hello world', start: 3, end: 3 }, '// ')
    expect(r.value).toBe('// hello world')
    expect(r.cursor).toBe('// hello world'.length)
  })

  it('expands a partial-line selection to the whole line', () => {
    const r = toggleLinePrefix({ value: 'one\ntwo three\nfour', start: 8, end: 9 }, '// ')
    expect(r.value).toBe('one\n// two three\nfour')
  })

  it('adds the marker to every line in a multi-line selection', () => {
    const r = toggleLinePrefix({ value: 'a\nb\nc', start: 0, end: 5 }, '// ')
    expect(r.value).toBe('// a\n// b\n// c')
  })

  it('toggles the marker off when every touched line already has it', () => {
    const r = toggleLinePrefix({ value: '// a\n// b', start: 0, end: 9 }, '// ')
    expect(r.value).toBe('a\nb')
  })
})

describe('insertTagPrefix', () => {
  it('inserts open+close at the line start with the cursor between the brackets', () => {
    const r = insertTagPrefix({ value: 'all hands on deck', start: 5, end: 5 }, '[', ']')
    expect(r.value).toBe('[]all hands on deck')
    expect(r.cursor).toBe(1) // between [ and ]
  })

  it('inserts at the start of the current line in a multi-line value', () => {
    const r = insertTagPrefix({ value: 'first\nsecond line', start: 9, end: 9 }, '[', ']')
    expect(r.value).toBe('first\n[]second line')
    expect(r.cursor).toBe('first\n'.length + 1)
  })
})
