/**
 * impersonation-voice-mode-v1 — `chat_settings.impersonationVoiceRewrite`
 * (on/off) becomes `impersonationVoiceMode` ('off' / 'ask' / 'always'), and
 * the old column is dropped. An operator who had it on lands on 'ask'.
 */

const columns = new Set<string>()
let rows: Array<{ id: string; impersonationVoiceRewrite: number | null; impersonationVoiceMode: string | null }> = []

const mockExec = jest.fn((sql: string) => {
  if (/DROP COLUMN "impersonationVoiceRewrite"/.test(sql)) columns.delete('impersonationVoiceRewrite')
})
const mockExecute = jest.fn((sql: string, params: unknown[]) => {
  if (/UPDATE "chat_settings" SET "impersonationVoiceMode"/.test(sql)) {
    const [mode, id] = params as [string, string]
    const row = rows.find((r) => r.id === id)
    if (row) row.impersonationVoiceMode = mode
  }
})

jest.mock('../../../migrations/lib/logger', () => ({
  logger: { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
}))

jest.mock('../../../migrations/lib/progress', () => ({
  reportProgress: jest.fn(),
}))

jest.mock('../../../migrations/lib/database-utils', () => ({
  isSQLiteBackend: () => true,
  sqliteTableExists: (name: string) => name === 'chat_settings',
  sqliteColumnExists: (_table: string, column: string) => columns.has(column),
  addColumnIfMissing: (_table: string, column: string) => {
    if (columns.has(column)) return false
    columns.add(column)
    for (const r of rows) r.impersonationVoiceMode = 'off'
    return true
  },
  querySQLite: () =>
    rows
      .filter((r) => r.impersonationVoiceMode === null || r.impersonationVoiceMode === 'off')
      .map((r) => ({ id: r.id, impersonationVoiceRewrite: r.impersonationVoiceRewrite })),
  executeSQLite: (sql: string, params: unknown[]) => mockExecute(sql, params),
  getSQLiteDatabase: () => ({ exec: mockExec }),
}))

import { impersonationVoiceModeMigration } from '../../../migrations/scripts/impersonation-voice-mode'
import {
  impersonationVoiceModeFromLegacy,
  withImpersonationVoiceModeFromLegacy,
} from '@/lib/chat/impersonation-voice-legacy'

beforeEach(() => {
  columns.clear()
  for (const c of ['id', 'userId', 'impersonationVoiceRewrite']) columns.add(c)
  rows = [
    { id: 'on', impersonationVoiceRewrite: 1, impersonationVoiceMode: null },
    { id: 'off', impersonationVoiceRewrite: 0, impersonationVoiceMode: null },
    { id: 'null', impersonationVoiceRewrite: null, impersonationVoiceMode: null },
  ]
  mockExec.mockClear()
  mockExecute.mockClear()
})

describe('impersonation-voice-mode-v1', () => {
  it('runs after the column it replaces was added', () => {
    expect(impersonationVoiceModeMigration.dependsOn).toEqual(['add-impersonation-voice-rewrite-field-v1'])
  })

  it('translates on → ask, everything else → off, and drops the old column', async () => {
    expect(await impersonationVoiceModeMigration.shouldRun()).toBe(true)
    const result = await impersonationVoiceModeMigration.run()
    expect(result.success).toBe(true)
    expect(rows.map((r) => [r.id, r.impersonationVoiceMode])).toEqual([
      ['on', 'ask'],
      ['off', 'off'],
      ['null', 'off'],
    ])
    expect(mockExec).toHaveBeenCalledWith('ALTER TABLE "chat_settings" DROP COLUMN "impersonationVoiceRewrite"')
    expect(columns.has('impersonationVoiceRewrite')).toBe(false)
    expect(columns.has('impersonationVoiceMode')).toBe(true)
  })

  it('has nothing to do once the new column exists and the old one is gone', async () => {
    await impersonationVoiceModeMigration.run()
    expect(await impersonationVoiceModeMigration.shouldRun()).toBe(false)
  })

  it('adds the column on an instance that never had the toggle', async () => {
    columns.delete('impersonationVoiceRewrite')
    expect(await impersonationVoiceModeMigration.shouldRun()).toBe(true)
    const result = await impersonationVoiceModeMigration.run()
    expect(result.success).toBe(true)
    expect(mockExec).not.toHaveBeenCalled()
    expect(columns.has('impersonationVoiceMode')).toBe(true)
  })
})

describe('impersonation-voice legacy translation', () => {
  it('maps the stored boolean or integer', () => {
    expect(impersonationVoiceModeFromLegacy(true)).toBe('ask')
    expect(impersonationVoiceModeFromLegacy(1)).toBe('ask')
    expect(impersonationVoiceModeFromLegacy(false)).toBe('off')
    expect(impersonationVoiceModeFromLegacy(0)).toBe('off')
    expect(impersonationVoiceModeFromLegacy(null)).toBe('off')
    expect(impersonationVoiceModeFromLegacy(undefined)).toBe('off')
  })

  it('translates a restored record and drops the old key', () => {
    const out = withImpersonationVoiceModeFromLegacy({ id: 'cs-1', impersonationVoiceRewrite: true })
    expect(out).toEqual({ id: 'cs-1', impersonationVoiceMode: 'ask' })
  })

  it('keeps an explicit mode over the old key', () => {
    const out = withImpersonationVoiceModeFromLegacy({
      id: 'cs-1',
      impersonationVoiceRewrite: true,
      impersonationVoiceMode: 'always' as const,
    })
    expect(out).toEqual({ id: 'cs-1', impersonationVoiceMode: 'always' })
  })

  it('returns a current record untouched', () => {
    const current = { id: 'cs-1', impersonationVoiceMode: 'off' as const }
    expect(withImpersonationVoiceModeFromLegacy(current)).toBe(current)
  })
})
