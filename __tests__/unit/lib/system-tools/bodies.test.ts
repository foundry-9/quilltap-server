/**
 * refactor-4-13-api-input-schemas phase 5a: every POST action on
 * /api/v1/system/tools validates its body with a Zod schema in
 * `lib/system-tools/`, and a malformed body reaches the middleware as a 400
 * — never a 500, and never "field absent".
 */

import { describe, it, expect, beforeEach } from '@jest/globals'

jest.mock('@/lib/backup/restore-service', () => ({
  deleteAllUserData: jest.fn(),
  previewDeleteAllUserData: jest.fn(),
}))
jest.mock('@/lib/background-jobs/processor', () => ({
  startProcessor: jest.fn(),
  stopProcessor: jest.fn(),
  getProcessorStatus: jest.fn(() => ({ running: false })),
  wakeProcessor: jest.fn(),
}))
jest.mock('@/lib/instance-settings', () => ({
  getMaxConcurrentJobs: jest.fn(async () => 4),
  setMaxConcurrentJobs: jest.fn(),
  listPortableInstanceSettings: jest.fn(async () => []),
}))
jest.mock('@/lib/export/quilltap-export-service', () => ({ previewExport: jest.fn() }))
jest.mock('@/lib/export/ndjson-writer', () => ({
  createNdjsonStream: jest.fn(),
  QTAP_NDJSON_CONTENT_TYPE: 'application/x-ndjson',
}))
jest.mock('@/lib/import/quilltap-import-service', () => ({
  previewImport: jest.fn(),
  executeImport: jest.fn(),
}))
jest.mock('@/lib/import/ndjson-reader', () => ({
  peekFormat: jest.fn(),
  readNdjsonLines: jest.fn(),
  collectLegacyJson: jest.fn(),
}))
jest.mock('@/lib/import/quilltap-import-stream', () => ({ assembleExportFromStream: jest.fn() }))
jest.mock('@/lib/tools/almanack', () => ({ generateAndSaveAlmanack: jest.fn() }))
jest.mock('@/lib/progress/operation-progress-sse', () => ({ operationProgressSseResponse: jest.fn() }))
jest.mock('@/lib/services/ai-import.service', () => ({ runAIImportStreaming: jest.fn() }))
jest.mock('@/lib/file-storage/manager', () => ({
  fileStorageManager: { downloadFile: jest.fn(), deleteFile: jest.fn() },
}))

import { GET, POST } from '../../../../app/api/v1/system/tools/route'
import { getServerSession } from '@/lib/auth/session'
import { getRepositories, getRepositoriesSafe } from '@/lib/repositories/factory'
import { createMockRepositoryContainer, setupAuthMocks } from '../fixtures/mock-repositories'
import { deleteAllUserData } from '@/lib/backup/restore-service'
import { startProcessor, stopProcessor } from '@/lib/background-jobs/processor'
import { setMaxConcurrentJobs } from '@/lib/instance-settings'
import { createNdjsonStream } from '@/lib/export/ndjson-writer'
import { previewImport, executeImport } from '@/lib/import/quilltap-import-service'
import { generateAndSaveAlmanack } from '@/lib/tools/almanack'
import { runAIImportStreaming } from '@/lib/services/ai-import.service'

const mockRepos = createMockRepositoryContainer() as any

const BASE = 'http://localhost/api/v1/system/tools'

function jsonRequest(action: string, body: unknown, method = 'POST') {
  const url = `${BASE}?action=${action}`
  const text = body === undefined ? '' : JSON.stringify(body)
  return {
    url,
    nextUrl: new URL(url),
    method,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => JSON.parse(text),
    text: async () => text,
  } as any
}

function getRequest(query: string) {
  const url = `${BASE}?${query}`
  return { url, nextUrl: new URL(url), method: 'GET', headers: new Headers() } as any
}

const validExport = { manifest: { format: 'quilltap-export', version: '1.0', exportType: 'characters' }, data: {} }

beforeEach(() => {
  jest.clearAllMocks()
  jest.mocked(getRepositories).mockReturnValue(mockRepos)
  jest.mocked(getRepositoriesSafe).mockResolvedValue(mockRepos)
  setupAuthMocks(jest.mocked(getServerSession) as jest.Mock, mockRepos)
  mockRepos.files = { ...mockRepos.files, findByCategory: jest.fn(async () => []), delete: jest.fn() }
})

describe('system/tools POST bodies are validated (phase 5a)', () => {
  it.each([
    ['delete-data without the confirmation', 'delete-data', {}, 'Confirmation required', () => deleteAllUserData],
    ['delete-data with a wrong confirmation', 'delete-data', { confirm: 'yes' }, 'Confirmation required', () => deleteAllUserData],
    ['delete-data with a string keepArchivedCharacterBundles', 'delete-data', { confirm: 'DELETE_ALL_MY_DATA', keepArchivedCharacterBundles: 'no' }, 'keepArchivedCharacterBundles', () => deleteAllUserData],
    ['tasks-queue with an unknown action', 'tasks-queue', { action: 'pause' }, 'Invalid action', () => startProcessor],
    ['tasks-queue with no action', 'tasks-queue', {}, 'Invalid action', () => stopProcessor],
    ['job-concurrency above the cap', 'job-concurrency', { concurrency: 64 }, 'concurrency', () => setMaxConcurrentJobs],
    ['job-concurrency as a string', 'job-concurrency', { concurrency: '4' }, 'concurrency', () => setMaxConcurrentJobs],
    ['export with no type', 'export', { scope: 'all' }, 'type', () => createNdjsonStream],
    ['export with an unknown type', 'export', { type: 'widgets' }, 'Unknown entity type: widgets', () => createNdjsonStream],
    ['export with an unknown scope', 'export', { type: 'characters', scope: 'some' }, 'scope', () => createNdjsonStream],
    ['import-preview with no exportData', 'import-preview', {}, 'Missing required field: exportData', () => previewImport],
    ['import-preview with a string exportData', 'import-preview', { exportData: 'x' }, 'exportData', () => previewImport],
    ['import-execute with no options', 'import-execute', { exportData: validExport }, 'Missing required field: options', () => executeImport],
    ['import-execute with an unknown conflict strategy', 'import-execute', { exportData: validExport, options: { conflictStrategy: 'merge' } }, 'Invalid conflictStrategy', () => executeImport],
    ['import-execute with malformed selectedIds', 'import-execute', { exportData: validExport, options: { conflictStrategy: 'skip', selectedIds: ['a'] } }, 'selectedIds', () => executeImport],
    ['capabilities-report-generate with a non-uuid progressId', 'capabilities-report-generate', { progressId: 'nope' }, 'progressId', () => generateAndSaveAlmanack],
    ['capabilities-report-delete with no reportId', 'capabilities-report-delete', {}, 'Missing reportId', () => mockRepos.files.delete],
    ['ai-import-stream with no profileId', 'ai-import-stream', { sourceText: 'hello' }, 'Missing required field: profileId', () => runAIImportStreaming],
    ['ai-import-stream with no source', 'ai-import-stream', { profileId: 'p1' }, 'Must provide at least one source file or source text', () => runAIImportStreaming],
    ['ai-import-stream with an unknown regenerate step', 'ai-import-stream', { profileId: 'p1', sourceText: 'x', regenerateSteps: ['everything'] }, 'regenerateSteps', () => runAIImportStreaming],
  ])('%s is a 400', async (_label, action, body, messagePart, sideEffect) => {
    const res = await POST(jsonRequest(action as string, body))
    expect(res.status).toBe(400)
    const payload = await res.json()
    expect(payload.error).toBe('Validation error')
    expect(payload.message).toContain(messagePart)
    expect((sideEffect as () => jest.Mock)()).not.toHaveBeenCalled()
  })

  it('capabilities-report-generate with no body is still accepted (untracked run)', async () => {
    jest.mocked(generateAndSaveAlmanack).mockResolvedValue({
      reportId: 'r1', filename: 'a.md', storageKey: 'k', size: 1, content: 'x',
    } as any)
    const res = await POST(jsonRequest('capabilities-report-generate', undefined))
    expect(res.status).toBe(200)
    expect(jest.mocked(generateAndSaveAlmanack).mock.calls[0][1]).toEqual(
      expect.objectContaining({ progressId: null }),
    )
  })
})

describe('system/tools GET structured query params are validated (phase 5a)', () => {
  it('export-entities with an unknown type is a 400', async () => {
    const res = await GET(getRequest('action=export-entities&type=widgets'))
    expect(res.status).toBe(400)
    expect((await res.json()).message).toContain('Unknown entity type: widgets')
  })

  it('export-entities with no type is a 400', async () => {
    const res = await GET(getRequest('action=export-entities'))
    expect(res.status).toBe(400)
    expect((await res.json()).message).toContain('Missing type parameter')
  })

  it('export-preview with an unknown scope is a 400', async () => {
    const res = await GET(getRequest('action=export-preview&type=characters&scope=some'))
    expect(res.status).toBe(400)
  })
})
