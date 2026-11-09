/**
 * @jest-environment node
 *
 * `ChatDocumentsRepository.findUnderFolder` matches the folder prefix
 * case-insensitively (#147). Every store treats `notes` and `Notes` as one
 * folder — the database store's NOCASE rows and a case-insensitive disk — so a
 * Document-Mode row recorded as `Notes/a.md` is under a move of `notes`.
 */

jest.mock('@/lib/logger', () => {
  const mock = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), child: jest.fn() }
  mock.child.mockReturnValue(mock)
  return { logger: mock }
})

import { ChatDocumentsRepository } from '@/lib/database/repositories/chat-documents.repository'

function repoWith(paths: string[]) {
  const repo = new ChatDocumentsRepository()
  ;(repo as unknown as { findAll: jest.Mock }).findAll = jest
    .fn()
    .mockResolvedValue(paths.map((filePath, i) => ({ id: `r${i}`, filePath })))
  return repo
}

describe('ChatDocumentsRepository.findUnderFolder', () => {
  it('finds a row recorded in another casing', async () => {
    const repo = repoWith(['Notes/a.md', 'Notes/sub/b.md', 'Other/c.md'])
    const found = await repo.findUnderFolder('notes')
    expect(found.map((r) => r.filePath)).toEqual(['Notes/a.md', 'Notes/sub/b.md'])
  })

  it('does not match a sibling that only shares the prefix', async () => {
    const repo = repoWith(['Notes/a.md', 'Notesbook/b.md'])
    const found = await repo.findUnderFolder('NOTES/')
    expect(found.map((r) => r.filePath)).toEqual(['Notes/a.md'])
  })
})
