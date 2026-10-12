/**
 * Unit tests for the scenario precedence chain.
 *
 * `resolveScenarioSelection` is the one place a picked scenario becomes text,
 * for both chat creation and the in-chat `?action=scenario` change. It now
 * returns a recipe — the text, the file the preset came from, and the notes
 * beneath it — and every kind of pointer is resolved through the scenario
 * location. The precedence between kinds, the fail-soft behaviour when a
 * pointer no longer resolves, and the refusal of a ref that can never resolve
 * are what keep the two surfaces honest with each other.
 *
 * Storage is faked in memory (`__tests__/helpers/scenario-stores.ts`); the
 * location's parsing and classification run for real.
 */

jest.mock('@/lib/logger', () => {
  const logger: Record<string, unknown> = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }
  logger.child = jest.fn(() => logger)
  return { logger }
})

const mockGetGeneralMountPointId = jest.fn()
jest.mock('@/lib/instance-settings', () => ({
  getGeneralMountPointId: () => mockGetGeneralMountPointId(),
}))
jest.mock('@/lib/mount-index/folder-paths', () => ({ ensureFolderPath: jest.fn() }))
jest.mock('@/lib/mount-index/ensure-owner-store', () => ({ ensureOwnerOfficialStore: jest.fn() }))
jest.mock('@/lib/mount-index/database-store', () => ({
  writeDatabaseDocument: jest.fn(),
  deleteDatabaseDocument: jest.fn(),
  moveDatabaseDocument: jest.fn(),
  readDatabaseDocument: jest.fn(),
}))

import { createHash } from 'crypto'
import {
  resolveScenarioSelection,
  sameResolvedScenario,
  ScenarioRefRefusedError,
} from '@/lib/chat/scenario-selection'
import { characterScenarioIdForPath } from '@/lib/scenarios/location'
import { logger } from '@/lib/logger'
import { makeScenarioStores, type FakeScenarioStores } from '../../../helpers/scenario-stores'

const USER = 'user-1'
const GENERAL_MOUNT = '00000000-0000-4000-8000-000000000001'
const PROJECT_MOUNT = '00000000-0000-4000-8000-000000000002'
const GROUP_MOUNT = '00000000-0000-4000-8000-000000000003'
const VAULT = '00000000-0000-4000-8000-000000000004'
const ELSEWHERE_PROJECT_MOUNT = '00000000-0000-4000-8000-000000000007'
const LINKED_STORE = '00000000-0000-4000-8000-000000000006'

const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex')

let stores: FakeScenarioStores

function options(overrides: Record<string, unknown> = {}) {
  return {
    repos: stores.repos,
    userId: USER,
    projectId: 'proj-1',
    characterId: 'char-1',
    ...overrides,
  }
}

const TAVERN_ID = () => characterScenarioIdForPath(VAULT, 'Scenarios/Tavern.md')

beforeEach(() => {
  jest.clearAllMocks()
  mockGetGeneralMountPointId.mockResolvedValue(GENERAL_MOUNT)
  stores = makeScenarioStores({
    characters: [{ id: 'char-1', name: 'Ada', userId: USER, characterDocumentMountPointId: VAULT }],
    projects: [
      { id: 'proj-1', name: 'Blackwood', officialMountPointId: PROJECT_MOUNT },
      { id: 'proj-2', name: 'Elsewhere', officialMountPointId: ELSEWHERE_PROJECT_MOUNT },
      { id: 'proj-bare', name: 'Storeless', officialMountPointId: null },
    ],
    groups: [{ id: 'group-1', name: 'The Club', officialMountPointId: GROUP_MOUNT }],
  })
  stores.put(VAULT, 'Scenarios/Tavern.md', '# Tavern\n\nA tavern at dusk.')
  stores.put(PROJECT_MOUNT, 'Scenarios/scene.md', '---\nname: Project Scene\n---\nProject scene.')
  stores.put(GROUP_MOUNT, 'Scenarios/scene.md', 'Group scene.')
  stores.put(GENERAL_MOUNT, 'Scenarios/scene.md', 'General scene.')
  stores.put(ELSEWHERE_PROJECT_MOUNT, 'Scenarios/reading-room.md', 'The reading room.')
})

describe('resolveScenarioSelection', () => {
  it('returns an empty recipe when nothing is chosen and nothing is typed', async () => {
    await expect(resolveScenarioSelection({}, options())).resolves.toEqual({
      scenarioText: null,
      scenarioSource: null,
      scenarioNotes: null,
    })
  })

  it('resolves a character scenarioId in the character’s vault, with its source', async () => {
    const result = await resolveScenarioSelection({ scenarioId: TAVERN_ID() }, options())
    expect(result).toEqual({
      scenarioText: 'A tavern at dusk.',
      scenarioSource: { mountPointId: VAULT, path: 'Scenarios/Tavern.md', bodySha256: sha('A tavern at dusk.') },
      scenarioNotes: null,
    })
  })

  it.each([
    ['projectScenarioPath', { projectScenarioPath: 'Scenarios/scene.md' }, PROJECT_MOUNT, 'Project scene.'],
    ['groupScenarioPath', { groupScenarioPath: 'scene', groupScenarioGroupId: 'group-1' }, GROUP_MOUNT, 'Group scene.'],
    ['generalScenarioPath', { generalScenarioPath: 'scene.md' }, GENERAL_MOUNT, 'General scene.'],
  ])('records the source for a %s pick', async (_label, fields, mountPointId, body) => {
    const result = await resolveScenarioSelection(fields, options())
    expect(result.scenarioText).toBe(body)
    expect(result.scenarioSource).toEqual({ mountPointId, path: 'Scenarios/scene.md', bodySha256: sha(body) })
  })

  it('resolves a scenarioRef from anywhere, first of all', async () => {
    const result = await resolveScenarioSelection(
      {
        scenarioRef: { mountPointId: ELSEWHERE_PROJECT_MOUNT, path: 'Scenarios/reading-room.md' },
        scenarioId: TAVERN_ID(),
        projectScenarioPath: 'Scenarios/scene.md',
      },
      options(),
    )
    expect(result.scenarioText).toBe('The reading room.')
    expect(result.scenarioSource?.mountPointId).toBe(ELSEWHERE_PROJECT_MOUNT)
  })

  it('prefers a character scenario over every file-backed tier', async () => {
    const result = await resolveScenarioSelection(
      {
        scenarioId: TAVERN_ID(),
        projectScenarioPath: 'Scenarios/scene.md',
        groupScenarioPath: 'Scenarios/scene.md',
        groupScenarioGroupId: 'group-1',
        generalScenarioPath: 'Scenarios/scene.md',
      },
      options(),
    )
    expect(result.scenarioText).toBe('A tavern at dusk.')
  })

  it('prefers project over group, and group over general', async () => {
    const all = {
      projectScenarioPath: 'Scenarios/scene.md',
      groupScenarioPath: 'Scenarios/scene.md',
      groupScenarioGroupId: 'group-1',
      generalScenarioPath: 'Scenarios/scene.md',
    }
    expect((await resolveScenarioSelection(all, options())).scenarioText).toBe('Project scene.')
    const { projectScenarioPath: _p, ...noProject } = all
    expect((await resolveScenarioSelection(noProject, options())).scenarioText).toBe('Group scene.')
  })

  it('layers free-text notes beneath the resolved preset and keeps them apart', async () => {
    const result = await resolveScenarioSelection(
      { generalScenarioPath: 'Scenarios/scene.md', scenario: '  It is raining.  ' },
      options(),
    )
    expect(result.scenarioText).toBe('General scene.\n\nIt is raining.')
    expect(result.scenarioNotes).toBe('It is raining.')
    // The hash is of the body alone, so a reload can tell the shelf copy changed.
    expect(result.scenarioSource?.bodySha256).toBe(sha('General scene.'))
  })

  it('uses free text alone when no preset is chosen, with nothing to reload', async () => {
    await expect(resolveScenarioSelection({ scenario: 'A blank stage.' }, options())).resolves.toEqual({
      scenarioText: 'A blank stage.',
      scenarioSource: null,
      scenarioNotes: null,
    })
  })

  describe('refusal', () => {
    it('refuses a scenarioRef whose mount is not a scenario owner', async () => {
      await expect(
        resolveScenarioSelection({ scenarioRef: { mountPointId: LINKED_STORE, path: 'Scenarios/x.md' } }, options()),
      ).rejects.toBeInstanceOf(ScenarioRefRefusedError)
    })

    it('refuses a scenarioRef whose path leaves Scenarios/', async () => {
      await expect(
        resolveScenarioSelection({ scenarioRef: { mountPointId: PROJECT_MOUNT, path: '../etc/passwd' } }, options()),
      ).rejects.toBeInstanceOf(ScenarioRefRefusedError)
    })
  })

  describe('fail-soft behaviour', () => {
    it('falls through when a scenarioRef points at a missing file', async () => {
      const result = await resolveScenarioSelection(
        { scenarioRef: { mountPointId: PROJECT_MOUNT, path: 'Scenarios/gone.md' }, generalScenarioPath: 'Scenarios/scene.md' },
        options(),
      )
      expect(result.scenarioText).toBe('General scene.')
    })

    it('falls through to the next tier when a scenarioId is not on the character', async () => {
      const result = await resolveScenarioSelection(
        { scenarioId: '11111111-1111-4111-8111-111111111111', generalScenarioPath: 'Scenarios/scene.md' },
        options(),
      )
      expect(result.scenarioText).toBe('General scene.')
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('scenarioId not found'), expect.anything())
    })

    it('ignores a project path when the chat has no project', async () => {
      const result = await resolveScenarioSelection(
        { projectScenarioPath: 'Scenarios/scene.md' },
        options({ projectId: null }),
      )
      expect(result.scenarioText).toBeNull()
    })

    it('ignores a project path when the project has no official store', async () => {
      const result = await resolveScenarioSelection(
        { projectScenarioPath: 'Scenarios/scene.md' },
        options({ projectId: 'proj-bare' }),
      )
      expect(result.scenarioText).toBeNull()
    })

    it('ignores a group path with no group id', async () => {
      const result = await resolveScenarioSelection({ groupScenarioPath: 'Scenarios/scene.md' }, options())
      expect(result.scenarioText).toBeNull()
    })

    it('falls through when a file-backed path no longer resolves to a body', async () => {
      const result = await resolveScenarioSelection(
        { projectScenarioPath: 'Scenarios/renamed.md', generalScenarioPath: 'Scenarios/scene.md' },
        options(),
      )
      expect(result.scenarioText).toBe('General scene.')
    })

    it('keeps the free text when every preset tier fails', async () => {
      const result = await resolveScenarioSelection(
        { projectScenarioPath: 'Scenarios/renamed.md', scenario: 'Notes survive.' },
        options(),
      )
      expect(result).toEqual({ scenarioText: 'Notes survive.', scenarioSource: null, scenarioNotes: null })
    })
  })
})

describe('sameResolvedScenario', () => {
  const base = {
    scenarioText: 'A.',
    scenarioSource: { mountPointId: GENERAL_MOUNT, path: 'Scenarios/a.md', bodySha256: sha('A.') },
    scenarioNotes: null,
  }

  it('is true for an identical recipe', () => {
    expect(sameResolvedScenario(base, { ...base, scenarioSource: { ...base.scenarioSource } })).toBe(true)
  })

  it('notices a change of source even when the text is the same', () => {
    expect(sameResolvedScenario(base, { ...base, scenarioSource: null })).toBe(false)
  })

  it('notices a change of notes', () => {
    expect(sameResolvedScenario(base, { ...base, scenarioNotes: 'x' })).toBe(false)
  })
})
