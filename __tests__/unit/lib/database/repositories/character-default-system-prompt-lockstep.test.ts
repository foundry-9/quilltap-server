/**
 * The default system prompt is written in two places at once.
 *
 * A character records its default prompt both as the `isDefault` flag inside
 * the prompt and as the `defaultSystemPromptId` column on the row — and every
 * consumer (chat creation, the announcement dialog, the impersonation voice
 * preview) reads the column *first*, falling back to the flag only when the
 * column is null. A write that moved one without the other therefore produced
 * an editor showing the new default and chats still opening with the old one.
 *
 * These tests pin that every system-prompt write moves both faces together.
 */

import { describe, expect, it, beforeEach } from '@jest/globals'

jest.mock('@/lib/logger', () => {
  const makeLogger = (): any => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    child: jest.fn(() => makeLogger()),
  })
  return { logger: makeLogger() }
})

import { CharactersRepository } from '@/lib/database/repositories/characters.repository'
import type { Character, CharacterSystemPrompt } from '@/lib/schemas/types'

const CHAR_ID = 'char-1'

function prompt(id: string, isDefault: boolean): CharacterSystemPrompt {
  return {
    id,
    name: `Prompt ${id}`,
    content: `Content for ${id}`,
    isDefault,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

/**
 * A repository whose two I/O ends are stubbed: `findById` hands back the
 * character under test, `update` records the patch the method built.
 */
function stubRepo(prompts: CharacterSystemPrompt[], defaultSystemPromptId: string | null) {
  const repo = new CharactersRepository()
  const character = {
    id: CHAR_ID,
    systemPrompts: prompts,
    defaultSystemPromptId,
  } as unknown as Character

  const update = jest.fn(async (_id: string, patch: Partial<Character>) => ({
    ...character,
    ...patch,
  }))

  jest.spyOn(repo, 'findById').mockResolvedValue(character)
  ;(repo as unknown as { update: unknown }).update = update

  return { repo, update }
}

function patchOf(update: jest.Mock): Partial<Character> {
  return update.mock.calls[0][1] as Partial<Character>
}

beforeEach(() => {
  jest.clearAllMocks()
})

describe('updateSystemPrompt', () => {
  it('drags defaultSystemPromptId along when a prompt is promoted', async () => {
    const { repo, update } = stubRepo([prompt('a', true), prompt('b', false)], 'a')

    await repo.updateSystemPrompt(CHAR_ID, 'b', { isDefault: true })

    const patch = patchOf(update as jest.Mock)
    expect(patch.defaultSystemPromptId).toBe('b')
    expect(patch.systemPrompts?.map((p) => [p.id, p.isDefault])).toEqual([
      ['a', false],
      ['b', true],
    ])
  })

  it('leaves the column pointing at the standing default on an unrelated edit', async () => {
    const { repo, update } = stubRepo([prompt('a', true), prompt('b', false)], 'a')

    await repo.updateSystemPrompt(CHAR_ID, 'b', { name: 'Renamed' })

    expect(patchOf(update as jest.Mock).defaultSystemPromptId).toBe('a')
  })
})

describe('addSystemPrompt', () => {
  /**
   * The id minted for a brand-new prompt is transient — the vault re-keys the
   * prompt from its file path on the next read — so the column is left null
   * rather than made to name something that will not exist. Null sends readers
   * to the `isDefault` flag, which the write below sets correctly.
   */
  it('leaves the column null rather than naming a not-yet-keyed prompt', async () => {
    const { repo, update } = stubRepo([prompt('a', true)], 'a')

    const added = await repo.addSystemPrompt(CHAR_ID, {
      name: 'Front-Line',
      content: 'Use this when the fighting starts.',
      isDefault: true,
    })

    expect(added).not.toBeNull()
    const patch = patchOf(update as jest.Mock)
    expect(patch.defaultSystemPromptId).toBeNull()
    expect(patch.systemPrompts?.find((p) => p.isDefault)?.id).toBe(added!.id)
  })

  it('keeps the column on the standing default when the addition is not one', async () => {
    const { repo, update } = stubRepo([prompt('a', true)], 'a')

    await repo.addSystemPrompt(CHAR_ID, {
      name: 'Front-Line',
      content: 'Use this when the fighting starts.',
      isDefault: false,
    })

    expect(patchOf(update as jest.Mock).defaultSystemPromptId).toBe('a')
  })

  it('promotes the first prompt a bare character receives, via the flag', async () => {
    const { repo, update } = stubRepo([], null)

    const added = await repo.addSystemPrompt(CHAR_ID, {
      name: 'Main',
      content: 'The everyday voice.',
      isDefault: false,
    })

    const patch = patchOf(update as jest.Mock)
    expect(patch.systemPrompts?.find((p) => p.isDefault)?.id).toBe(added!.id)
    expect(patch.defaultSystemPromptId).toBeNull()
  })
})

describe('deleteSystemPrompt', () => {
  it('follows the promotion when the standing default is deleted', async () => {
    const { repo, update } = stubRepo([prompt('a', true), prompt('b', false)], 'a')

    await repo.deleteSystemPrompt(CHAR_ID, 'a')

    const patch = patchOf(update as jest.Mock)
    expect(patch.defaultSystemPromptId).toBe('b')
    expect(patch.systemPrompts?.map((p) => p.id)).toEqual(['b'])
  })

  it('clears the column when the last prompt goes', async () => {
    const { repo, update } = stubRepo([prompt('a', true)], 'a')

    await repo.deleteSystemPrompt(CHAR_ID, 'a')

    expect(patchOf(update as jest.Mock).defaultSystemPromptId).toBeNull()
  })
})

describe('setDefaultSystemPrompt', () => {
  it('moves flag and column together', async () => {
    const { repo, update } = stubRepo([prompt('a', true), prompt('b', false)], 'a')

    await repo.setDefaultSystemPrompt(CHAR_ID, 'b')

    const patch = patchOf(update as jest.Mock)
    expect(patch.defaultSystemPromptId).toBe('b')
    expect(patch.systemPrompts?.find((p) => p.isDefault)?.id).toBe('b')
  })

  it('clears both when handed null', async () => {
    const { repo, update } = stubRepo([prompt('a', true), prompt('b', false)], 'a')

    await repo.setDefaultSystemPrompt(CHAR_ID, null)

    const patch = patchOf(update as jest.Mock)
    expect(patch.defaultSystemPromptId).toBeNull()
    expect(patch.systemPrompts?.some((p) => p.isDefault)).toBe(false)
  })

  it('refuses a prompt the character does not have, writing nothing', async () => {
    const { repo, update } = stubRepo([prompt('a', true)], 'a')

    await expect(repo.setDefaultSystemPrompt(CHAR_ID, 'nope')).resolves.toBeNull()
    expect(update).not.toHaveBeenCalled()
  })
})
