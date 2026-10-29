/**
 * Tests for the Salon's absent-character name chips (server side).
 */

import { findAbsentMentions, presenceOf, spokenText, type MentionCandidate } from '@/lib/chat/absent-mentions'
import type { ChatParticipantBase } from '@/lib/schemas/chat.types'

jest.mock('@/lib/logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}))
jest.mock('@/lib/memory/cheap-llm-tasks', () => ({
  stripToolArtifacts: (s: string) => s,
}))
jest.mock('@/lib/services/host-notifications/writer', () => ({
  offSceneCardFields: (c: { name: string; aliases?: string[]; identity?: string }, user?: string | null) => ({
    name: c.name,
    aliases: c.aliases ?? [],
    pronouns: null,
    body: (c.identity ?? '').replace('{{user}}', user ?? '{{user}}'),
  }),
}))

const seat = (id: string, characterId: string, status = 'active') =>
  ({ id, characterId, status, type: 'CHARACTER' }) as unknown as ChatParticipantBase

const friday: MentionCandidate = { id: 'friday', name: 'Friday', aliases: [], pronouns: null, identity: null, description: null }
const charlie: MentionCandidate = { id: 'charlie', name: 'Charlie', aliases: [], pronouns: null, identity: null, description: null }
const abigail: MentionCandidate = { id: 'abigail', name: 'Abigail', aliases: ['Abby'], pronouns: null, identity: 'Married to {{user}}.', description: null }
const vergil: MentionCandidate = { id: 'vergil', name: 'Vergil', aliases: [], pronouns: null, identity: null, description: 'An AI.' }

describe('presenceOf', () => {
  it('counts seated characters, not removed ones', () => {
    const inRoom = presenceOf({ participants: [seat('p1', 'friday'), seat('p2', 'vergil', 'removed')], chatType: 'salon' })
    expect(inRoom(friday)).toBe(true)
    expect(inRoom(vergil)).toBe(false)
  })

  it('counts an unseated persona in the room only where the operator speaks', () => {
    expect(presenceOf({ participants: [], chatType: 'salon', personaName: 'Charlie' })(charlie)).toBe(true)
    expect(presenceOf({ participants: [], chatType: 'autonomous', personaName: 'Charlie' })(charlie)).toBe(false)
  })
})

describe('spokenText', () => {
  it('keeps user and character lines, drops Staff messages and events', () => {
    expect(spokenText({ type: 'message', role: 'USER', content: 'hi' })).toBe('hi')
    expect(spokenText({ type: 'message', role: 'ASSISTANT', content: 'yo' })).toBe('yo')
    expect(spokenText({ type: 'message', role: 'ASSISTANT', content: 'Abby', systemSender: 'host' })).toBeNull()
    expect(spokenText({ type: 'context-summary', role: 'USER', content: 'x' })).toBeNull()
    expect(spokenText({ type: 'message', role: 'TOOL', content: 'x' })).toBeNull()
  })
})

describe('findAbsentMentions', () => {
  const messages = [
    { id: 'm1', type: 'message', role: 'ASSISTANT', content: 'The Host names Vergil.', systemSender: 'host' },
    { id: 'm2', type: 'message', role: 'USER', content: 'Friday, Abby says hi.' },
    { id: 'm3', type: 'message', role: 'ASSISTANT', content: 'Abigail and Vergil, then.' },
  ]

  it('finds the first spoken mention of each absent character, with the name as written', () => {
    const found = findAbsentMentions({
      messages,
      candidates: [friday, charlie, abigail, vergil],
      isInRoom: presenceOf({ participants: [seat('p1', 'friday')], chatType: 'salon', personaName: 'Charlie' }),
      userCharacterName: 'Charlie',
    })
    expect(found.map(f => [f.characterId, f.messageId, f.text])).toEqual(
      expect.arrayContaining([
        ['abigail', 'm2', 'Abby'],
        ['vergil', 'm3', 'Vergil'],
      ]),
    )
    expect(found).toHaveLength(2)
    expect(found.find(f => f.characterId === 'abigail')!.card.body).toBe('Married to Charlie.')
  })

  it('ignores messages without ids and characters in the room', () => {
    const found = findAbsentMentions({
      messages: [{ type: 'message', role: 'USER', content: 'Abby' }],
      candidates: [abigail],
      isInRoom: () => false,
    })
    expect(found).toEqual([])
  })
})
