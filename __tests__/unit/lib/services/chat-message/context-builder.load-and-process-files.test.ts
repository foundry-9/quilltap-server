import { loadAndProcessFiles } from '@/lib/services/chat-message/context-builder.service'
import { loadChatFilesForLLM } from '@/lib/chat-files-v2'
import {
  processFileAttachmentFallback,
  formatFallbackAsMessagePrefix,
} from '@/lib/chat/file-attachment-fallback'

jest.mock('@/lib/logging/create-logger', () => ({
  createServiceLogger: jest.fn(() => ({
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  })),
}))

jest.mock('@/lib/chat-files-v2', () => ({
  loadChatFilesForLLM: jest.fn(),
}))

jest.mock('@/lib/chat/file-attachment-fallback', () => ({
  processFileAttachmentFallback: jest.fn(),
  formatFallbackAsMessagePrefix: jest.fn(),
}))

describe('loadAndProcessFiles', () => {
  const mockLoadChatFilesForLLM = jest.mocked(loadChatFilesForLLM)
  const mockProcessFileAttachmentFallback = jest.mocked(processFileAttachmentFallback)
  const mockFormatFallbackAsMessagePrefix = jest.mocked(formatFallbackAsMessagePrefix)

  const connectionProfile = { provider: 'openrouter' } as const

  function makeRepos(files: Array<Record<string, unknown>>) {
    return {
      files: {
        findByLinkedTo: jest.fn().mockResolvedValue(files),
      },
    } as never
  }

  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('returns empty result and skips repository/file loading when no file IDs are provided', async () => {
    const repos = makeRepos([])

    const result = await loadAndProcessFiles(repos, 'chat-1', 'user-1', connectionProfile)

    expect(result).toEqual({
      attachedFiles: [],
      fileAttachments: [],
      fallbackResults: [],
      messageContentPrefix: '',
      attachmentsToSend: [],
    })
    expect(repos.files.findByLinkedTo).not.toHaveBeenCalled()
    expect(mockLoadChatFilesForLLM).not.toHaveBeenCalled()
  })

  it('keeps attachments when fallback reports native support (unsupported with no error)', async () => {
    const repos = makeRepos([
      {
        id: 'file-1',
        originalFilename: 'portrait.png',
        mimeType: 'image/png',
        size: 123,
      },
    ])
    const attachment = { id: 'file-1', mimeType: 'image/png', filename: 'portrait.png' }

    mockLoadChatFilesForLLM.mockResolvedValue([attachment] as never)
    mockProcessFileAttachmentFallback.mockResolvedValue({ type: 'unsupported' } as never)
    mockFormatFallbackAsMessagePrefix.mockReturnValue('')

    const result = await loadAndProcessFiles(
      repos,
      'chat-1',
      'user-1',
      connectionProfile,
      ['file-1'],
    )

    expect(result.attachmentsToSend).toEqual([attachment])
    expect(result.messageContentPrefix).toBe('')
    expect(mockProcessFileAttachmentFallback).toHaveBeenCalledWith(
      {
        id: 'file-1',
        filepath: 'api/files/file-1',
        filename: 'portrait.png',
        mimeType: 'image/png',
        size: 123,
      },
      attachment,
      connectionProfile,
      repos,
      'user-1',
    )
  })

  it('drops attachments when fallback fails and keeps warning prefix text', async () => {
    const repos = makeRepos([
      {
        id: 'file-ok',
        originalFilename: 'supported.png',
        mimeType: 'image/png',
        size: 111,
      },
      {
        id: 'file-fail',
        originalFilename: 'unsupported.png',
        mimeType: 'image/png',
        size: 222,
      },
    ])
    const supportedAttachment = { id: 'file-ok', mimeType: 'image/png', filename: 'supported.png' }
    const failingAttachment = { id: 'file-fail', mimeType: 'image/png', filename: 'unsupported.png' }

    mockLoadChatFilesForLLM.mockResolvedValue([supportedAttachment, failingAttachment] as never)
    mockProcessFileAttachmentFallback
      .mockResolvedValueOnce({ type: 'unsupported' } as never)
      .mockResolvedValueOnce({ type: 'unsupported', error: 'No endpoints found that support image input' } as never)
    mockFormatFallbackAsMessagePrefix.mockImplementation(result => (
      (result as { error?: string }).error ? '⚠️ Could not describe image.\n\n' : ''
    ))

    const result = await loadAndProcessFiles(
      repos,
      'chat-1',
      'user-1',
      connectionProfile,
      ['file-ok', 'file-fail'],
    )

    expect(result.attachmentsToSend).toEqual([supportedAttachment])
    expect(result.messageContentPrefix).toContain('⚠️ Could not describe image.')
  })
})
