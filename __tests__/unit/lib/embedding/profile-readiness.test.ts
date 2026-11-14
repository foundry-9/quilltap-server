/**
 * An unfitted Built-in (TF-IDF) profile can embed nothing. On a new install
 * help-doc sync and the mount scan queued ~150 jobs against it, each retried
 * to DEAD on "not yet fitted". The readiness check gates the enqueuers, and
 * the job handler defers quietly instead of marking rows FAILED.
 */

jest.mock('@/lib/logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), child: jest.fn().mockReturnThis() },
}))

jest.mock('@/lib/repositories/factory', () => ({
  getRepositories: jest.fn(),
}))

jest.mock('@/lib/embedding/embedding-service', () => ({
  generateEmbeddingForUser: jest.fn(),
  averageEmbeddings: jest.fn(),
  EMBEDDING_MAX_CHARS: 128 * 1024,
}))

jest.mock('@/lib/memory/index-store', () => ({
  memoryIndex: { upsert: jest.fn().mockResolvedValue([]) },
  embeddingTextFor: jest.fn(() => 'memory text'),
  lexicalEmbeddingTextFor: jest.fn(() => 'memory text'),
}))

jest.mock('@/lib/database/backends/sqlite/mount-index-guard', () => ({
  requireMountIndexDb: jest.fn(() => ({})),
}))

import { isEmbeddingProfileReady } from '@/lib/embedding/profile-readiness'
import { handleEmbeddingGenerate } from '@/lib/background-jobs/handlers/embedding-generate'
import { getRepositories } from '@/lib/repositories/factory'
import { generateEmbeddingForUser } from '@/lib/embedding/embedding-service'
import type { BackgroundJob } from '@/lib/schemas/types'

const vocabRepo = (vocab: unknown) => ({ tfidfVocabularies: { findByProfileId: jest.fn().mockResolvedValue(vocab) } })

describe('isEmbeddingProfileReady', () => {
  it('treats an API profile as ready without reading anything', async () => {
    const repos = vocabRepo(null)
    expect(await isEmbeddingProfileReady({ id: 'p', provider: 'OPENAI' }, repos)).toBe(true)
    expect(repos.tfidfVocabularies.findByProfileId).not.toHaveBeenCalled()
  })

  it('treats a Built-in profile as ready only once it has a vocabulary', async () => {
    expect(await isEmbeddingProfileReady({ id: 'p', provider: 'BUILTIN' }, vocabRepo(null))).toBe(false)
    expect(await isEmbeddingProfileReady({ id: 'p', provider: 'BUILTIN' }, vocabRepo({ id: 'v' }))).toBe(true)
  })
})

describe('handleEmbeddingGenerate with an unfitted Built-in profile', () => {
  it('completes quietly: no embed, no FAILED row, no retry', async () => {
    const markAsFailed = jest.fn()
    ;(getRepositories as jest.Mock).mockReturnValue({
      embeddingProfiles: { findById: jest.fn().mockResolvedValue({ id: 'profile-1', provider: 'BUILTIN' }) },
      tfidfVocabularies: { findByProfileId: jest.fn().mockResolvedValue(null) },
      embeddingStatus: { markAsFailed, markAsEmbedded: jest.fn() },
      helpDocs: { findById: jest.fn() },
    })
    const job = {
      id: 'job-1',
      userId: 'user-1',
      type: 'EMBEDDING_GENERATE',
      status: 'pending',
      payload: { entityType: 'HELP_DOC', entityId: 'doc-1', profileId: 'profile-1' },
    } as unknown as BackgroundJob

    await expect(handleEmbeddingGenerate(job)).resolves.toBeUndefined()
    expect(generateEmbeddingForUser).not.toHaveBeenCalled()
    expect(markAsFailed).not.toHaveBeenCalled()
  })
})
