/**
 * @jest-environment node
 *
 * The Atlas's prompt section (atlas spec §5.5): empty is absent, the recent
 * window, the first-turn scenario rule, regeneration, the cap, the
 * per-character audience, and never throwing.
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
import {
  ATLAS_SECTION_HEADER,
  ATLAS_SECTION_MAX_ENTRIES,
  buildAtlasSection,
  isFirstTurnUnderScenario,
  renderAtlasSection,
  type AtlasHistoryEvent,
} from '@/lib/atlas/prompt-section'

const repos = () => getFakeRepos() as never
const at = async (scope: 'character' | 'project' | 'general', id: string | null) =>
  (await resolveAtlasLocation(scope, id, repos(), 'user-1')) as AtlasLocation

const chat = { id: 'chat-1', projectId: 'project-1', scenarioText: 'They arrive in the convertible.' }
const scenarioRow: AtlasHistoryEvent = { id: 'h1', type: 'message', role: 'ASSISTANT', systemSender: 'host', systemKind: 'scenario', content: chat.scenarioText }
const line = (id: string, participantId: string, content = 'Hello.'): AtlasHistoryEvent => ({ id, type: 'message', role: 'ASSISTANT', participantId, content })

function build(characterId: string, participantId: string, opts: { recent?: string[]; events?: AtlasHistoryEvent[]; regen?: string[]; people?: Array<{ name: string; aliases?: string[] }> } = {}) {
  return buildAtlasSection({
    chat,
    characterId,
    respondingParticipantId: participantId,
    recentLines: (opts.recent ?? []).map((content) => ({ content })),
    loadEvents: async () => opts.events ?? [scenarioRow],
    regenerationOfMessageIds: opts.regen ?? null,
    workspaceCharacters: Promise.resolve(opts.people ?? [{ name: 'Agatha' }, { name: 'Bertie' }]),
    repos: repos(),
  })
}

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
    expect(a).toContain(ATLAS_SECTION_HEADER)
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

describe('rendering', () => {
  it('is empty with nothing to say and caps the entries', () => {
    expect(renderAtlasSection([{ name: 'X', aliases: [], graphicPrompt: null, knowledge: null }])).toBe('')
    const many = Array.from({ length: 12 }, (_, i) => ({ name: `T${i}`, aliases: [], graphicPrompt: null, knowledge: `k${i}` }))
    expect(renderAtlasSection(many).match(/^### /gm)).toHaveLength(ATLAS_SECTION_MAX_ENTRIES)
  })

  it('never says Atlas to the model', () => {
    expect(renderAtlasSection([{ name: 'X', aliases: ['y'], graphicPrompt: 'g', knowledge: 'k' }])).not.toMatch(/atlas/i)
  })
})

it('never throws: a failure is an empty section', async () => {
  const section = await buildAtlasSection({
    chat,
    characterId: 'c-a',
    recentLines: Promise.reject(new Error('boom')),
    loadEvents: async () => [],
    workspaceCharacters: Promise.resolve([]),
    repos: repos(),
  })
  expect(section).toBe('')
})
