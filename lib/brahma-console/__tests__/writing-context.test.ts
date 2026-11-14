/**
 * @jest-environment node
 *
 * Writing Assistant context resolution and the manifest: resolution per kind,
 * de-duplication, archived characters without a vault, missing refs reported,
 * empty-is-absent, real store names (never `self`), and no source content.
 */

import { resolveConsoleContext, renderConsoleContextManifest, dedupeContextRefs } from '../writing-context'

jest.mock('@/lib/mount-index/reach', () => ({
  resolveOwnerStore: jest.fn(),
  resolveProjectMountPointIds: jest.fn(),
}))

jest.mock('@/lib/chat/speaker-names', () => ({
  resolveSpeakerNames: jest.fn(),
}))

import { resolveOwnerStore, resolveProjectMountPointIds } from '@/lib/mount-index/reach'
import { resolveSpeakerNames } from '@/lib/chat/speaker-names'

const CHAT = '11111111-1111-4111-8111-111111111111'
const HELP_CHAT = '22222222-2222-4222-8222-222222222222'
const GONE_CHAT = '33333333-3333-4333-8333-333333333333'
const PROJECT = '44444444-4444-4444-8444-444444444444'
const STORE = '55555555-5555-4555-8555-555555555555'
const VAULT_VIV = '66666666-6666-4666-8666-666666666666'
const PROJECT_STORE = '77777777-7777-4777-8777-777777777777'
const GENERAL = '88888888-8888-4888-8888-888888888888'

const STORES: Record<string, string> = {
  [STORE]: 'House Style',
  [VAULT_VIV]: 'Vivienne Hale Character Vault',
  [PROJECT_STORE]: 'Ashfall',
  [GENERAL]: 'Quilltap General',
}

function makeRepos() {
  return {
    chats: {
      findById: jest.fn(async (id: string) => {
        if (id === CHAT) {
          return {
            id: CHAT,
            userId: 'u1',
            chatType: 'salon',
            title: 'The Night Train',
            messageCount: 212,
            createdAt: '2026-09-02T12:00:00Z',
            lastMessageAt: '2026-10-19T12:00:00Z',
            participants: [
              { id: 'p1', characterId: 'char-viv' },
              { id: 'p2', characterId: 'char-tob' },
              { id: 'p3', characterId: null },
            ],
            contextSummary: 'SECRET SUMMARY CONTENT',
          }
        }
        if (id === HELP_CHAT) return { id: HELP_CHAT, userId: 'u1', chatType: 'help', title: 'Help', participants: [] }
        return null
      }),
    },
    projects: {
      findByIdRaw: jest.fn(async (id: string) => (id === PROJECT ? { id: PROJECT, name: 'Ashfall' } : null)),
    },
    docMountPoints: {
      findById: jest.fn(async (id: string) => (STORES[id] ? { id, name: STORES[id] } : null)),
    },
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  jest.mocked(resolveSpeakerNames).mockResolvedValue(new Map([['p1', 'Vivienne Hale'], ['p2', 'Tobias']]))
  jest.mocked(resolveOwnerStore).mockImplementation(async (scope, id) => {
    if (scope === 'general') return { scope, mountPointId: GENERAL, owner: { id: null, name: 'Quilltap General' } }
    if (scope === 'character' && id === 'char-viv') {
      return { scope, mountPointId: VAULT_VIV, owner: { id, name: 'Vivienne Hale' }, character: { id, name: 'Vivienne Hale', userId: 'u1', archivedAt: null } }
    }
    if (scope === 'character' && id === 'char-tob') {
      return { scope, mountPointId: 'tob-vault', owner: { id, name: 'Tobias' }, character: { id, name: 'Tobias', userId: 'u1', archivedAt: '2026-10-01T00:00:00Z' } }
    }
    return null
  })
  jest.mocked(resolveProjectMountPointIds).mockResolvedValue([PROJECT_STORE, VAULT_VIV])
})

describe('resolveConsoleContext', () => {
  it('resolves every kind, derives the cast vaults, and marks archived characters with no vault', async () => {
    const repos = makeRepos()
    const resolved = await resolveConsoleContext(repos as never, 'u1', [
      { kind: 'chat', id: CHAT },
      { kind: 'project', id: PROJECT },
      { kind: 'store', id: STORE },
      { kind: 'general' },
    ])

    expect(resolved.conversations).toHaveLength(1)
    expect(resolved.conversations[0]).toMatchObject({ title: 'The Night Train', chatType: 'salon', messageCount: 212 })
    expect(resolved.conversations[0].cast).toEqual([
      { characterId: 'char-viv', name: 'Vivienne Hale', archived: false, vaultStoreName: 'Vivienne Hale Character Vault' },
      { characterId: 'char-tob', name: 'Tobias', archived: true, vaultStoreName: null },
    ])
    expect(resolved.characterVaults).toEqual([
      { characterId: 'char-viv', name: 'Vivienne Hale', storeName: 'Vivienne Hale Character Vault', via: ['The Night Train'] },
    ])
    // The project's link to the vault is already listed under the character.
    expect(resolved.projects).toEqual([{ ref: { kind: 'project', id: PROJECT }, name: 'Ashfall', storeNames: ['Ashfall'] }])
    expect(resolved.stores).toEqual([{ ref: { kind: 'store', id: STORE }, name: 'House Style' }])
    expect(resolved.general).toEqual({ storeName: 'Quilltap General' })
    expect(resolved.missing).toEqual([])
  })

  it('lists a store named twice once in the manifest', async () => {
    const repos = makeRepos()
    const resolved = await resolveConsoleContext(repos as never, 'u1', [
      { kind: 'chat', id: CHAT },
      { kind: 'store', id: VAULT_VIV },
      { kind: 'store', id: GENERAL },
      { kind: 'general' },
    ])
    expect(resolved.stores).toEqual([{ ref: { kind: 'store', id: VAULT_VIV }, name: 'Vivienne Hale Character Vault', listedElsewhere: true }])
    const manifest = renderConsoleContextManifest(resolved, 'UTC')
    expect(manifest.match(/Vivienne Hale Character Vault/g)).toHaveLength(1)
    expect(manifest.match(/Quilltap General"/g)).toHaveLength(1)
    expect(manifest).not.toContain('### Document stores')
  })

  it('reports missing refs and refuses non-conversation chats, without throwing', async () => {
    const repos = makeRepos()
    const resolved = await resolveConsoleContext(repos as never, 'u1', [
      { kind: 'chat', id: GONE_CHAT },
      { kind: 'chat', id: HELP_CHAT },
      { kind: 'project', id: GONE_CHAT },
      { kind: 'store', id: GONE_CHAT },
    ])
    expect(resolved.missing).toHaveLength(4)
    expect(renderConsoleContextManifest(resolved)).toBe('')
  })

  it('de-duplicates refs', () => {
    expect(dedupeContextRefs([{ kind: 'general' }, { kind: 'store', id: STORE }, { kind: 'general' }, { kind: 'store', id: STORE }]))
      .toEqual([{ kind: 'general' }, { kind: 'store', id: STORE }])
  })
})

describe('renderConsoleContextManifest', () => {
  it('is empty when nothing is named', async () => {
    const resolved = await resolveConsoleContext(makeRepos() as never, 'u1', [])
    expect(renderConsoleContextManifest(resolved)).toBe('')
  })

  it('names stores by their real names and carries no content', async () => {
    const resolved = await resolveConsoleContext(makeRepos() as never, 'u1', [
      { kind: 'chat', id: CHAT },
      { kind: 'project', id: PROJECT },
      { kind: 'store', id: STORE },
      { kind: 'general' },
    ])
    const manifest = renderConsoleContextManifest(resolved, 'UTC')
    expect(manifest).toContain('## Sources for this piece')
    expect(manifest).toContain(`"The Night Train" — id ${CHAT} · 212 messages · 2026-09-02 to 2026-10-19`)
    expect(manifest).toContain('Cast: Vivienne Hale, Tobias (archived)')
    expect(manifest).toContain('- Vivienne Hale — store "Vivienne Hale Character Vault"')
    expect(manifest).toContain('- "Ashfall" — stores: "Ashfall"')
    expect(manifest).toContain('- "House Style"')
    expect(manifest).toContain('- store "Quilltap General"')
    expect(manifest).not.toMatch(/\bself\b/)
    expect(manifest).not.toContain('SECRET SUMMARY CONTENT')
    // Sections in order.
    const order = ['### Conversations', '### Character vaults', '### Projects', '### Document stores', '### Quilltap General']
      .map(h => manifest.indexOf(h))
    expect([...order].sort((a, b) => a - b)).toEqual(order)
  })
})
