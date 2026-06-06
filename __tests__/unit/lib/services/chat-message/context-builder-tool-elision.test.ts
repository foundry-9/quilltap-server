/**
 * Unit tests for the tool-result elision feature in buildConversationMessages.
 *
 * A TOOL message with ≥3 ASSISTANT messages after it must have its result body
 * replaced by a compact stub. Within the last 3 turns the verbatim result is
 * preserved. Both single-character (isMultiCharacter: false) and
 * multi-character (isMultiCharacter: true) modes are exercised.
 */

import { buildConversationMessages } from '@/lib/services/chat-message/context-builder.service'

jest.mock('@/lib/logging/create-logger', () => ({
  createServiceLogger: jest.fn(() => ({
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  })),
}))

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toolMsg(toolName: string, result: string, args?: unknown, id = 'tool-1') {
  return {
    type: 'message',
    role: 'TOOL',
    content: JSON.stringify({ toolName, result, arguments: args }),
    id,
  }
}

function assistantMsg(content = 'Reply', id = 'a-1') {
  return { type: 'message', role: 'ASSISTANT', content, id }
}

function userMsg(content = 'Hello', id = 'u-1') {
  return { type: 'message', role: 'USER', content, id }
}

// ---------------------------------------------------------------------------
// Single-character mode
// ---------------------------------------------------------------------------

describe('buildConversationMessages — tool-result elision (single-character)', () => {
  it('elides result when ≥3 ASSISTANT messages follow the TOOL message', () => {
    const messages = [
      toolMsg('read_file', 'file contents here', { path: '/foo.txt' }, 'tool-1'),
      assistantMsg('A1', 'a-1'),
      assistantMsg('A2', 'a-2'),
      assistantMsg('A3', 'a-3'),
    ]
    const { conversationMessages } = buildConversationMessages(messages, false)

    const toolOutput = conversationMessages.find(m => m.id === 'tool-1')
    expect(toolOutput).toBeDefined()
    expect(toolOutput!.content).toContain('[Tool Result: read_file]')
    expect(toolOutput!.content).toContain('result elided')
    expect(toolOutput!.content).not.toContain('file contents here')
  })

  it('keeps result verbatim when 0 ASSISTANT messages follow the TOOL message', () => {
    const messages = [
      userMsg(),
      toolMsg('list_files', 'dir1\ndir2', { path: '/' }, 'tool-1'),
    ]
    const { conversationMessages } = buildConversationMessages(messages, false)

    const toolOutput = conversationMessages.find(m => m.id === 'tool-1')
    expect(toolOutput).toBeDefined()
    expect(toolOutput!.content).toContain('[Tool Result: list_files]')
    expect(toolOutput!.content).toContain('dir1\ndir2')
    expect(toolOutput!.content).not.toContain('result elided')
  })

  it('keeps result verbatim when exactly 1 ASSISTANT message follows', () => {
    const messages = [
      toolMsg('search', 'hit1\nhit2', undefined, 'tool-1'),
      assistantMsg('A1', 'a-1'),
    ]
    const { conversationMessages } = buildConversationMessages(messages, false)

    const toolOutput = conversationMessages.find(m => m.id === 'tool-1')
    expect(toolOutput!.content).toContain('hit1')
    expect(toolOutput!.content).not.toContain('result elided')
  })

  it('keeps result verbatim when exactly 2 ASSISTANT messages follow', () => {
    const messages = [
      toolMsg('search', 'hit1\nhit2', undefined, 'tool-1'),
      assistantMsg('A1', 'a-1'),
      assistantMsg('A2', 'a-2'),
    ]
    const { conversationMessages } = buildConversationMessages(messages, false)

    const toolOutput = conversationMessages.find(m => m.id === 'tool-1')
    expect(toolOutput!.content).toContain('hit1')
    expect(toolOutput!.content).not.toContain('result elided')
  })

  it('elides at exactly the threshold: 3 ASSISTANT messages after', () => {
    const messages = [
      toolMsg('do_thing', 'important result', { key: 'val' }, 'tool-1'),
      assistantMsg('A1', 'a-1'),
      assistantMsg('A2', 'a-2'),
      assistantMsg('A3', 'a-3'),
    ]
    const { conversationMessages } = buildConversationMessages(messages, false)

    const toolOutput = conversationMessages.find(m => m.id === 'tool-1')
    expect(toolOutput!.content).toContain('result elided')
  })

  it('stub contains args summary when arguments present', () => {
    const messages = [
      toolMsg('read_file', 'content', { path: '/hello/world.txt' }, 'tool-1'),
      assistantMsg('A1', 'a-1'),
      assistantMsg('A2', 'a-2'),
      assistantMsg('A3', 'a-3'),
    ]
    const { conversationMessages } = buildConversationMessages(messages, false)

    const toolOutput = conversationMessages.find(m => m.id === 'tool-1')
    expect(toolOutput!.content).toContain('/hello/world.txt')
  })

  it('stub contains "(args: )" safely when arguments is undefined', () => {
    const messages = [
      {
        type: 'message',
        role: 'TOOL',
        content: JSON.stringify({ toolName: 'ping', result: 'pong' }),
        id: 'tool-1',
      },
      assistantMsg('A1', 'a-1'),
      assistantMsg('A2', 'a-2'),
      assistantMsg('A3', 'a-3'),
    ]
    const { conversationMessages } = buildConversationMessages(messages, false)

    const toolOutput = conversationMessages.find(m => m.id === 'tool-1')
    expect(toolOutput!.content).toContain('result elided')
    // Should not throw and should contain the args placeholder
    expect(toolOutput!.content).toContain('(args: )')
  })

  it('multiple TOOL messages: only old ones are elided', () => {
    // tool-old has 4 ASSISTANT after → elided; tool-recent has 1 → verbatim
    const messages = [
      toolMsg('old_call', 'old result', { a: 1 }, 'tool-old'),
      assistantMsg('A1', 'a-1'),
      assistantMsg('A2', 'a-2'),
      assistantMsg('A3', 'a-3'),
      toolMsg('recent_call', 'fresh result', { b: 2 }, 'tool-recent'),
      assistantMsg('A4', 'a-4'),
    ]
    const { conversationMessages } = buildConversationMessages(messages, false)

    const oldOutput = conversationMessages.find(m => m.id === 'tool-old')
    expect(oldOutput!.content).toContain('result elided')
    expect(oldOutput!.content).not.toContain('old result')

    const recentOutput = conversationMessages.find(m => m.id === 'tool-recent')
    expect(recentOutput!.content).toContain('fresh result')
    expect(recentOutput!.content).not.toContain('result elided')
  })
})

// ---------------------------------------------------------------------------
// Multi-character mode
// ---------------------------------------------------------------------------

describe('buildConversationMessages — tool-result elision (multi-character)', () => {
  it('elides in messagesWithParticipants when ≥3 ASSISTANT messages follow', () => {
    const messages = [
      { ...toolMsg('list_notes', 'note1, note2', { folder: '/a' }, 'tool-1'), participantId: null, createdAt: '2024-01-01T00:00:00Z' },
      { ...assistantMsg('A1', 'a-1'), participantId: 'char-1', createdAt: '2024-01-01T00:00:01Z' },
      { ...assistantMsg('A2', 'a-2'), participantId: 'char-2', createdAt: '2024-01-01T00:00:02Z' },
      { ...assistantMsg('A3', 'a-3'), participantId: 'char-1', createdAt: '2024-01-01T00:00:03Z' },
    ]
    const { conversationMessages, messagesWithParticipants } = buildConversationMessages(messages, true)

    // Both branches must agree
    const convTool = conversationMessages.find(m => m.id === 'tool-1')
    expect(convTool!.content).toContain('result elided')

    const mwpTool = messagesWithParticipants!.find(m => m.id === 'tool-1')
    expect(mwpTool!.content).toContain('result elided')
    expect(mwpTool!.content).not.toContain('note1')
  })

  it('keeps result verbatim in both branches when within last 2 turns', () => {
    const messages = [
      { ...assistantMsg('A1', 'a-1'), participantId: 'char-1', createdAt: '2024-01-01T00:00:00Z' },
      { ...toolMsg('get_info', 'fresh info', { q: 'x' }, 'tool-1'), participantId: null, createdAt: '2024-01-01T00:00:01Z' },
      { ...assistantMsg('A2', 'a-2'), participantId: 'char-2', createdAt: '2024-01-01T00:00:02Z' },
      { ...assistantMsg('A3', 'a-3'), participantId: 'char-1', createdAt: '2024-01-01T00:00:03Z' },
    ]
    const { conversationMessages, messagesWithParticipants } = buildConversationMessages(messages, true)

    const convTool = conversationMessages.find(m => m.id === 'tool-1')
    expect(convTool!.content).toContain('fresh info')
    expect(convTool!.content).not.toContain('result elided')

    const mwpTool = messagesWithParticipants!.find(m => m.id === 'tool-1')
    expect(mwpTool!.content).toContain('fresh info')
    expect(mwpTool!.content).not.toContain('result elided')
  })

  it('multi-char: participantId is null on the elided tool message', () => {
    const messages = [
      { ...toolMsg('do_something', 'result data', undefined, 'tool-1'), participantId: null, createdAt: '2024-01-01T00:00:00Z' },
      { ...assistantMsg('A1', 'a-1'), participantId: 'char-1', createdAt: '2024-01-01T00:00:01Z' },
      { ...assistantMsg('A2', 'a-2'), participantId: 'char-2', createdAt: '2024-01-01T00:00:02Z' },
      { ...assistantMsg('A3', 'a-3'), participantId: 'char-1', createdAt: '2024-01-01T00:00:03Z' },
    ]
    const { messagesWithParticipants } = buildConversationMessages(messages, true)

    const mwpTool = messagesWithParticipants!.find(m => m.id === 'tool-1')
    expect(mwpTool!.participantId).toBeNull()
    expect(mwpTool!.role).toBe('USER')
    expect(mwpTool!.content).toContain('result elided')
  })
})
