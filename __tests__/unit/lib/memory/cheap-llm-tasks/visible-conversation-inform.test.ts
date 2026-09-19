/**
 * The `inform` record must never reach a model, and this is the back door.
 *
 * `extractVisibleConversation` is the standard filter for every cheap-LLM task
 * that judges content: titles, rolling summaries, story backgrounds, and the
 * async pre-compression whose output comes back as system block 3 on later
 * turns. It filters by ROLE — and an inform record wears `role: 'ASSISTANT'`,
 * so without an explicit guard the record would be folded into a summary and
 * then handed to the model in every turn thereafter.
 */

import { extractVisibleConversation } from '@/lib/memory/cheap-llm-tasks/chat-tasks'

describe('extractVisibleConversation — inform records', () => {
  it('drops the inform record while keeping the conversation around it', () => {
    const result = extractVisibleConversation([
      { type: 'message', role: 'USER', content: 'What happens next?' },
      {
        type: 'message',
        role: 'ASSISTANT',
        content: 'You notice the clock has stopped.',
        systemKind: 'inform',
      },
      { type: 'message', role: 'ASSISTANT', content: 'She crosses the room.' },
    ])

    expect(result).toEqual([
      { role: 'user', content: 'What happens next?' },
      { role: 'assistant', content: 'She crosses the room.' },
    ])
  })

  it('keeps every other Staff announcement, which is deliberate context', () => {
    const result = extractVisibleConversation([
      {
        type: 'message',
        role: 'ASSISTANT',
        content: 'The Host welcomes Beatrice to the salon.',
        systemKind: 'add',
      },
    ])

    expect(result).toHaveLength(1)
    expect(result[0].content).toContain('The Host welcomes Beatrice')
  })
})
