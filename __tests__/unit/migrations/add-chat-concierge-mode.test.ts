/**
 * add-chat-concierge-mode-v1 — adds `conciergeMode` / `conciergeModeSetBy` /
 * `conciergeModeReason` to chats and backfills them from the legacy pair.
 *
 * `database-utils` is replaced by an in-memory `chats` table that understands
 * exactly the statements the migration issues, so the test exercises the
 * backfill table, idempotence and progress reporting without SQLCipher.
 */

interface Row {
  id: string
  conciergeOverride: string | null
  isDangerousChat: number | null
  conciergeMode?: string | null
  conciergeModeSetBy?: string | null
  conciergeModeReason?: string | null
}

const columns = new Set<string>()
const ddl = new Map<string, string>()
let rows: Row[] = []

jest.mock('../../../migrations/lib/logger', () => ({
  logger: { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
}))

const mockReportProgress = jest.fn()
jest.mock('../../../migrations/lib/progress', () => ({
  reportProgress: (...args: unknown[]) => mockReportProgress(...args),
}))

function pending(): Row[] {
  return rows.filter((r) =>
    r.conciergeModeSetBy == null &&
    ((r.conciergeOverride === 'OFF' || r.conciergeOverride === 'UNCENSORED') || r.isDangerousChat === 1))
}

jest.mock('../../../migrations/lib/database-utils', () => ({
  isSQLiteBackend: () => true,
  sqliteTableExists: (name: string) => name === 'chats',
  sqliteColumnExists: (_table: string, column: string) => columns.has(column),
  addColumnIfMissing: (_table: string, column: string, def: string) => {
    if (columns.has(column)) return false
    columns.add(column)
    ddl.set(column, def)
    const fill = def.includes("'moderated'") ? 'moderated' : null
    for (const r of rows) (r as unknown as Record<string, unknown>)[column] = fill
    return true
  },
  querySQLite: (sql: string) => {
    if (sql.includes('COUNT(*)')) return [{ n: pending().length }]
    return pending().map((r) => ({ id: r.id, conciergeOverride: r.conciergeOverride, isDangerousChat: r.isDangerousChat }))
  },
  executeSQLite: (_sql: string, params: unknown[]) => {
    const [mode, setBy, reason, id] = params as string[]
    const row = rows.find((r) => r.id === id)!
    row.conciergeMode = mode
    row.conciergeModeSetBy = setBy
    row.conciergeModeReason = reason
  },
}))

import { addChatConciergeModeMigration } from '../../../migrations/scripts/add-chat-concierge-mode'

beforeEach(() => {
  columns.clear()
  ddl.clear()
  mockReportProgress.mockClear()
  for (const c of ['id', 'conciergeOverride', 'isDangerousChat']) columns.add(c)
  rows = [
    { id: 'uncensored', conciergeOverride: 'UNCENSORED', isDangerousChat: 0 },
    { id: 'uncensored-flagged', conciergeOverride: 'UNCENSORED', isDangerousChat: 1 },
    { id: 'vouched', conciergeOverride: 'OFF', isDangerousChat: 1 },
    { id: 'flagged', conciergeOverride: null, isDangerousChat: 1 },
    { id: 'monitored', conciergeOverride: null, isDangerousChat: 0 },
    { id: 'unclassified', conciergeOverride: null, isDangerousChat: null },
  ]
})

const byId = (id: string) => rows.find((r) => r.id === id)!

describe('add-chat-concierge-mode-v1', () => {
  it('follows the refusal ledger and is dated 4.10.0', () => {
    expect(addChatConciergeModeMigration.id).toBe('add-chat-concierge-mode-v1')
    expect(addChatConciergeModeMigration.introducedInVersion).toBe('4.10.0')
    expect(addChatConciergeModeMigration.dependsOn).toEqual(['add-chat-refusal-ledger-v1'])
  })

  it('adds the three columns with their defaults', async () => {
    expect(await addChatConciergeModeMigration.shouldRun()).toBe(true)
    const result = await addChatConciergeModeMigration.run()
    expect(result.success).toBe(true)
    expect(ddl.get('conciergeMode')).toBe("TEXT DEFAULT 'moderated'")
    expect(ddl.get('conciergeModeSetBy')).toBe('TEXT DEFAULT NULL')
    expect(ddl.get('conciergeModeReason')).toBe('TEXT DEFAULT NULL')
  })

  it('backfills every row by the legacy table', async () => {
    const result = await addChatConciergeModeMigration.run()
    // 3 columns + 4 moved rows
    expect(result.itemsAffected).toBe(7)
    expect(byId('uncensored')).toMatchObject({ conciergeMode: 'unmoderated', conciergeModeSetBy: 'operator', conciergeModeReason: 'migration' })
    expect(byId('uncensored-flagged')).toMatchObject({ conciergeMode: 'unmoderated', conciergeModeSetBy: 'operator', conciergeModeReason: 'migration' })
    expect(byId('vouched')).toMatchObject({ conciergeMode: 'locked', conciergeModeSetBy: 'operator', conciergeModeReason: 'migration' })
    expect(byId('flagged')).toMatchObject({ conciergeMode: 'unmoderated', conciergeModeSetBy: 'concierge', conciergeModeReason: 'classifier' })
    expect(byId('monitored')).toMatchObject({ conciergeMode: 'moderated', conciergeModeSetBy: null, conciergeModeReason: null })
    expect(byId('unclassified')).toMatchObject({ conciergeMode: 'moderated', conciergeModeSetBy: null, conciergeModeReason: null })
  })

  it('leaves the legacy column untouched', async () => {
    await addChatConciergeModeMigration.run()
    expect(byId('vouched').conciergeOverride).toBe('OFF')
    expect(byId('flagged').isDangerousChat).toBe(1)
  })

  it('reports progress per candidate row', async () => {
    await addChatConciergeModeMigration.run()
    expect(mockReportProgress).toHaveBeenCalledTimes(4)
    expect(mockReportProgress).toHaveBeenLastCalledWith(4, 4, 'chats')
  })

  it('is idempotent: once run, it neither needs to run nor changes anything', async () => {
    await addChatConciergeModeMigration.run()
    expect(await addChatConciergeModeMigration.shouldRun()).toBe(false)
    const snapshot = JSON.stringify(rows)
    const again = await addChatConciergeModeMigration.run()
    expect(again).toMatchObject({ success: true, itemsAffected: 0 })
    expect(JSON.stringify(rows)).toBe(snapshot)
  })

  it('runs again when a previous run added the columns but died before the backfill', async () => {
    for (const c of ['conciergeMode', 'conciergeModeSetBy', 'conciergeModeReason']) columns.add(c)
    for (const r of rows) { r.conciergeMode = 'moderated'; r.conciergeModeSetBy = null; r.conciergeModeReason = null }
    expect(await addChatConciergeModeMigration.shouldRun()).toBe(true)
    await addChatConciergeModeMigration.run()
    expect(byId('vouched').conciergeMode).toBe('locked')
  })
})
