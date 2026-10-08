/** @jest-environment node */
import fs from 'fs'
import os from 'os'
import path from 'path'
import {
  localDateStamp,
  readOptimizeState,
  writeOptimizeState,
  isOptimizeDue,
  optimizeDatabase,
  runDailyDbOptimize,
  OPTIMIZE_STATE_FILENAME,
  OPTIMIZE_TARGET_KEYS,
} from '@/lib/startup/daily-db-optimize'
import * as paths from '@/lib/paths'
import * as dbUtils from '@/migrations/lib/database-utils'
import * as backup from '@/lib/database/backends/sqlite/physical-backup'

jest.mock('@/lib/logger', () => {
  const child = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }
  return { logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), child: () => child } }
})
jest.mock('@/lib/paths', () => ({ getDataDir: jest.fn(), getMountIndexDatabasePath: jest.fn() }))
jest.mock('@/lib/startup/progress', () => ({
  startupProgress: { setCurrent: jest.fn(), setSubProgress: jest.fn(), publish: jest.fn() },
}))
jest.mock('@/migrations/lib/database-utils', () => ({
  isSQLiteBackend: jest.fn(),
  getSQLiteDatabase: jest.fn(),
  getSQLitePath: jest.fn(),
  getLlmLogsDbPath: jest.fn(),
  openLlmLogsDbIfPresent: jest.fn(),
  openMountIndexDbIfPresent: jest.fn(),
}))
jest.mock('@/lib/database/backends/sqlite/physical-backup', () => ({
  createPhysicalBackup: jest.fn(),
  createLLMLogsPhysicalBackup: jest.fn(),
  createMountIndexPhysicalBackup: jest.fn(),
}))

const du = dbUtils as jest.Mocked<typeof dbUtils>
const bk = backup as jest.Mocked<typeof backup>
let dir: string
let statePath: string
const NOW = new Date(2026, 9, 8, 15, 0, 0) // local Oct 8 2026
const TODAY = '2026-10-08'

function fakeDb(overrides: Record<string, jest.Mock> = {}) {
  return { exec: jest.fn(), pragma: jest.fn(), close: jest.fn(), ...overrides } as any
}
const readState = () => JSON.parse(fs.readFileSync(statePath, 'utf8'))

beforeEach(() => {
  jest.clearAllMocks()
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dbopt-'))
  statePath = path.join(dir, OPTIMIZE_STATE_FILENAME)
  ;(paths.getDataDir as jest.Mock).mockReturnValue(dir)
  ;(paths.getMountIndexDatabasePath as jest.Mock).mockReturnValue(path.join(dir, 'mount.db'))
  du.isSQLiteBackend.mockReturnValue(true)
  du.getSQLitePath.mockReturnValue(path.join(dir, 'main.db'))
  du.getLlmLogsDbPath.mockReturnValue(path.join(dir, 'llm.db'))
  bk.createPhysicalBackup.mockResolvedValue('/b/main')
  bk.createLLMLogsPhysicalBackup.mockResolvedValue(null)
  bk.createMountIndexPhysicalBackup.mockResolvedValue(null)
})
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

describe('helpers', () => {
  it('localDateStamp zero-pads local date parts', () => {
    expect(localDateStamp(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05')
    expect(localDateStamp(NOW)).toBe(TODAY)
  })

  it('isOptimizeDue is true unless stamped for today', () => {
    expect(isOptimizeDue({}, 'main', TODAY)).toBe(true)
    expect(isOptimizeDue({ main: '2026-10-07' }, 'main', TODAY)).toBe(true)
    expect(isOptimizeDue({ main: TODAY }, 'main', TODAY)).toBe(false)
  })

  describe('readOptimizeState', () => {
    it('returns {} for a missing file', () => {
      expect(readOptimizeState(statePath)).toEqual({})
    })
    it('reads known string keys only', () => {
      fs.writeFileSync(statePath, JSON.stringify({ main: TODAY, 'llm-logs': 5, extra: 'x' }))
      expect(readOptimizeState(statePath)).toEqual({ main: TODAY })
    })
    it.each(['not json{', 'null', '[1,2]', '"str"'])('tolerates malformed content %s', (content) => {
      fs.writeFileSync(statePath, content)
      expect(readOptimizeState(statePath)).toEqual({})
    })
    it('defaults to the data-dir path', () => {
      fs.writeFileSync(statePath, JSON.stringify({ 'mount-points': TODAY }))
      expect(readOptimizeState()).toEqual({ 'mount-points': TODAY })
    })
  })

  describe('writeOptimizeState', () => {
    it('round-trips', () => {
      writeOptimizeState({ main: TODAY }, statePath)
      expect(readOptimizeState(statePath)).toEqual({ main: TODAY })
    })
    it('does not throw when the destination is unwritable', () => {
      expect(() => writeOptimizeState({ main: TODAY }, path.join(dir, 'nodir', 'x.json'))).not.toThrow()
    })
  })

  describe('optimizeDatabase', () => {
    it('runs VACUUM, ANALYZE, PRAGMA optimize in order', () => {
      const db = fakeDb()
      const { ok, steps } = optimizeDatabase(db, 'main')
      expect(ok).toBe(true)
      expect(steps.map((s) => s.name)).toEqual(['VACUUM', 'ANALYZE', 'PRAGMA optimize'])
      expect(db.exec.mock.calls).toEqual([['VACUUM'], ['ANALYZE']])
      expect(db.pragma).toHaveBeenCalledWith('optimize')
    })
    it('stops at the first failing step', () => {
      const db = fakeDb({ exec: jest.fn((sql: string) => { if (sql === 'ANALYZE') throw new Error('locked') }) })
      const { ok, steps } = optimizeDatabase(db, 'main')
      expect(ok).toBe(false)
      expect(steps.map((s) => [s.name, s.ok])).toEqual([['VACUUM', true], ['ANALYZE', false]])
      expect(steps[1].error).toBe('locked')
      expect(db.pragma).not.toHaveBeenCalled()
    })
    it('stringifies non-Error throws', () => {
      const db = fakeDb({ exec: jest.fn(() => { throw 'bad' }) })
      expect(optimizeDatabase(db, 'x').steps[0].error).toBe('bad')
    })
  })
})

describe('runDailyDbOptimize', () => {
  let main: any, llm: any, mount: any
  beforeEach(() => {
    main = fakeDb(); llm = fakeDb(); mount = fakeDb()
    du.getSQLiteDatabase.mockReturnValue(main)
    du.openLlmLogsDbIfPresent.mockReturnValue(llm)
    du.openMountIndexDbIfPresent.mockReturnValue(mount)
  })

  it('skips entirely when every database was optimized today', async () => {
    writeOptimizeState({ main: TODAY, 'llm-logs': TODAY, 'mount-points': TODAY }, statePath)
    await runDailyDbOptimize(NOW)
    expect(du.isSQLiteBackend).not.toHaveBeenCalled()
    expect(main.exec).not.toHaveBeenCalled()
  })

  it('does nothing on a non-SQLite backend and writes no state', async () => {
    du.isSQLiteBackend.mockReturnValue(false)
    await runDailyDbOptimize(NOW)
    expect(du.getSQLiteDatabase).not.toHaveBeenCalled()
    expect(fs.existsSync(statePath)).toBe(false)
  })

  it('backs up, optimizes, stamps all three, and closes only owned connections', async () => {
    await runDailyDbOptimize(NOW)
    expect(bk.createPhysicalBackup).toHaveBeenCalledWith(main)
    expect(bk.createLLMLogsPhysicalBackup).toHaveBeenCalledWith(llm)
    expect(bk.createMountIndexPhysicalBackup).toHaveBeenCalledWith(mount)
    for (const db of [main, llm, mount]) expect(db.exec).toHaveBeenCalledWith('VACUUM')
    expect(main.pragma).toHaveBeenCalledWith('wal_checkpoint(TRUNCATE)')
    expect(llm.pragma).not.toHaveBeenCalledWith('wal_checkpoint(TRUNCATE)')
    expect(main.close).not.toHaveBeenCalled()
    expect(llm.close).toHaveBeenCalled()
    expect(mount.close).toHaveBeenCalled()
    expect(readState()).toEqual({ main: TODAY, 'llm-logs': TODAY, 'mount-points': TODAY })
  })

  it('only works on databases that are due', async () => {
    writeOptimizeState({ main: TODAY, 'llm-logs': '2026-10-01' }, statePath)
    await runDailyDbOptimize(NOW)
    expect(main.exec).not.toHaveBeenCalled()
    expect(bk.createPhysicalBackup).not.toHaveBeenCalled()
    expect(llm.exec).toHaveBeenCalled()
    expect(mount.exec).toHaveBeenCalled()
    expect(readState()).toEqual({ main: TODAY, 'llm-logs': TODAY, 'mount-points': TODAY })
  })

  it('stamps a database whose file does not exist yet without backing it up', async () => {
    du.openLlmLogsDbIfPresent.mockReturnValue(null)
    await runDailyDbOptimize(NOW)
    expect(bk.createLLMLogsPhysicalBackup).not.toHaveBeenCalled()
    expect(readState()['llm-logs']).toBe(TODAY)
  })

  it('optimizes anyway when the backup throws', async () => {
    bk.createPhysicalBackup.mockRejectedValue(new Error('disk full'))
    await runDailyDbOptimize(NOW)
    expect(main.exec).toHaveBeenCalledWith('VACUUM')
    expect(readState().main).toBe(TODAY)
  })

  it('does not stamp a database whose optimize fails, and still processes the others', async () => {
    llm.exec = jest.fn(() => { throw new Error('corrupt') })
    await runDailyDbOptimize(NOW)
    const state = readState()
    expect(state['llm-logs']).toBeUndefined()
    expect(state.main).toBe(TODAY)
    expect(state['mount-points']).toBe(TODAY)
    expect(llm.close).toHaveBeenCalled()
  })

  it('tolerates a failed WAL checkpoint on the shared handle', async () => {
    main.pragma = jest.fn((p: string) => { if (p.startsWith('wal_checkpoint')) throw new Error('busy') })
    await runDailyDbOptimize(NOW)
    expect(readState().main).toBe(TODAY)
  })

  it('isolates an open() throw to that database, leaving it unstamped', async () => {
    du.openMountIndexDbIfPresent.mockImplementation(() => { throw new Error('cannot open') })
    await runDailyDbOptimize(NOW)
    const state = readState()
    expect(state['mount-points']).toBeUndefined()
    expect(state.main).toBe(TODAY)
  })

  it('tolerates a close() failure', async () => {
    llm.close = jest.fn(() => { throw new Error('close failed') })
    await expect(runDailyDbOptimize(NOW)).resolves.toBeUndefined()
    expect(readState()['llm-logs']).toBe(TODAY)
  })

  it('runs again on the next day', async () => {
    await runDailyDbOptimize(NOW)
    main.exec.mockClear()
    await runDailyDbOptimize(NOW)
    expect(main.exec).not.toHaveBeenCalled()
    await runDailyDbOptimize(new Date(2026, 9, 9, 8, 0, 0))
    expect(main.exec).toHaveBeenCalledWith('VACUUM')
    expect(OPTIMIZE_TARGET_KEYS.every((k) => readState()[k] === '2026-10-09')).toBe(true)
  })
})
