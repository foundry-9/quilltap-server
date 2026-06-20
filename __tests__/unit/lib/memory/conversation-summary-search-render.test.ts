/**
 * Unit tests for the pure renderer + call-note shared by the recap's relevant
 * list and the fold-triggered refresh whisper.
 */

import { describe, it, expect } from '@jest/globals'
import {
  renderRelevantConversationsBlock,
  READ_CONVERSATION_CALL_NOTE,
} from '@/lib/memory/conversation-summary-search'

describe('renderRelevantConversationsBlock', () => {
  it('returns empty string for no matches', () => {
    expect(renderRelevantConversationsBlock([])).toBe('')
  })

  it('renders one entry per match with the conversation UUID in backticks', () => {
    const out = renderRelevantConversationsBlock([
      { conversationId: 'id-1', conversationTitle: 'Tea on the Verandah', relativePath: 'a.md', score: 0.9 },
      { conversationId: 'id-2', conversationTitle: 'A Carriage Ride', relativePath: 'b.md', score: 0.8 },
    ])
    expect(out).toContain('### Relevant Past Conversations')
    expect(out).toContain('#### Tea on the Verandah (`id-1`)')
    expect(out).toContain('#### A Carriage Ride (`id-2`)')
  })

  it('exposes a call note that names the read_conversation tool', () => {
    expect(READ_CONVERSATION_CALL_NOTE).toContain('read_conversation')
  })
})
