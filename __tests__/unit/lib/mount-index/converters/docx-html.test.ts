/**
 * The DOCX viewer's link guard (`neutraliseUnsafeHrefs`): only http(s),
 * mailto and in-page anchors survive; anything else becomes `#`.
 */

import { neutraliseUnsafeHrefs } from '@/lib/mount-index/converters/docx-html'

jest.mock('@/lib/logging/create-logger', () => ({
  createServiceLogger: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}))

describe('neutraliseUnsafeHrefs', () => {
  it('keeps safe link targets', () => {
    const html = '<a href="https://example.com/a?b=1&amp;c=2">x</a><a href="mailto:a@b.c">m</a><a href="#ch2">c</a>'
    expect(neutraliseUnsafeHrefs(html)).toBe(html)
  })

  it('replaces script and other schemes with #', () => {
    expect(neutraliseUnsafeHrefs('<a href="javascript:alert(1)">x</a>')).toBe('<a href="#">x</a>')
    expect(neutraliseUnsafeHrefs('<a href=" JavaScript:alert(1)">x</a>')).toBe('<a href="#">x</a>')
    expect(neutraliseUnsafeHrefs('<a href="data:text/html,hi">x</a>')).toBe('<a href="#">x</a>')
    expect(neutraliseUnsafeHrefs('<a href="file:///etc/passwd">x</a>')).toBe('<a href="#">x</a>')
  })
})
