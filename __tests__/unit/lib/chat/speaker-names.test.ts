/**
 * The shared speaker resolver (bug 161).
 *
 * Two things must hold or a transcript goes back to `USER:` / `ASSISTANT:` and
 * the fold model starts inventing names again: every seat resolves, removed
 * ones included, and a character read that fails costs a label rather than
 * throwing into a best-effort pass.
 */

jest.mock('@/lib/repositories/factory', () => ({
  getRepositories: jest.fn(),
}))

import { resolveSpeakerNames, speakerLabel } from '@/lib/chat/speaker-names'
import { getRepositories } from '@/lib/repositories/factory'

const mockRepos = getRepositories as jest.Mock

type AnyRecord = Record<string, unknown>

const CHARS: Record<string, string> = {
  'char-friday': 'Friday',
  'char-charlie': 'Charlie',
  'char-gone': 'Ambrose',
}

function primeRepos(findByIdRaw?: jest.Mock) {
  const impl =
    findByIdRaw ??
    jest.fn(async (id: string) => (CHARS[id] ? { id, name: CHARS[id] } : null))
  mockRepos.mockReturnValue({ characters: { findByIdRaw: impl } })
  return impl
}

function chat(participants: AnyRecord[]) {
  return { participants } as never
}

const TWO_SEATS = [
  // The user's persona is an ordinary CHARACTER seat — no special case.
  { id: 'p-charlie', type: 'CHARACTER', status: 'active', characterId: 'char-charlie' },
  { id: 'p-friday', type: 'CHARACTER', status: 'active', characterId: 'char-friday' },
]

beforeEach(() => {
  jest.clearAllMocks()
  primeRepos()
})

describe('resolveSpeakerNames', () => {
  it('resolves both seats of a two-seat chat, persona included', async () => {
    const names = await resolveSpeakerNames(chat(TWO_SEATS))

    expect(names.get('p-charlie')).toBe('Charlie')
    expect(names.get('p-friday')).toBe('Friday')
  })

  it('resolves a seat that has since been removed from the chat', async () => {
    const names = await resolveSpeakerNames(
      chat([
        ...TWO_SEATS,
        { id: 'p-gone', type: 'CHARACTER', status: 'removed', characterId: 'char-gone' },
      ])
    )

    expect(names.get('p-gone')).toBe('Ambrose')
  })

  it('resolves a silent seat', async () => {
    const names = await resolveSpeakerNames(
      chat([{ id: 'p-quiet', type: 'CHARACTER', status: 'silent', characterId: 'char-friday' }])
    )

    expect(names.get('p-quiet')).toBe('Friday')
  })

  it('skips a seat with no characterId without reading anything', async () => {
    const findByIdRaw = primeRepos()

    const names = await resolveSpeakerNames(
      chat([{ id: 'p-bare', type: 'USER', status: 'active', characterId: null }])
    )

    expect(names.has('p-bare')).toBe(false)
    expect(findByIdRaw).not.toHaveBeenCalled()
  })

  it('leaves a seat unnamed when the character row is gone', async () => {
    const names = await resolveSpeakerNames(
      chat([{ id: 'p-orphan', type: 'CHARACTER', status: 'active', characterId: 'char-missing' }])
    )

    expect(names.has('p-orphan')).toBe(false)
  })

  it('falls back without throwing when a read blows up on a broken vault', async () => {
    primeRepos(
      jest.fn(async (id: string) => {
        if (id === 'char-friday') throw new Error('vault unavailable')
        return { id, name: CHARS[id] }
      })
    )

    const names = await resolveSpeakerNames(chat(TWO_SEATS))

    expect(names.has('p-friday')).toBe(false)
    // The other seat is unharmed — one bad vault does not cost the whole map.
    expect(names.get('p-charlie')).toBe('Charlie')
  })

  it('reads each seat once', async () => {
    const findByIdRaw = primeRepos()

    await resolveSpeakerNames(chat(TWO_SEATS))

    expect(findByIdRaw).toHaveBeenCalledTimes(2)
  })
})

describe('speakerLabel', () => {
  const names = new Map([['p-friday', 'Friday']])

  it('uses the resolved name when the seat is known', () => {
    expect(speakerLabel({ participantId: 'p-friday', role: 'ASSISTANT' } as never, names)).toBe(
      'Friday'
    )
  })

  it('falls back to User for an unresolvable USER turn', () => {
    expect(speakerLabel({ participantId: 'p-nobody', role: 'USER' } as never, names)).toBe('User')
    expect(speakerLabel({ participantId: null, role: 'USER' } as never, names)).toBe('User')
  })

  it('falls back to Character for everything else', () => {
    expect(speakerLabel({ participantId: null, role: 'ASSISTANT' } as never, names)).toBe(
      'Character'
    )
  })

  it('never returns a bare LLM role', () => {
    const label = speakerLabel({ participantId: undefined, role: 'ASSISTANT' } as never, names)
    expect(label).not.toBe('ASSISTANT')
    expect(label).not.toBe('assistant')
  })
})
