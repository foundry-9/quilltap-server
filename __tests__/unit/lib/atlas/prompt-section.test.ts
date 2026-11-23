/**
 * @jest-environment node
 *
 * The Atlas as lore (atlas spec §5.5 and §10): empty is absent, the recent
 * window, the first-turn scenario rule, regeneration, the cap and the budget,
 * the per-character audience, the recall source, and never throwing.
 */

jest.mock('@/lib/logger', () => {
  const mock = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), child: jest.fn() }
  mock.child.mockReturnValue(mock)
  return { logger: mock }
})
jest.mock('@/lib/repositories/factory', () => require('@/__tests__/helpers/inventory-fake-store').factoryModule())
jest.mock('@/lib/mount-index/database-store', () => require('@/__tests__/helpers/inventory-fake-store').databaseStoreModule())
jest.mock('@/lib/mount-index/folder-paths', () => require('@/__tests__/helpers/inventory-fake-store').folderPathsModule())
jest.mock('@/lib/instance-settings', () => require('@/__tests__/helpers/inventory-fake-store').instanceSettingsModule())
jest.mock('@/lib/mount-index/tiered-mount-pool', () => require('@/__tests__/helpers/inventory-fake-store').tieredPoolModule())
jest.mock('@/lib/mount-index/ensure-owner-store', () => ({ ensureOwnerOfficialStore: jest.fn() }))
jest.mock('@/lib/realtime/bus', () => ({ publishRealtime: jest.fn() }))
jest.mock('@/lib/memory/cheap-llm-tasks', () => ({ stripToolArtifacts: (s: string) => s }))

import { addCharacter, getFakeRepos, resetStore } from '@/__tests__/helpers/inventory-fake-store'
import { resolveAtlasLocation, type AtlasLocation } from '@/lib/atlas/location'
import { createAtlasEntry } from '@/lib/atlas/item-mutations'
import { loadAtlasPool } from '@/lib/atlas/pool'
import {
  ATLAS_LORE_CUT_MARK,
  ATLAS_LORE_MAX_NAMED,
  atlasRecallSourceFor,
  buildNamedAtlasLore,
  cutAtlasEntryBlock,
  isFirstTurnUnderScenario,
  joinAtlasLore,
  packNamedAtlasEntries,
  renderAtlasEntryBlock,
  type AtlasHistoryEvent,
} from '@/lib/atlas/prompt-section'

const repos = () => getFakeRepos() as never
const at = async (scope: 'character' | 'project' | 'general', id: string | null) =>
  (await resolveAtlasLocation(scope, id, repos(), 'user-1')) as AtlasLocation

const chat = { id: 'chat-1', projectId: 'project-1', scenarioText: 'They arrive in the convertible.' }
const scenarioRow: AtlasHistoryEvent = { id: 'h1', type: 'message', role: 'ASSISTANT', systemSender: 'host', systemKind: 'scenario', content: chat.scenarioText }
const line = (id: string, participantId: string, content = 'Hello.'): AtlasHistoryEvent => ({ id, type: 'message', role: 'ASSISTANT', participantId, content })

/** One token per word: enough to test the budget without a tokenizer. */
const words = (text: string) => text.split(/\s+/).filter(Boolean).length

function buildLore(characterId: string, participantId: string, opts: { recent?: string[]; events?: AtlasHistoryEvent[]; regen?: string[]; people?: Array<{ name: string; aliases?: string[] }>; budget?: number } = {}) {
  return buildNamedAtlasLore({
    chat,
    characterId,
    respondingParticipantId: participantId,
    recentLines: (opts.recent ?? []).map((content) => ({ content })),
    loadEvents: async () => opts.events ?? [scenarioRow],
    regenerationOfMessageIds: opts.regen ?? null,
    workspaceCharacters: Promise.resolve(opts.people ?? [{ name: 'Agatha' }, { name: 'Bertie' }]),
    budgetTokens: opts.budget ?? 4000,
    provider: 'ANTHROPIC',
    repos: repos(),
  })
}

const build = async (...args: Parameters<typeof buildLore>) => (await buildLore(...args)).content

beforeEach(async () => {
  resetStore()
  addCharacter('c-a', 'Agatha')
  addCharacter('c-b', 'Bertie')
  await createAtlasEntry(await at('project', 'project-1'), {
    name: 'Convertible', aliases: ['lander', 'car'], graphicPrompt: 'A silver roadster.', knowledge: 'The project one.', metadata: {},
  } as never)
  await createAtlasEntry(await at('character', 'c-a'), {
    name: 'Convertible', aliases: ['car'], graphicPrompt: null, knowledge: "Agatha's own.", metadata: {},
  } as never)
  await createAtlasEntry(await at('general', null), {
    name: 'Lighthouse', aliases: [], graphicPrompt: 'A white tower.', knowledge: null, metadata: {},
  } as never)
})

describe('first turn under the scenario', () => {
  it('each seat gets its own entry from the scenario on its first turn', async () => {
    const a = await build('c-a', 'p-a')
    const b = await build('c-b', 'p-b')
    expect(a).toContain('### Convertible')
    expect(a).toContain("Agatha's own.")
    expect(a).not.toContain('The project one.')
    expect(b).toContain('The project one.')
    expect(b).toContain('Also called: lander, car')
    expect(b).toContain('Appearance: A silver roadster.')
  })

  it('a second turn in which nobody names it carries nothing', async () => {
    expect(await build('c-a', 'p-a', { events: [scenarioRow, line('m1', 'p-a')] })).toBe('')
  })

  it('a swipe of the first line is still a first turn', async () => {
    const section = await build('c-a', 'p-a', { events: [scenarioRow, line('m1', 'p-a')], regen: ['m1'] })
    expect(section).toContain("Agatha's own.")
  })

  it('a revised scenario counts again for every seat', () => {
    const events = [scenarioRow, line('m1', 'p-a'), { ...scenarioRow, id: 'h2', systemKind: 'scenario-change' }]
    expect(isFirstTurnUnderScenario({ events, respondingParticipantId: 'p-a' })).toBe(true)
    expect(isFirstTurnUnderScenario({ events: events.slice(0, 2), respondingParticipantId: 'p-a' })).toBe(false)
    expect(isFirstTurnUnderScenario({ events: events.slice(0, 2), respondingParticipantId: 'p-b' })).toBe(true)
  })
})

describe('the recent window', () => {
  it('a mention in the window delivers the entry again', async () => {
    const events = [scenarioRow, line('m1', 'p-a')]
    expect(await build('c-b', 'p-b', { events: [...events, line('m2', 'p-b')], recent: ['Is the car still outside?'] })).toContain('The project one.')
  })

  it('"cars" and "carpet" match nothing', async () => {
    const events = [scenarioRow, line('m1', 'p-b')]
    expect(await build('c-b', 'p-b', { events, recent: ['The cars were lined up', 'the carpet'] })).toBe('')
  })

  it('a term a character answers to is the person\'s', async () => {
    const events = [scenarioRow, line('m1', 'p-b')]
    expect(await build('c-b', 'p-b', { events, recent: ['Car waved.'], people: [{ name: 'Car' }] })).toBe('')
  })

  it('an entry with only a graphic prompt still renders', async () => {
    const events = [scenarioRow, line('m1', 'p-b')]
    const section = await build('c-b', 'p-b', { events, recent: ['By the lighthouse.'] })
    expect(section).toContain('### Lighthouse\nAppearance: A white tower.')
  })
})

describe('rendering and the budget', () => {
  const entry = (name: string, knowledge: string | null, graphicPrompt: string | null = null) => ({ name, aliases: [], graphicPrompt, knowledge })

  it('is empty with nothing to say and caps the entries', () => {
    expect(packNamedAtlasEntries([entry('X', null)], 1000, words).content).toBe('')
    const many = Array.from({ length: 12 }, (_, i) => entry(`T${i}`, `k${i}`))
    const packed = packNamedAtlasEntries(many, 1000, words)
    expect(packed.content.match(/^### /gm)).toHaveLength(ATLAS_LORE_MAX_NAMED)
    expect(packed.leftOut).toHaveLength(12 - ATLAS_LORE_MAX_NAMED)
  })

  it('never says Atlas to the model', () => {
    expect(renderAtlasEntryBlock({ name: 'X', aliases: ['y'], graphicPrompt: 'g', knowledge: 'k' })).not.toMatch(/atl/i)
  })

  it('counts what it packs and stays inside the budget', () => {
    const packed = packNamedAtlasEntries([entry('A', 'one two three'), entry('B', 'four five')], 1000, words)
    expect(packed.tokens).toBe(words(packed.content))
    expect(packed.told.map((t) => t.name)).toEqual(['A', 'B'])
    expect(packed.told.every((t) => !t.cut)).toBe(true)
  })

  it('cuts an entry that does not fit, at a word, and marks it', () => {
    const long = Array.from({ length: 400 }, (_, i) => `word${i}`).join(' ')
    const packed = packNamedAtlasEntries([entry('Engine', long, 'Brass.')], 200, words)
    expect(packed.told).toEqual([{ name: 'Engine', tokens: packed.tokens, cut: true }])
    expect(packed.tokens).toBeLessThanOrEqual(200)
    expect(packed.content).toContain('Appearance: Brass.')
    expect(packed.content.endsWith(ATLAS_LORE_CUT_MARK)).toBe(true)
    expect(packed.content).toMatch(/word\d+ …$/)
  })

  it('leaves an entry out when too little room is left to cut it into, and still fits a later small one', () => {
    const long = Array.from({ length: 400 }, (_, i) => `w${i}`).join(' ')
    const packed = packNamedAtlasEntries([entry('A', Array.from({ length: 150 }, () => 'a').join(' ')), entry('B', long), entry('C', 'small')], 200, words)
    expect(packed.told.map((t) => t.name)).toEqual(['A', 'C'])
    expect(packed.leftOut).toEqual(['B'])
  })

  it('cutting keeps a head-only entry whole or drops it', () => {
    expect(cutAtlasEntryBlock(entry('X', null, 'A tower.'), 50, words)).toBe('### X\nAppearance: A tower.')
    expect(cutAtlasEntryBlock(entry('X', null, 'A tower.'), 2, words)).toBeNull()
  })

  it('a zero budget tells nothing', async () => {
    const lore = await buildLore('c-b', 'p-b', { budget: 0 })
    expect(lore.content).toBe('')
    expect(lore.tokens).toBe(0)
  })

  it('joins named and recalled lore, skipping the empty', () => {
    expect(joinAtlasLore('', null, undefined)).toBe('')
    expect(joinAtlasLore('### A\n\nk', '', '### B\n\nj')).toBe('### A\n\nk\n\n### B\n\nj')
  })
})

describe('the recall source', () => {
  const hit = (mountPointId: string, relativePath: string, content = 'A passage.') => ({ mountPointId, relativePath, content })

  it('resolves a reachable entry by its file, whole and as the matched passage', async () => {
    const pool = await loadAtlasPool(repos(), { characterId: 'c-b', projectId: 'project-1' })
    const convertible = pool.entries.find((e) => e.name === 'Convertible')!
    const source = atlasRecallSourceFor(pool.entries, new Set())
    const block = source.resolve(hit(convertible.mountPointId, `atlas/${convertible.fileStem}.MD`, 'It leaks oil.'))
    expect(block).toMatchObject({ entryId: convertible.id, name: 'Convertible' })
    expect(block!.full).toContain('The project one.')
    expect(block!.excerpt).toContain('It leaks oil.')
    expect(block!.excerpt).toContain('Appearance: A silver roadster.')
    expect(block!.excerpt).not.toContain('The project one.')
  })

  it('strips the frontmatter from a passage that opens the file', async () => {
    const pool = await loadAtlasPool(repos(), { characterId: 'c-b', projectId: 'project-1' })
    const convertible = pool.entries.find((e) => e.name === 'Convertible')!
    const source = atlasRecallSourceFor(pool.entries, new Set())
    const block = source.resolve(hit(convertible.mountPointId, `Atlas/${convertible.fileStem}.md`, '---\nid: x\nname: Convertible\n---\n\nThe project one.'))
    expect(block!.excerpt).not.toContain('id: x')
    expect(block!.excerpt).toContain('The project one.')
    const bare = source.resolve(hit(convertible.mountPointId, `Atlas/${convertible.fileStem}.md`, '---\nid: x\nname: Convertible\n---\n'))
    expect(bare!.excerpt).toBeNull()
  })

  it('never recalls a shadowed entry, an entry already named, or a file that is no entry', async () => {
    const own = await loadAtlasPool(repos(), { characterId: 'c-a', projectId: 'project-1' })
    const others = await loadAtlasPool(repos(), { characterId: 'c-b', projectId: 'project-1' })
    const projectOne = others.entries.find((e) => e.name === 'Convertible')!
    const agathas = own.entries.find((e) => e.name === 'Convertible')!
    expect(agathas.mountPointId).not.toBe(projectOne.mountPointId)
    const source = atlasRecallSourceFor(own.entries, new Set())
    // The project's Convertible is hidden from Agatha by her own.
    expect(source.resolve(hit(projectOne.mountPointId, `Atlas/${projectOne.fileStem}.md`))).toBeNull()
    expect(source.resolve(hit(agathas.mountPointId, `Atlas/${agathas.fileStem}.md`))).not.toBeNull()
    expect(source.resolve(hit(agathas.mountPointId, 'Atlas/notes.md'))).toBeNull()
    const told = atlasRecallSourceFor(own.entries, new Set([agathas.id]))
    expect(told.resolve(hit(agathas.mountPointId, `Atlas/${agathas.fileStem}.md`))).toBeNull()
  })

  it('a turn\'s source skips what the turn already named', async () => {
    const events = [scenarioRow, line('m1', 'p-b')]
    const lore = await buildLore('c-b', 'p-b', { events, recent: ['Is the car still outside?'] })
    const pool = await loadAtlasPool(repos(), { characterId: 'c-b', projectId: 'project-1' })
    const convertible = pool.entries.find((e) => e.name === 'Convertible')!
    const lighthouse = pool.entries.find((e) => e.name === 'Lighthouse')!
    expect(lore.recall!.resolve(hit(convertible.mountPointId, `Atlas/${convertible.fileStem}.md`))).toBeNull()
    expect(lore.recall!.resolve(hit(lighthouse.mountPointId, `Atlas/${lighthouse.fileStem}.md`))).not.toBeNull()
  })
})

it('never throws: a failure is no lore', async () => {
  const lore = await buildNamedAtlasLore({
    chat,
    characterId: 'c-a',
    recentLines: Promise.reject(new Error('boom')),
    loadEvents: async () => [],
    workspaceCharacters: Promise.resolve([]),
    budgetTokens: 1000,
    provider: 'ANTHROPIC',
    repos: repos(),
  })
  expect(lore).toEqual({ content: '', tokens: 0, told: [], recall: null })
})
