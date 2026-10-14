/** @jest-environment node */

jest.mock('@/lib/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), child: jest.fn().mockReturnThis() },
}))
jest.mock('@/lib/file-storage/character-vault-bridge', () => ({ getCharacterVaultStore: jest.fn() }))

import { resolveSaveAttribution } from '@/lib/photos/save-attribution'
import { getCharacterVaultStore } from '@/lib/file-storage/character-vault-bridge'

const getVault = getCharacterVaultStore as jest.Mock
const chars: Record<string, any> = {}
const repos = { characters: { findById: jest.fn(async (id: string) => chars[id] ?? null) } } as any

function chat(over: any = {}): any {
  return { id: 'chat-1', participants: [], ...over }
}

beforeEach(() => {
  jest.clearAllMocks()
  for (const k of Object.keys(chars)) delete chars[k]
  getVault.mockResolvedValue(null)
})

describe('character vault albums', () => {
  it('attributes to the character whose vault is the target', async () => {
    chars.c1 = { id: 'c1', name: 'Ada' }
    getVault.mockResolvedValue({ mountPointId: 'mp1', mountPointName: 'Ada Vault' })
    const r = await resolveSaveAttribution(
      chat({ participants: [{ id: 'p1', type: 'CHARACTER', characterId: 'c1' }] }),
      'mp1',
      { id: 'u', name: 'Op' },
      repos,
    )
    expect(r).toEqual({ name: 'Ada', id: 'c1', role: 'character' })
  })

  it('falls back to the vault name when the character cannot be loaded', async () => {
    getVault.mockResolvedValue({ mountPointId: 'mp1', mountPointName: 'Ada Vault' })
    const r = await resolveSaveAttribution(
      chat({ participants: [{ id: 'p1', type: 'CHARACTER', characterId: 'gone' }] }),
      'mp1',
      {},
      repos,
    )
    expect(r).toEqual({ name: 'Ada Vault', id: 'gone', role: 'character' })
  })

  it('skips participants without a characterId or of non-CHARACTER type', async () => {
    const r = await resolveSaveAttribution(
      chat({ participants: [{ id: 'p1', type: 'CHARACTER' }, { id: 'p2', type: 'PERSONA', characterId: 'c9' }] }),
      'mp1',
      { id: 'u', name: 'Op' },
      repos,
    )
    expect(getVault).not.toHaveBeenCalled()
    expect(r).toEqual({ name: 'Op', id: 'u', role: 'user' })
  })

  it('moves on when the vault belongs to another mount point', async () => {
    getVault.mockResolvedValue({ mountPointId: 'other', mountPointName: 'X' })
    const r = await resolveSaveAttribution(
      chat({ participants: [{ id: 'p1', type: 'CHARACTER', characterId: 'c1' }] }),
      'mp1',
      { id: 'u', name: 'Op' },
      repos,
    )
    expect(r.role).toBe('user')
  })

  it('moves on when a participant has no vault, and picks a later match', async () => {
    chars.c2 = { id: 'c2', name: 'Bea' }
    getVault.mockImplementation(async (id: string) =>
      id === 'c2' ? { mountPointId: 'mp1', mountPointName: 'Bea Vault' } : null,
    )
    const r = await resolveSaveAttribution(
      chat({
        participants: [
          { id: 'p1', type: 'CHARACTER', characterId: 'c1' },
          { id: 'p2', type: 'CHARACTER', characterId: 'c2' },
        ],
      }),
      'mp1',
      {},
      repos,
    )
    expect(r).toEqual({ name: 'Bea', id: 'c2', role: 'character' })
  })
})

describe('operator attribution', () => {
  it('uses the actively typing user-controlled persona', async () => {
    chars.a = { id: 'a', name: 'First' }
    chars.b = { id: 'b', name: 'Second' }
    const r = await resolveSaveAttribution(
      chat({
        activeTypingParticipantId: 'p2',
        participants: [
          { id: 'p1', controlledBy: 'user', characterId: 'a' },
          { id: 'p2', controlledBy: 'user', characterId: 'b' },
        ],
      }),
      'mp1',
      { id: 'u', name: 'Op' },
      repos,
    )
    expect(r).toEqual({ name: 'Second', id: 'b', role: 'user' })
  })

  it('falls back to the first user-controlled participant', async () => {
    chars.a = { id: 'a', name: 'First' }
    const r = await resolveSaveAttribution(
      chat({
        participants: [
          { id: 'p0', controlledBy: 'llm', characterId: 'x' },
          { id: 'p1', controlledBy: 'user', characterId: 'a' },
        ],
      }),
      'mp1',
      { id: 'u', name: 'Op' },
      repos,
    )
    expect(r).toEqual({ name: 'First', id: 'a', role: 'user' })
  })

  it('ignores an active-typing id that is not user-controlled', async () => {
    chars.a = { id: 'a', name: 'First' }
    const r = await resolveSaveAttribution(
      chat({
        activeTypingParticipantId: 'p0',
        participants: [
          { id: 'p0', controlledBy: 'llm', characterId: 'x' },
          { id: 'p1', controlledBy: 'user', characterId: 'a' },
        ],
      }),
      'mp1',
      {},
      repos,
    )
    expect(r.name).toBe('First')
  })

  it('uses the account name when the persona cannot be resolved', async () => {
    const r = await resolveSaveAttribution(
      chat({ participants: [{ id: 'p1', controlledBy: 'user', characterId: 'missing' }] }),
      'mp1',
      { id: 'u', name: 'Op' },
      repos,
    )
    expect(r).toEqual({ name: 'Op', id: 'u', role: 'user' })
  })

  it('uses the account name when the user participant has no character', async () => {
    const r = await resolveSaveAttribution(
      chat({ participants: [{ id: 'p1', controlledBy: 'user' }] }),
      'mp1',
      { id: 'u', name: 'Op' },
      repos,
    )
    expect(repos.characters.findById).not.toHaveBeenCalled()
    expect(r).toEqual({ name: 'Op', id: 'u', role: 'user' })
  })

  it('falls back to "Quilltap" and null id with no user info', async () => {
    expect(await resolveSaveAttribution(chat(), 'mp1', {}, repos)).toEqual({
      name: 'Quilltap',
      id: null,
      role: 'user',
    })
    expect(await resolveSaveAttribution(chat(), 'mp1', { id: null, name: null }, repos)).toEqual({
      name: 'Quilltap',
      id: null,
      role: 'user',
    })
  })

  it('tolerates a chat with undefined participants', async () => {
    const r = await resolveSaveAttribution({ id: 'c' } as any, 'mp1', { name: 'Op' }, repos)
    expect(r).toEqual({ name: 'Op', id: null, role: 'user' })
  })
})
