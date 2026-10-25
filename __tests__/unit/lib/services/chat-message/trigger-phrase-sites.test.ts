/**
 * The two sites Pascal listens at: who the speaker is, which room they are in,
 * that continue mode says nothing, that the operator's site splices Pascal's
 * posts into the turn's context — and, read off the source, that each site
 * runs AFTER the words it scans were persisted.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { runUserMessageTriggers, runReplyTriggers } from '@/lib/services/chat-message/trigger-phrase-sites'
import { runTriggeredCustomTools } from '@/lib/pascal/trigger-runner'

jest.mock('@/lib/pascal/trigger-runner', () => ({
  runTriggeredCustomTools: jest.fn(),
}))

const runnerMock = runTriggeredCustomTools as jest.Mock
const SETTINGS = { customTools: true, customToolTriggers: true }
const CHAT = { projectId: 'proj-1' }

beforeEach(() => {
  jest.clearAllMocks()
  runnerMock.mockResolvedValue([{ id: 'pascal-1' }])
})

describe('runUserMessageTriggers', () => {
  const base = {
    userId: 'user-1',
    chatId: 'chat-1',
    chat: CHAT,
    content: 'abracadabra',
    isContinueMode: false,
    userParticipant: null,
    userParticipantId: null,
    chatSettings: SETTINGS,
    onPosted: jest.fn(),
  }

  it('scans as the bare operator when the seat is not a character', async () => {
    const existingMessages: unknown[] = []
    await runUserMessageTriggers({ ...base, existingMessages: existingMessages as never })
    expect(runnerMock.mock.calls[0][0]).toMatchObject({
      content: 'abracadabra',
      speaker: { participantId: null, characterId: null },
      projectId: 'proj-1',
      chatSettings: SETTINGS,
    })
    expect(runnerMock.mock.calls[0][0]).not.toHaveProperty('characterIds')
  })

  it("speaks as a user-driven character seat, with that character's perspective", async () => {
    await runUserMessageTriggers({
      ...base,
      userParticipant: { type: 'CHARACTER', characterId: 'char-2' },
      userParticipantId: 'seat-2',
      existingMessages: [] as never,
    })
    expect(runnerMock.mock.calls[0][0].speaker).toEqual({ participantId: 'seat-2', characterId: 'char-2' })
  })

  it("splices Pascal's posts into the turn's in-memory context", async () => {
    const existingMessages: unknown[] = [{ id: 'earlier' }]
    await runUserMessageTriggers({ ...base, existingMessages: existingMessages as never })
    expect(existingMessages).toEqual([{ id: 'earlier' }, { id: 'pascal-1' }])
  })

  it('does not run in continue mode, or when nothing was said', async () => {
    await runUserMessageTriggers({ ...base, isContinueMode: true, existingMessages: [] as never })
    await runUserMessageTriggers({ ...base, content: '', existingMessages: [] as never })
    expect(runnerMock).not.toHaveBeenCalled()
  })
})

describe('runReplyTriggers', () => {
  it("scans the reply from the speaking character's own perspective", async () => {
    await runReplyTriggers({
      userId: 'user-1',
      chatId: 'chat-1',
      chat: CHAT,
      content: 'I draw my sword',
      characterParticipantId: 'seat-1',
      characterId: 'char-1',
      chatSettings: SETTINGS,
      onPosted: jest.fn(),
    })
    expect(runnerMock.mock.calls[0][0]).toMatchObject({
      content: 'I draw my sword',
      speaker: { participantId: 'seat-1', characterId: 'char-1' },
    })
    expect(runnerMock.mock.calls[0][0]).not.toHaveProperty('characterIds')
  })
})

describe('the sites run after the words are persisted', () => {
  const source = (file: string) =>
    readFileSync(join(process.cwd(), 'lib/services/chat-message', file), 'utf8')

  it('operator post: after the user message is persisted', () => {
    const text = source('operator-post.service.ts')
    const persisted = text.indexOf('ledger.userMessagePersisted = true')
    const site = text.indexOf('await runUserMessageTriggers(')
    expect(persisted).toBeGreaterThan(0)
    expect(site).toBeGreaterThan(persisted)
  })

  it('finalizer: after the assistant message is saved', () => {
    const text = source('message-finalizer.service.ts')
    const body = text.slice(text.indexOf('export async function finalizeMessageResponse'))
    const saved = body.indexOf('saveAssistantMessage(')
    const site = body.indexOf('await runReplyTriggers(')
    expect(saved).toBeGreaterThan(0)
    expect(site).toBeGreaterThan(saved)
  })

  it('a swipe never reaches either site', () => {
    expect(source('regenerate-swipe.service.ts')).not.toMatch(/runUserMessageTriggers|runReplyTriggers|runTriggeredCustomTools/)
  })
})
