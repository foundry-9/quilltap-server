/**
 * Unit tests for rolling-window fold helpers.
 */

import { describe, it, expect } from '@jest/globals'
import {
  partitionMessagesIntoTurns,
  shouldCheckTitleAtInterchange,
} from '@/lib/chat/context-summary'

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

  describe('autonomous chat partitioning', () => {
    it('treats each character-attributed assistant message as its own turn', () => {
      // Autonomous rooms have no USER pivot. Without the chatType branch,
      // turns.length is permanently 0 and summarisation always bails with
      // "No messages to summarize".
      const msgs = [
        assistantMsg('amy-1', 'Amy speaks'),
        assistantMsg('friday-1', 'Friday speaks'),
        assistantMsg('amy-2', 'Amy again'),
      ]
      const turns = partitionMessagesIntoTurns(msgs, 'autonomous')
      expect(turns).toHaveLength(3)
      expect(turns.map(t => t.turnNumber)).toEqual([1, 2, 3])
      expect(turns.flatMap(t => t.ids)).toEqual(['amy-1', 'friday-1', 'amy-2'])
    })

    it('still excludes staff whispers from autonomous partitions', () => {
      const msgs = [
        staffMsg('host-intro', 'host'),
        assistantMsg('amy-1'),
        staffMsg('cpl', 'commonplaceBook'),
        assistantMsg('friday-1'),
        staffMsg('lib', 'librarian'),
        assistantMsg('amy-2'),
      ]
      const turns = partitionMessagesIntoTurns(msgs, 'autonomous')
      expect(turns).toHaveLength(3)
      expect(turns.flatMap(t => t.ids)).toEqual(['amy-1', 'friday-1', 'amy-2'])
    })

    it('regular chats unchanged when chatType is omitted or not autonomous', () => {
      const msgs = [
        assistantMsg('greet'),
        assistantMsg('greet2'),
        userMsg('u1'),
        assistantMsg('a1'),
      ]
      // Greeting + user pivot = one turn that bundles everything (leading
      // assistant attaches to the first user turn).
      expect(partitionMessagesIntoTurns(msgs)).toHaveLength(1)
      expect(partitionMessagesIntoTurns(msgs, 'salon')).toHaveLength(1)
    })
  })
})

describe('shouldCheckTitleAtInterchange (crossing semantics)', () => {
  it('fires on the first turn we cross an early checkpoint', () => {
    // Regular chat where the count jumped from 4 → 6 without ever landing
    // on the exact-5 checkpoint. Old behaviour: never fires for 5. New: 6
    // is past 5 and 5 is past the last-checked value of 4 → fires.
    expect(shouldCheckTitleAtInterchange(6, 4)).toBe(true)
  })

  it('fires once we cross 10 even if we skipped it exactly', () => {
    // Autonomous-room style: count jumps 8 → 14, never landing on 10.
    expect(shouldCheckTitleAtInterchange(14, 8)).toBe(true)
    // After firing (lastChecked becomes 14), the same call should no longer
    // fire — we've already crossed the 10 boundary.
    expect(shouldCheckTitleAtInterchange(14, 14)).toBe(false)
  })

  it('fires after crossing the next multiple of 10', () => {
    // lastChecked = 12 (last fire was at the post-10 boundary). Count
    // climbs through 17, 23. At 23 we've crossed 20, which is > 12 → fire.
    expect(shouldCheckTitleAtInterchange(17, 12)).toBe(false)
    expect(shouldCheckTitleAtInterchange(23, 12)).toBe(true)
  })

  it('does not fire below the minimum interchange', () => {
    // Regular chats: never check before 2.
    expect(shouldCheckTitleAtInterchange(1, 0)).toBe(false)
    expect(shouldCheckTitleAtInterchange(2, 0)).toBe(true)
  })

  it('help chats fire at 1', () => {
    expect(shouldCheckTitleAtInterchange(1, 0, 'help')).toBe(true)
  })

  it('preserves the original "fire exactly once per checkpoint" property', () => {
    // Walk through 1..15 for a regular chat, recording each fire. Each
    // checkpoint (2, 3, 5, 7, 10) should fire exactly once even with
    // arbitrary monotonic counter jumps.
    let lastChecked = 0
    const fired: number[] = []
    for (const n of [2, 3, 5, 7, 10, 14, 22]) {
      if (shouldCheckTitleAtInterchange(n, lastChecked)) {
        fired.push(n)
        lastChecked = n
      }
    }
    // 2, 3, 5, 7, 10 fire on their exact values; 14 crosses the 10
    // boundary which already fired at 10 (no new fire); 22 crosses 20 → fire.
    expect(fired).toEqual([2, 3, 5, 7, 10, 22])
  })
})
