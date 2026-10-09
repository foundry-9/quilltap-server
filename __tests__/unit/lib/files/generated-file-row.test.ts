/**
 * createGeneratedFileRow (lib/files/generated-file-row.ts): the one `files`
 * row every stored picture gets — the bridge's stored type and size, measured
 * dimensions, and no label in `description` (bug 132).
 */

import { createGeneratedFileRow } from '@/lib/files/generated-file-row'

const SHA = 'a'.repeat(64)

describe('createGeneratedFileRow', () => {
  it('records what the bridge stored, with no label', async () => {
    const create = jest.fn(async (data: object, options?: { id?: string }) => ({ ...data, id: options?.id }))
    const row = await createGeneratedFileRow({ files: { create } } as never, {
      id: 'file-1',
      userId: 'user-1',
      sha256: SHA,
      originalFilename: 'avatar_x.webp',
      stored: { storageKey: 'mount-blob:m:b', storedMimeType: 'image/webp', sizeBytes: 1234 },
      width: 832,
      height: 1216,
      linkedTo: ['chat-1', 'char-1'],
      tags: ['char-1'],
      generation: { prompt: 'the prompt', model: 'gpt-image-1', revisedPrompt: null },
      generationKey: 'key-1',
    })

    expect(create).toHaveBeenCalledWith(
      {
        userId: 'user-1',
        sha256: SHA,
        originalFilename: 'avatar_x.webp',
        mimeType: 'image/webp',
        size: 1234,
        width: 832,
        height: 1216,
        linkedTo: ['chat-1', 'char-1'],
        source: 'GENERATED',
        category: 'IMAGE',
        generationPrompt: 'the prompt',
        generationModel: 'gpt-image-1',
        generationRevisedPrompt: null,
        generationKey: 'key-1',
        description: null,
        tags: ['char-1'],
        storageKey: 'mount-blob:m:b',
        projectId: null,
        folderPath: null,
      },
      { id: 'file-1' },
    )
    expect(row.id).toBe('file-1')
  })

  it('mints an id and takes the source it is given', async () => {
    const create = jest.fn(async (data: object, options?: { id?: string }) => ({ ...data, id: options?.id }))
    await createGeneratedFileRow({ files: { create } } as never, {
      userId: 'user-1',
      sha256: SHA,
      originalFilename: 'x.webp',
      stored: { storageKey: 'k', storedMimeType: 'image/webp', sizeBytes: 1 },
      linkedTo: ['item-1'],
      source: 'IMPORTED',
    })
    const [data, options] = create.mock.calls[0]
    expect(options?.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(data).toEqual(expect.objectContaining({ source: 'IMPORTED', width: null, height: null, generationPrompt: null }))
  })
})
