/**
 * Tests for the chained-turn scene note (anti-committee spec §9).
 */

import {
  buildUserNarrationAnchor,
  renderUserNarrationAnchor,
} from '@/lib/chat/context/user-narration-anchor'

jest.mock('@/lib/logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}))

const humanIds = new Set(['u1', 'u2'])
const chainedWindow = [
  { role: 'USER', id: 'u1', participantId: 'p-user' },
  { role: 'ASSISTANT', id: 'a1', participantId: 'p-a' },
  { role: 'USER', id: 'u2', participantId: 'p-user' },
  { role: 'USER', id: 'a2', participantId: 'p-b' }, // another character, attributed as user
]

const base = {
  isMultiCharacter: true,
  hasNewUserMessage: false,
  historyWindow: chainedWindow,
  humanTurnMessageIds: humanIds,
  userName: 'Owen',
}

describe('buildUserNarrationAnchor', () => {
  it('returns the note, with the resolved name, on a chained multi-character turn', () => {
    const note = buildUserNarrationAnchor(base)
    expect(note).toBe(renderUserNarrationAnchor('Owen'))
    expect(note).toBe(
      "Scene note: Owen's most recent message is the current state of the scene. Where any other speaker's line — before or after it — conflicts with what Owen narrated, Owen's account is what happened. Adjust without arguing; what you do about it is yours.",
    )
  })

  it('returns empty for a single-character chat', () => {
    expect(buildUserNarrationAnchor({ ...base, isMultiCharacter: false })).toBe('')
  })

  it('returns empty for the first responder', () => {
    expect(buildUserNarrationAnchor({ ...base, hasNewUserMessage: true })).toBe('')
  })

  it('returns empty when no human USER message is in the window', () => {
    expect(buildUserNarrationAnchor({ ...base, humanTurnMessageIds: new Set(['elsewhere']) })).toBe('')
    expect(buildUserNarrationAnchor({ ...base, humanTurnMessageIds: undefined })).toBe('')
    expect(buildUserNarrationAnchor({ ...base, humanTurnMessageIds: new Set() })).toBe('')
  })

  it('returns empty when no character has spoken since the human (staff whisper only)', () => {
    const window = [
      { role: 'USER', id: 'u2', participantId: 'p-user' },
      { role: 'USER', id: 'host-1', participantId: null },
    ]
    expect(buildUserNarrationAnchor({ ...base, historyWindow: window })).toBe('')
  })

  it('recognises a character line by role assistant without a participant id', () => {
    const window = [
      { role: 'user', id: 'u2' },
      { role: 'assistant', id: 'a9' },
    ]
    expect(buildUserNarrationAnchor({ ...base, historyWindow: window })).not.toBe('')
  })
})
