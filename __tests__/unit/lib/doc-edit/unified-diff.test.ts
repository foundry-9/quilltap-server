import { describe, expect, it } from '@jest/globals'

import { generateUnifiedDiff, formatAutosaveNotification } from '@/lib/doc-edit/unified-diff'

describe('generateUnifiedDiff', () => {
  it('returns an empty string when the content is unchanged', () => {
    expect(generateUnifiedDiff('same\ntext', 'same\ntext', 'draft.md')).toBe('')
  })

  it('includes unified diff headers and changed lines for insertions', () => {
    const diff = generateUnifiedDiff('alpha\nbeta\n', 'alpha\ngamma\nbeta\n', 'draft.md')

    expect(diff).toContain('--- a/draft.md')
    expect(diff).toContain('+++ b/draft.md')
    expect(diff).toContain('+gamma')
  })

  it('includes removed lines for deletions', () => {
    const diff = generateUnifiedDiff('alpha\nbeta\ngamma\n', 'alpha\ngamma\n', 'draft.md')

    expect(diff).toContain('-beta')
  })
})

describe('formatAutosaveNotification', () => {
  it('returns null when there is no meaningful diff', () => {
    expect(formatAutosaveNotification('same', 'same', 'draft.md')).toBeNull()
  })

  it('wraps the diff in the autosave notification message', () => {
    const message = formatAutosaveNotification('old line', 'new line', 'draft.md')

    expect(message).toContain('I\'ve made changes to "draft.md"')
    expect(message).toContain('```diff')
    expect(message).toContain('--- a/draft.md')
  })
})
