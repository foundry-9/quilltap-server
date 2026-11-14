/**
 * #185: a send to a chat still pending its opening runs the opening first,
 * without the greeting; an opened chat and an autonomous room are left alone.
 */

jest.mock('@/lib/logging/create-logger', () => ({
  createServiceLogger: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}))

jest.mock('@/lib/chat/opening/run', () => ({
  runOpening: jest.fn(async () => undefined),
}))

import { openBeforeSend } from '@/lib/services/chat-message/open-before-send'
import { runOpening } from '@/lib/chat/opening/run'

const run = runOpening as jest.Mock
const narrator = { phase: jest.fn(), status: jest.fn(), done: jest.fn() } as never

function makeRepos(state: string, chat: Record<string, unknown> | null = { id: 'chat-1', chatType: 'salon' }) {
  return {
    chats: {
      getOpeningState: jest.fn(async () => ({ state, phase: null, plan: null })),
      findById: jest.fn(async () => chat),
    },
  } as never
}

beforeEach(() => jest.clearAllMocks())

describe('openBeforeSend', () => {
  it('runs the opening, with no greeting, for a pending chat', async () => {
    await openBeforeSend(makeRepos('pending'), 'chat-1', 'user-1', narrator)
    expect(run).toHaveBeenCalledTimes(1)
    const input = run.mock.calls[0][0]
    expect(input).toMatchObject({ chatId: 'chat-1', userId: 'user-1', trigger: 'open', narrator })
    expect(input.greet).toBeUndefined()
  })

  it('resumes an opening left running', async () => {
    await openBeforeSend(makeRepos('running'), 'chat-1', 'user-1', narrator)
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('does nothing for an opened chat', async () => {
    const repos = makeRepos('done')
    await openBeforeSend(repos, 'chat-1', 'user-1', narrator)
    expect(run).not.toHaveBeenCalled()
    expect((repos as any).chats.findById).not.toHaveBeenCalled()
  })

  it('leaves an unopened autonomous room to its run start', async () => {
    await openBeforeSend(makeRepos('pending', { id: 'chat-1', chatType: 'autonomous' }), 'chat-1', 'user-1', narrator)
    expect(run).not.toHaveBeenCalled()
  })
})
