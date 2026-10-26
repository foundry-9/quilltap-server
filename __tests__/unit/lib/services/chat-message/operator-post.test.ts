/**
 * Recording an operator's post (`recordOperatorPost`): the one door every
 * path that saves an operator message goes through (bug 262).
 *
 * Pins the transcript order — staged tool results, then auto-rolled dice, then
 * the USER row, then Pascal and Carina after it — the submission ledger, and
 * which rows are spliced into the turn's in-memory context.
 */

jest.mock('@/lib/logging/create-logger', () => {
  const logger = () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), child: jest.fn() })
  return { createServiceLogger: jest.fn(logger), createLogger: jest.fn(logger) }
})

jest.mock('@/lib/services/librarian-notifications/writer', () => ({
  postLibrarianUploadAnnouncement: jest.fn(async () => null),
}))

jest.mock('@/lib/services/carina/markup-runner', () => ({
  runCarinaMarkupQuery: jest.fn(async () => undefined),
}))

jest.mock('@/lib/tools/handlers/rng-handler', () => ({
  executeRngTool: jest.fn(async () => ({ success: true, results: [4] })),
  formatRngResults: jest.fn(() => 'Rolled 4'),
}))

jest.mock('@/lib/services/chat-message/trigger-phrase-sites', () => ({
  runUserMessageTriggers: jest.fn(async () => []),
}))

import { recordOperatorPost, type OperatorPostParams } from '@/lib/services/chat-message/operator-post.service'
import { newSubmissionLedger } from '@/lib/services/chat-message/turn-stream'
import { postLibrarianUploadAnnouncement } from '@/lib/services/librarian-notifications/writer'
import { runCarinaMarkupQuery } from '@/lib/services/carina/markup-runner'
import { runUserMessageTriggers } from '@/lib/services/chat-message/trigger-phrase-sites'
import type { ChatEvent } from '@/lib/schemas/chat.types'

function setup(over: Partial<OperatorPostParams> = {}) {
  const order: string[] = []
  const repos = {
    chats: {
      addMessage: jest.fn(async (_chatId: string, message: { role: string; content: string }) => {
        order.push(`${message.role}:${message.role === 'TOOL' ? JSON.parse(message.content).initiatedBy : message.content}`)
        return message
      }),
      updateMessage: jest.fn(async () => {
        order.push('dangerFlags')
        return null
      }),
    },
    files: {
      addLink: jest.fn(async (fileId: string) => {
        order.push(`link:${fileId}`)
      }),
    },
  }
  jest.mocked(runUserMessageTriggers).mockImplementation(async () => {
    order.push('pascal')
    return []
  })
  jest.mocked(runCarinaMarkupQuery).mockImplementation(async () => {
    order.push('carina')
  })
  const context: ChatEvent[] = []
  const ledger = newSubmissionLedger()
  const params: OperatorPostParams = {
    repos: repos as never,
    chatId: 'chat-1',
    userId: 'user-1',
    chat: { projectId: null },
    chatSettings: null,
    content: 'I roll 1d6 and open the door',
    fileIds: ['img-1', 'gone'],
    attachedFiles: [{ id: 'img-1', filename: 'map.png', mimeType: 'image/png' }],
    pendingToolResults: [{ tool: 'rng', success: true, result: '3', prompt: '1d6', arguments: {}, createdAt: '2026-10-25T00:00:00Z' }],
    targetParticipantIds: null,
    poster: { participant: null, participantId: 'seat-1' },
    dangerFlags: [{ category: 'violence', score: 0.9 } as never],
    context,
    ledger,
    controller: { enqueue: jest.fn() } as never,
    encoder: new TextEncoder(),
    status: jest.fn(),
    ...over,
  }
  return { params, repos, order, context, ledger }
}

describe('recordOperatorPost', () => {
  beforeEach(() => jest.clearAllMocks())

  it('writes the post in transcript order', async () => {
    const { params, order } = setup()
    const { userMessageId } = await recordOperatorPost(params)

    expect(userMessageId).toEqual(expect.any(String))
    expect(order).toEqual([
      'TOOL:user',
      'TOOL:auto-detect',
      'USER:I roll 1d6 and open the door',
      'link:img-1',
      'dangerFlags',
      'pascal',
      'carina',
    ])
  })

  it('lists every named file on the USER row but links only the chat\'s own', async () => {
    const { params, repos } = setup()
    await recordOperatorPost(params)
    const userRow = repos.chats.addMessage.mock.calls.find(([, m]) => m.role === 'USER')![1] as { attachments: string[]; participantId: string }
    expect(userRow.attachments).toEqual(['img-1', 'gone'])
    expect(userRow.participantId).toBe('seat-1')
    expect(repos.files.addLink).toHaveBeenCalledTimes(1)
  })

  it('flips the ledger as each write lands', async () => {
    const { params, ledger } = setup()
    await recordOperatorPost(params)
    expect(ledger).toEqual({ userMessagePersisted: true, pendingToolResultsPersisted: true })
  })

  it('splices the TOOL rows into the turn context, not the USER row', async () => {
    const { params, context } = setup()
    await recordOperatorPost(params)
    expect(context.map(m => (m as { role: string }).role)).toEqual(['TOOL', 'TOOL'])
  })

  it('announces image uploads to the Librarian', async () => {
    const { params } = setup()
    await recordOperatorPost(params)
    expect(postLibrarianUploadAnnouncement).toHaveBeenCalledWith({
      chatId: 'chat-1',
      uploads: [{ fileId: 'img-1', filename: 'map.png' }],
    })
  })

  it('rolls no dice when the setting is off', async () => {
    const { params, order } = setup({ chatSettings: { autoDetectRng: false } as never })
    await recordOperatorPost(params)
    expect(order).not.toContain('TOOL:auto-detect')
  })

  it('a tools-only send writes no USER row and asks Carina nothing', async () => {
    const { params, order, ledger } = setup({ content: '', fileIds: [], attachedFiles: [] })
    const { userMessageId } = await recordOperatorPost(params)
    expect(userMessageId).toBeNull()
    expect(order).toEqual(['TOOL:user', 'pascal'])
    expect(ledger.userMessagePersisted).toBe(false)
  })

  it('a failed attachment link does not lose the post', async () => {
    const { params, repos, order } = setup()
    repos.files.addLink.mockRejectedValueOnce(new Error('gone'))
    await expect(recordOperatorPost(params)).resolves.toEqual({ userMessageId: expect.any(String) })
    expect(order).toContain('carina')
  })
})
