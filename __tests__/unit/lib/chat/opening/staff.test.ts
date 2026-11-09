/**
 * @jest-environment node
 *
 * The staff's opening posts check for their own row only when the opening is
 * resuming. A continuation's replayed history carries the source chat's Host
 * scenario and Prospero rows; a first opening must still post its own (found
 * live on V4test: the continuation lost its Host scenario).
 */

jest.mock('@/lib/logger', () => {
  const logger: Record<string, unknown> = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }
  logger.child = () => logger
  return { logger }
})
jest.mock('@/lib/services/host-notifications/writer', () => ({
  postHostScenarioAnnouncement: jest.fn(async () => null),
  postHostUserCharacterAnnouncement: jest.fn(async () => null),
}))
jest.mock('@/lib/services/prospero-notifications/writer', () => ({
  loadProsperoProjectContext: jest.fn(async () => null),
  loadProsperoGeneralContext: jest.fn(async () => ({ name: 'Quilltap General' })),
  postProsperoContextAnnouncement: jest.fn(async () => null),
  postProsperoGroupContextWhisper: jest.fn(async () => null),
}))

import { postHostScenarioOpening, postProsperoOpening } from '@/lib/chat/opening/staff'
import { postHostScenarioAnnouncement } from '@/lib/services/host-notifications/writer'
import { postProsperoContextAnnouncement } from '@/lib/services/prospero-notifications/writer'

const replayed = [
  { type: 'message', role: 'ASSISTANT', systemSender: 'host', systemKind: 'scenario', content: 'The old scene.' },
  { type: 'message', role: 'ASSISTANT', systemSender: 'prospero', systemKind: 'general-context', content: 'Shelf.' },
]
const repos = { chats: { getMessages: jest.fn(async () => replayed) } } as never
const chat = { id: 'chat-1', projectId: null, scenarioText: 'The new scene.', participants: [] } as never

beforeEach(() => jest.clearAllMocks())

describe('staff opening posts', () => {
  it('post their own rows on a first opening, whatever the replayed history holds', async () => {
    await postHostScenarioOpening(repos, chat, { resuming: false })
    await postProsperoOpening(repos, chat, { resuming: false })
    expect(postHostScenarioAnnouncement).toHaveBeenCalledWith({ chatId: 'chat-1', scenarioText: 'The new scene.' })
    expect(postProsperoContextAnnouncement).toHaveBeenCalledTimes(1)
  })

  it('skip a row the chat already has when resuming', async () => {
    await postHostScenarioOpening(repos, chat, { resuming: true })
    await postProsperoOpening(repos, chat, { resuming: true })
    expect(postHostScenarioAnnouncement).not.toHaveBeenCalled()
    expect(postProsperoContextAnnouncement).not.toHaveBeenCalled()
  })
})
