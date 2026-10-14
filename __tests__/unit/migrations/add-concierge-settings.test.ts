/**
 * add-concierge-settings-v1 — adds `chat_settings.conciergeSettings` and
 * backfills it from the retired `dangerousContentSettings`, the uncensored
 * vision fallback and the image-prompt crafter.
 *
 * `database-utils` is replaced by in-memory `chat_settings` / `chats` tables
 * that understand exactly the statements the migration issues.
 */

interface SettingsRow {
  id: string
  userId: string
  dangerousContentSettings?: string | null
  uncensoredImageDescriptionProfileId?: string | null
  cheapLLMSettings?: string | null
  conciergeSettings?: string | null
}

const settingsColumns = new Set<string>()
let settingsRows: SettingsRow[] = []
let chatRows: Array<{ userId: string; conciergeMode: string }> = []
let chatsHaveMode = true

jest.mock('../../../migrations/lib/logger', () => ({
  logger: { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
}))

const mockReportProgress = jest.fn()
jest.mock('../../../migrations/lib/progress', () => ({
  reportProgress: (...args: unknown[]) => mockReportProgress(...args),
}))

const pending = () => settingsRows.filter((r) => r.conciergeSettings == null || r.conciergeSettings === '')

jest.mock('../../../migrations/lib/database-utils', () => ({
  isSQLiteBackend: () => true,
  sqliteTableExists: (name: string) => name === 'chat_settings' || name === 'chats',
  sqliteColumnExists: (table: string, column: string) =>
    table === 'chats' ? column === 'conciergeMode' && chatsHaveMode : settingsColumns.has(column),
  addColumnIfMissing: (_table: string, column: string) => {
    if (settingsColumns.has(column)) return false
    settingsColumns.add(column)
    for (const r of settingsRows) r.conciergeSettings = null
    return true
  },
  querySQLite: (sql: string, params: unknown[] = []) => {
    if (sql.includes('FROM "chats"')) {
      return [{ n: chatRows.filter((c) => c.userId === params[0] && c.conciergeMode === 'unmoderated').length }]
    }
    if (sql.includes('COUNT(*)')) return [{ n: pending().length }]
    return pending().map((r) => ({
      id: r.id,
      userId: r.userId,
      dangerousContentSettings: settingsColumns.has('dangerousContentSettings') ? r.dangerousContentSettings ?? null : null,
      uncensoredImageDescriptionProfileId: settingsColumns.has('uncensoredImageDescriptionProfileId') ? r.uncensoredImageDescriptionProfileId ?? null : null,
      cheapLLMSettings: settingsColumns.has('cheapLLMSettings') ? r.cheapLLMSettings ?? null : null,
    }))
  },
  executeSQLite: (_sql: string, params: unknown[]) => {
    const [json, id] = params as string[]
    settingsRows.find((r) => r.id === id)!.conciergeSettings = json
  },
}))

import {
  addConciergeSettingsMigration,
  mapLegacyConciergeSettings,
} from '../../../migrations/scripts/add-concierge-settings'

const TEXT = '11111111-1111-4111-8111-111111111111'
const IMAGE = '22222222-2222-4222-8222-222222222222'
const VISION = '33333333-3333-4333-8333-333333333333'
const CRAFTER = '44444444-4444-4444-8444-444444444444'

const legacy = (extra: Record<string, unknown> = {}) => JSON.stringify({
  threshold: 0.55,
  scanTextChat: false,
  scanImagePrompts: true,
  scanImageGeneration: true,
  uncensoredTextProfileId: TEXT,
  uncensoredImageProfileId: IMAGE,
  displayMode: 'BLUR',
  showWarningBadges: false,
  customClassificationPrompt: 'Be strict.',
  autoSwitchAfterRefusals: 4,
  ...extra,
})

const stored = (id: string) => JSON.parse(settingsRows.find((r) => r.id === id)!.conciergeSettings!)

beforeEach(() => {
  settingsColumns.clear()
  for (const c of ['id', 'userId', 'dangerousContentSettings', 'uncensoredImageDescriptionProfileId', 'cheapLLMSettings']) {
    settingsColumns.add(c)
  }
  chatsHaveMode = true
  chatRows = []
  mockReportProgress.mockClear()
  settingsRows = []
})

describe('mapLegacyConciergeSettings', () => {
  it('OFF → off duty, pre-screen and summary classification off', () => {
    const m = mapLegacyConciergeSettings({ dangerousContentSettings: { mode: 'OFF' } })
    expect(m.enabled).toBe(false)
    expect(m.preScreen.enabled).toBe(false)
    expect(m.preScreen.summaryClassification).toBe(false)
  })

  it.each(['DETECT_ONLY', 'AUTO_ROUTE'])('%s → on duty with pre-screen and summary classification', (mode) => {
    const m = mapLegacyConciergeSettings({ dangerousContentSettings: { mode } })
    expect(m.enabled).toBe(true)
    expect(m.preScreen.enabled).toBe(true)
    expect(m.preScreen.summaryClassification).toBe(true)
  })

  it('carries the scans, threshold, prompt, desk, display and auto-switch across', () => {
    const m = mapLegacyConciergeSettings({
      dangerousContentSettings: JSON.parse(legacy({ mode: 'AUTO_ROUTE' })),
      uncensoredImageDescriptionProfileId: VISION,
      cheapLLMSettings: { imagePromptProfileId: CRAFTER },
    })
    expect(m).toEqual({
      enabled: true,
      uncensoredTextProfileId: TEXT,
      uncensoredImageProfileId: IMAGE,
      uncensoredVisionProfileId: VISION,
      imagePromptProfileId: CRAFTER,
      autoSwitchAfterRefusals: 4,
      newChatsStartAs: 'moderated',
      display: { mode: 'BLUR', showWarningBadges: false },
      preScreen: {
        enabled: true,
        threshold: 0.55,
        scanTextChat: false,
        scanImagePrompts: true,
        scanImageGeneration: true,
        customClassificationPrompt: 'Be strict.',
        summaryClassification: true,
      },
    })
  })

  it('no dangerousContentSettings at all reads as the retired default (OFF) with schema defaults', () => {
    const m = mapLegacyConciergeSettings({})
    expect(m.enabled).toBe(false)
    expect(m.autoSwitchAfterRefusals).toBe(2)
    expect(m.display).toEqual({ mode: 'SHOW', showWarningBadges: true })
    expect(m.preScreen.threshold).toBe(0.7)
    expect(m.uncensoredTextProfileId).toBeNull()
  })

  it('OFF with an Unmoderated chat stays on duty so that chat keeps its desk, pre-screen off', () => {
    const m = mapLegacyConciergeSettings({ dangerousContentSettings: { mode: 'OFF' }, hasUnmoderatedChats: true })
    expect(m.enabled).toBe(true)
    expect(m.preScreen.enabled).toBe(false)
    expect(m.preScreen.summaryClassification).toBe(false)
  })
})

describe('add-concierge-settings-v1', () => {
  it('adds the column and backfills every row from its own sources', async () => {
    settingsRows = [
      { id: 's-auto', userId: 'u1', dangerousContentSettings: legacy({ mode: 'AUTO_ROUTE' }), uncensoredImageDescriptionProfileId: VISION, cheapLLMSettings: JSON.stringify({ strategy: 'USER_DEFINED', imagePromptProfileId: CRAFTER }) },
      { id: 's-off', userId: 'u2', dangerousContentSettings: legacy({ mode: 'OFF' }) },
      { id: 's-none', userId: 'u3', dangerousContentSettings: null },
      { id: 's-garbage', userId: 'u4', dangerousContentSettings: '{not json' },
    ]
    chatRows = [{ userId: 'u2', conciergeMode: 'moderated' }]

    expect(await addConciergeSettingsMigration.shouldRun()).toBe(true)
    const result = await addConciergeSettingsMigration.run()
    expect(result.success).toBe(true)

    expect(stored('s-auto')).toMatchObject({ enabled: true, uncensoredVisionProfileId: VISION, imagePromptProfileId: CRAFTER })
    expect(stored('s-off')).toMatchObject({ enabled: false, uncensoredTextProfileId: TEXT })
    expect(stored('s-none')).toMatchObject({ enabled: false, preScreen: { enabled: false } })
    expect(stored('s-garbage')).toMatchObject({ enabled: false })
    expect(mockReportProgress).toHaveBeenLastCalledWith(4, 4, 'settings')
  })

  it('keeps an OFF user with an Unmoderated chat on duty', async () => {
    settingsRows = [{ id: 's', userId: 'u1', dangerousContentSettings: legacy({ mode: 'OFF' }) }]
    chatRows = [{ userId: 'u1', conciergeMode: 'unmoderated' }]
    await addConciergeSettingsMigration.run()
    expect(stored('s')).toMatchObject({ enabled: true, preScreen: { enabled: false } })
  })

  it('tolerates a database with none of the legacy columns', async () => {
    settingsColumns.delete('dangerousContentSettings')
    settingsColumns.delete('uncensoredImageDescriptionProfileId')
    settingsColumns.delete('cheapLLMSettings')
    chatsHaveMode = false
    settingsRows = [{ id: 's', userId: 'u1' }]
    const result = await addConciergeSettingsMigration.run()
    expect(result.success).toBe(true)
    expect(stored('s')).toMatchObject({ enabled: false })
  })

  it('is idempotent: a second run has nothing to do and changes nothing', async () => {
    settingsRows = [{ id: 's', userId: 'u1', dangerousContentSettings: legacy({ mode: 'DETECT_ONLY' }) }]
    await addConciergeSettingsMigration.run()
    const first = settingsRows[0].conciergeSettings
    expect(await addConciergeSettingsMigration.shouldRun()).toBe(false)
    // A user who has since changed their settings is never overwritten.
    settingsRows[0].conciergeSettings = JSON.stringify({ enabled: false })
    await addConciergeSettingsMigration.run()
    expect(settingsRows[0].conciergeSettings).not.toBe(first)
    expect(JSON.parse(settingsRows[0].conciergeSettings!)).toEqual({ enabled: false })
  })
})
