/**
 * Unit tests for rolling-window fold helpers.
 */

import { describe, it, expect } from '@jest/globals'
import { partitionMessagesIntoTurns } from '@/lib/chat/context-summary'

function userMsg(id: string, content = 'hi'): any {
  return {
    type: 'message',
    id,
    role: 'USER',
    content,
    attachments: [],
    createdAt: '2026-01-01T00:00:00Z',
  }
}

function assistantMsg(id: string, content = 'hello', overrides: Record<string, unknown> = {}): any {
  return {
    type: 'message',
    id,
    role: 'ASSISTANT',
    content,
    attachments: [],
    createdAt: '2026-01-01T00:00:01Z',
    ...overrides,
  }
}

function staffMsg(id: string, sender: string): any {
  return assistantMsg(id, '[staff]', { systemSender: sender })
}

describe('partitionMessagesIntoTurns', () => {
  it('returns empty array on no messages', () => {
    expect(partitionMessagesIntoTurns([])).toEqual([])
  })

  it('counts each user message as a turn boundary', () => {
    const msgs = [
      userMsg('u1'), assistantMsg('a1'),
      userMsg('u2'), assistantMsg('a2'),
      userMsg('u3'), assistantMsg('a3'),
    ]
    const turns = partitionMessagesIntoTurns(msgs)
    expect(turns).toHaveLength(3)
    expect(turns.map(t => t.turnNumber)).toEqual([1, 2, 3])
  })

  it('attaches multiple character replies to one turn', () => {
    const msgs = [
      userMsg('u1'),
      assistantMsg('a1'), assistantMsg('a2'), assistantMsg('a3'),
      userMsg('u2'),
      assistantMsg('a4'),
    ]
    const turns = partitionMessagesIntoTurns(msgs)
    expect(turns).toHaveLength(2)
    expect(turns[0].messages.map(m => m.id)).toEqual(['u1', 'a1', 'a2', 'a3'])
    expect(turns[1].messages.map(m => m.id)).toEqual(['u2', 'a4'])
  })

  it('excludes staff-authored messages from turn content', () => {
    const msgs = [
      userMsg('u1'),
      assistantMsg('a1'),
      staffMsg('libr', 'librarian'),
      staffMsg('host', 'host'),
      userMsg('u2'),
      assistantMsg('a2'),
    ]
    const turns = partitionMessagesIntoTurns(msgs)
    expect(turns).toHaveLength(2)
    const allIds = turns.flatMap(t => t.ids)
    expect(allIds).toEqual(['u1', 'a1', 'u2', 'a2'])
  })

  it('staff messages do not trigger turn boundaries', () => {
    const msgs = [
      userMsg('u1'),
      staffMsg('lib1', 'librarian'),
      assistantMsg('a1'),
      staffMsg('lib2', 'librarian'),
    ]
    const turns = partitionMessagesIntoTurns(msgs)
    expect(turns).toHaveLength(1)
    expect(turns[0].messages.map(m => m.id)).toEqual(['u1', 'a1'])
  })

  it('attaches leading greeting to turn 1', () => {
    const msgs = [
      assistantMsg('greet'),
      userMsg('u1'),
      assistantMsg('a1'),
    ]
    const turns = partitionMessagesIntoTurns(msgs)
    expect(turns).toHaveLength(1)
    expect(turns[0].messages.map(m => m.id)).toEqual(['greet', 'u1', 'a1'])
  })

  it('drops non-message events (system, context-summary)', () => {
    const msgs = [
      userMsg('u1'),
      assistantMsg('a1'),
      { type: 'context-summary', id: 'cs1', context: 's', createdAt: '2026-01-01T00:00:02Z' },
      { type: 'system', id: 'sys1', systemEventType: 'TITLE_GENERATION', description: '', createdAt: '2026-01-01T00:00:03Z' },
      userMsg('u2'),
    ]
    const turns = partitionMessagesIntoTurns(msgs as any)
    expect(turns).toHaveLength(2)
    expect(turns.flatMap(t => t.ids)).toEqual(['u1', 'a1', 'u2'])
  })

  it('drops messages with non-USER/ASSISTANT roles', () => {
    const msgs = [
      userMsg('u1'),
      assistantMsg('a1'),
      { ...assistantMsg('tool1'), role: 'TOOL' },
      userMsg('u2'),
    ]
    const turns = partitionMessagesIntoTurns(msgs)
    expect(turns).toHaveLength(2)
    expect(turns.flatMap(t => t.ids)).toEqual(['u1', 'a1', 'u2'])
  })
})
