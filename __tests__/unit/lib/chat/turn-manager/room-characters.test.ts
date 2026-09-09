/**
 * The room's character map — one batched read, every present seat.
 *
 * The bug this closes: four of the six turn paths built their map from
 * `getActiveCharacterParticipants`, which returns LLM seats only, so a seat the
 * human drives never reached the map. Its character's talkativeness was
 * invisible to the rotation draw (falling through to the 0.5 default) and its
 * `archivedAt` was invisible to the seat filter. The last test here is the one
 * that matters: a loud user seat now actually leads the rotation it should.
 */

import {
  loadRoomCharacters,
  drawCycleOrder,
  cycleCandidates,
} from '@/lib/chat/turn-manager'
import type { ChatParticipantBase, Character } from '@/lib/schemas/types'

const now = new Date().toISOString()

const makeCharacter = (id: string, overrides: Partial<Character> = {}): Character => ({
  id,
  userId: 'user-1',
  name: `Character ${id}`,
  title: null,
  description: null,
  personality: null,
  scenario: null,
  firstMessage: null,
  exampleDialogues: null,
  systemPrompts: [],
  avatarUrl: null,
  defaultImageId: null,
  defaultConnectionProfileId: null,
  sillyTavernData: null,
  isFavorite: false,
  talkativeness: 0.5,
  partnerLinks: [],
  tags: [],
  avatarOverrides: [],
  physicalDescriptions: [],
  createdAt: now,
  updatedAt: now,
  ...overrides,
})

const makeParticipant = (
  participantId: string,
  characterId: string | null,
  overrides: Partial<ChatParticipantBase> = {},
): ChatParticipantBase => ({
  id: participantId,
  type: 'CHARACTER',
  characterId,
  controlledBy: 'llm',
  connectionProfileId: null,
  imageProfileId: null,
  displayOrder: 0,
  isActive: true,
  status: 'active',
  hasHistoryAccess: true,
  joinScenario: null,
  createdAt: now,
  updatedAt: now,
  ...overrides,
})

/**
 * A stand-in for the batched read. Like the real `findByIds` it returns only the
 * rows it could resolve — a character whose vault is unavailable is dropped by
 * the list overlay rather than thrown, which is the whole reason this helper
 * batches instead of looping `findById`.
 */
const makeRepos = (rows: Character[]) => {
  const findByIds = jest.fn(async (ids: string[]) =>
    rows.filter(c => ids.includes(c.id)),
  )
  return { repos: { characters: { findByIds } }, findByIds }
}

describe('loadRoomCharacters', () => {
  it('includes user-driven seats, not just LLM ones', async () => {
    const participants = [
      makeParticipant('p-llm', 'char-llm'),
      makeParticipant('p-user', 'char-user', { controlledBy: 'user' }),
    ]
    const { repos, findByIds } = makeRepos([
      makeCharacter('char-llm'),
      makeCharacter('char-user', { talkativeness: 0.9 }),
    ])

    const map = await loadRoomCharacters(repos, participants)

    expect([...findByIds.mock.calls[0][0]].sort()).toEqual(['char-llm', 'char-user'])
    expect(map.get('char-user')?.talkativeness).toBe(0.9)
  })

  it('reads the whole room in ONE call, not one per seat', async () => {
    const participants = [
      makeParticipant('p1', 'char-1'),
      makeParticipant('p2', 'char-2'),
      makeParticipant('p3', 'char-3'),
      makeParticipant('p4', 'char-4', { controlledBy: 'user' }),
    ]
    const { repos, findByIds } = makeRepos(
      ['char-1', 'char-2', 'char-3', 'char-4'].map(id => makeCharacter(id)),
    )

    const map = await loadRoomCharacters(repos, participants)

    expect(findByIds).toHaveBeenCalledTimes(1)
    expect(map.size).toBe(4)
  })

  it('asks only for seats that are present and carry a character', async () => {
    const participants = [
      makeParticipant('p-active', 'char-1'),
      makeParticipant('p-silent', 'char-2', { status: 'silent' }),
      makeParticipant('p-left', 'char-3', { status: 'departed' }),
      makeParticipant('p-nochar', null),
      makeParticipant('p-narrator', 'char-4', { type: 'NARRATOR' as ChatParticipantBase['type'] }),
    ]
    const { repos, findByIds } = makeRepos(
      ['char-1', 'char-2', 'char-3', 'char-4'].map(id => makeCharacter(id)),
    )

    await loadRoomCharacters(repos, participants)

    // Silent seats are present (they hold a place in the rotation); departed
    // seats, character-less seats and non-CHARACTER seats are not.
    expect([...findByIds.mock.calls[0][0]].sort()).toEqual(['char-1', 'char-2'])
  })

  it('dedupes two seats playing the same character', async () => {
    const participants = [
      makeParticipant('p1', 'char-1'),
      makeParticipant('p2', 'char-1'),
    ]
    const { repos, findByIds } = makeRepos([makeCharacter('char-1')])

    await loadRoomCharacters(repos, participants)

    expect(findByIds.mock.calls[0][0]).toEqual(['char-1'])
  })

  it('skips the read entirely when no seat is present', async () => {
    const { repos, findByIds } = makeRepos([makeCharacter('char-1')])

    const map = await loadRoomCharacters(repos, [
      makeParticipant('p-left', 'char-1', { status: 'departed' }),
    ])

    expect(findByIds).not.toHaveBeenCalled()
    expect(map.size).toBe(0)
  })

  it('leaves an unreadable character out of the map instead of throwing', async () => {
    const participants = [
      makeParticipant('p1', 'char-1'),
      makeParticipant('p2', 'char-shelved'),
    ]
    // The list overlay drops a character whose vault is unavailable.
    const { repos } = makeRepos([makeCharacter('char-1')])

    const map = await loadRoomCharacters(repos, participants)

    expect(map.has('char-1')).toBe(true)
    expect(map.has('char-shelved')).toBe(false)
  })

  it('keeps a seat whose character could not be read in the rotation', async () => {
    const participants = [
      makeParticipant('p1', 'char-1'),
      makeParticipant('p2', 'char-shelved'),
    ]
    const { repos } = makeRepos([makeCharacter('char-1')])

    const map = await loadRoomCharacters(repos, participants)

    // Dropping a seat over a failed lookup would silently shrink the room.
    expect(cycleCandidates(participants, map).map(p => p.id)).toEqual(['p1', 'p2'])
  })

  it('prefers a preloaded character over the copy the read returned', async () => {
    const participants = [makeParticipant('p1', 'char-1')]
    const { repos } = makeRepos([makeCharacter('char-1', { name: 'Stale' })])

    const map = await loadRoomCharacters(repos, participants, {
      preloaded: [makeCharacter('char-1', { name: 'Fresh' })],
    })

    expect(map.get('char-1')?.name).toBe('Fresh')
  })

  it('ignores empty preloaded entries', async () => {
    const participants = [makeParticipant('p1', 'char-1')]
    const { repos } = makeRepos([makeCharacter('char-1', { name: 'Real' })])

    const map = await loadRoomCharacters(repos, participants, {
      preloaded: [null, undefined],
    })

    expect(map.get('char-1')?.name).toBe('Real')
  })

  it("counts a user seat's talkativeness in the rotation draw", async () => {
    // The regression proper, and it has to be measured as a *difference*. A map
    // built from LLM seats alone weights the human at 0.5 whatever their
    // character says, so the two runs below would come out the same. Only a map
    // that can see the seat separates them.
    const drawsLedByUser = async (userTalkativeness: number) => {
      const participants = [
        makeParticipant('p-llm-1', 'char-llm-1'),
        makeParticipant('p-llm-2', 'char-llm-2'),
        makeParticipant('p-user', 'char-user', { controlledBy: 'user' }),
      ]
      const { repos } = makeRepos([
        makeCharacter('char-llm-1', { talkativeness: 0.98 }),
        makeCharacter('char-llm-2', { talkativeness: 0.98 }),
        makeCharacter('char-user', { talkativeness: userTalkativeness }),
      ])
      const characters = await loadRoomCharacters(repos, participants)

      let led = 0
      for (let i = 0; i < 300; i++) {
        if (drawCycleOrder({ participants, characters })[0] === 'p-user') led++
      }
      return led
    }

    const loud = await drawsLedByUser(0.98)
    const quiet = await drawsLedByUser(0.02)

    // ~33% against ~1%. At the 0.5 default both runs sit near 20%.
    expect(loud).toBeGreaterThan(quiet * 5)
    expect(quiet).toBeLessThan(15)
  })

  it("excludes a user seat whose character is archived", async () => {
    const participants = [
      makeParticipant('p-llm', 'char-llm'),
      makeParticipant('p-user', 'char-user', { controlledBy: 'user' }),
    ]
    const { repos } = makeRepos([
      makeCharacter('char-llm'),
      makeCharacter('char-user', { archivedAt: now }),
    ])

    const characters = await loadRoomCharacters(repos, participants)

    // Invisible to the archived filter while the map held LLM seats only.
    expect(cycleCandidates(participants, characters).map(p => p.id)).toEqual(['p-llm'])
  })
})
