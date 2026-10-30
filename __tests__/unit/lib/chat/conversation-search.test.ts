/**
 * In-conversation search matcher: markdown-blind, case-insensitive, newest
 * first, TOOL rows skipped, limit capping the list but not the total.
 */

import {
  conversationQueryPattern,
  findConversationMatches,
  toSearchableText,
  type SearchableMessage,
} from '@/lib/chat/conversation-search'

function msg(id: string, content: string, extra: Partial<SearchableMessage> = {}): SearchableMessage {
  return { id, role: 'ASSISTANT', content, createdAt: `2026-10-29T00:00:0${id}Z`, ...extra }
}

describe('toSearchableText', () => {
  it('strips emphasis, links and headings so rendered text matches', () => {
    expect(toSearchableText('# Title\n\na *fine* **morning** at [the club](https://x.test)'))
      .toBe('Title a fine morning at the club')
  })

  it('collapses whitespace and drops code fences', () => {
    expect(toSearchableText('```js\nconst  a = 1\n```')).toBe('const a = 1')
  })
})

describe('conversationQueryPattern', () => {
  it('refuses queries under two characters', () => {
    expect(conversationQueryPattern('a')).toBeNull()
    expect(conversationQueryPattern('  a ')).toBeNull()
  })

  it('treats regex metacharacters literally', () => {
    const pattern = conversationQueryPattern('(a+b)')!
    expect(pattern.test('x (a+b) y')).toBe(true)
  })
})

describe('findConversationMatches', () => {
  const messages: SearchableMessage[] = [
    msg('1', 'The *fine* morning began.'),
    msg('2', '{"tool": "fine"}', { role: 'TOOL' }),
    msg('3', 'A FINE day, a fine day indeed.', { systemSender: 'host' }),
    msg('4', 'Nothing here.'),
  ]

  it('returns matches newest first, skipping TOOL rows', () => {
    const { matches, total } = findConversationMatches(messages, 'fine', { limit: 10 })
    expect(matches.map(m => m.messageId)).toEqual(['3', '1'])
    expect(total).toBe(2)
  })

  it('counts occurrences case-insensitively and flags announcements', () => {
    const { matches } = findConversationMatches(messages, 'fine', { limit: 10 })
    expect(matches[0]).toMatchObject({ occurrences: 2, isAnnouncement: true })
    expect(matches[1]).toMatchObject({ occurrences: 1, isAnnouncement: false })
  })

  it('matches across markdown emphasis', () => {
    const { matches } = findConversationMatches(messages, 'fine morning', { limit: 10 })
    expect(matches.map(m => m.messageId)).toEqual(['1'])
  })

  it('caps the list at the limit but reports the full total', () => {
    const { matches, total } = findConversationMatches(messages, 'fine', { limit: 1 })
    expect(matches).toHaveLength(1)
    expect(total).toBe(2)
  })

  it('names the speaker through the callback', () => {
    const { matches } = findConversationMatches(messages, 'morning', {
      limit: 10,
      speakerOf: m => `speaker-${m.id}`,
    })
    expect(matches[0].speaker).toBe('speaker-1')
  })

  it('excerpts around the first occurrence with ellipses', () => {
    const long = `${'x '.repeat(60)}needle${' y'.repeat(100)}`
    const { matches } = findConversationMatches([msg('1', long)], 'needle', { limit: 1 })
    expect(matches[0].snippet.startsWith('…')).toBe(true)
    expect(matches[0].snippet.endsWith('…')).toBe(true)
    expect(matches[0].snippet).toContain('needle')
  })
})
