/**
 * @jest-environment node
 *
 * The opening (`runOpening`, D1/D6/D10 of the opening spec): a resumable walk
 * over OPENING_PHASES that skips what does not apply to the chat's flavour,
 * resumes after the last phase it recorded, stops short of the greeting when
 * the operator presses Stop, and starts an ad-hoc autonomous room only once
 * the room is opened.
 */

jest.mock('@/lib/logger', () => {
  const logger: Record<string, unknown> = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }
  logger.child = () => logger
  return { logger }
})
jest.mock('@/lib/services/system-prompt-compiler/compiler', () => ({ compileAllIdentityStacks: jest.fn(async () => {}) }))
jest.mock('@/lib/chat/opening/staff', () => ({
  postProsperoOpening: jest.fn(async () => {}),
  postHostScenarioOpening: jest.fn(async () => {}),
  postHostUserCharacterOpening: jest.fn(async () => {}),
}))
jest.mock('@/lib/chat/opening/arrival', () => ({ seatArrivals: jest.fn(async () => {}) }))
jest.mock('@/lib/services/chat-message/autonomous-room.service', () => ({
  startAutonomousRoomManually: jest.fn(async () => ({ ok: true, runId: 'r', jobId: 'j' })),
}))
jest.mock('@/lib/realtime/bus', () => ({ publishRealtime: jest.fn() }))
const stopped = { value: false }
jest.mock('@/lib/chat/turn-control', () => ({ isCurrentTurnStopped: () => stopped.value }))

import { OPENING_PHASES, reconcileStaleOpeningsAtStartup, runOpening } from '@/lib/chat/opening/run'
import { seatArrivals } from '@/lib/chat/opening/arrival'
import { startAutonomousRoomManually } from '@/lib/services/chat-message/autonomous-room.service'
import { publishRealtime } from '@/lib/realtime/bus'
import type { GreenRoomNarrator } from '@/lib/chat/opening/narrator'

const CHAT = 'chat-1'

function makeRepos(opts: {
  state?: 'pending' | 'running' | 'done'
  phase?: string | null
  plan?: unknown
  chat?: Record<string, unknown>
  messages?: unknown[]
} = {}) {
  const chat = {
    id: CHAT,
    chatType: 'salon',
    participants: [{ id: 'p1', type: 'CHARACTER', characterId: 'c1', controlledBy: 'llm', status: 'active' }],
    ...opts.chat,
  }
  return {
    chats: {
      getOpeningState: jest.fn(async () => ({ state: opts.state ?? 'pending', phase: opts.phase ?? null, plan: opts.plan ?? null })),
      setOpeningState: jest.fn(async () => true),
      findById: jest.fn(async () => chat),
      getMessages: jest.fn(async () => opts.messages ?? []),
      resetStaleOpenings: jest.fn(async () => 2),
    },
  }
}

function recordingNarrator() {
  const said: string[] = []
  const narrator: GreenRoomNarrator = {
    phase: (key) => said.push(`phase:${key}`),
    status: () => {},
    log: () => {},
    wardrobeStart: () => {},
    wardrobeResult: () => {},
    inventory: () => {},
    done: () => said.push('done'),
  }
  return { narrator, said }
}

beforeEach(() => {
  jest.clearAllMocks()
  stopped.value = false
})

describe('the walk', () => {
  it('opens a Salon chat in the one order, greeting last, and says so', async () => {
    const repos = makeRepos()
    const { narrator, said } = recordingNarrator()
    const greet = jest.fn(async () => {})
    await runOpening({ repos: repos as never, chatId: CHAT, userId: 'u1', trigger: 'open', narrator, greet })

    expect(said).toEqual(['phase:stacks', 'phase:prospero', 'phase:host-scenario', 'phase:host-user-character', 'phase:arrivals', 'phase:greeting', 'done'])
    expect(greet).toHaveBeenCalledTimes(1)
    expect(repos.chats.setOpeningState).toHaveBeenLastCalledWith(CHAT, 'done', undefined, null)
    expect(publishRealtime).toHaveBeenCalledWith('chats', CHAT)
  })

  it('hands the operator\'s outfit choices to the arrivals', async () => {
    const plan = { outfitSelections: [{ characterId: 'c1', mode: 'none' }], sourceChatId: null }
    await runOpening({ repos: makeRepos({ plan }) as never, chatId: CHAT, userId: 'u1', trigger: 'open' })
    expect(seatArrivals).toHaveBeenCalledWith(expect.anything(), CHAT,
      [{ characterId: 'c1', outfitSelection: { characterId: 'c1', mode: 'none' } }],
      expect.objectContaining({ source: 'chat-start' }))
  })

  it('leaves an opened chat alone', async () => {
    const repos = makeRepos({ state: 'done' })
    const greet = jest.fn()
    await runOpening({ repos: repos as never, chatId: CHAT, userId: 'u1', trigger: 'open', greet })
    expect(greet).not.toHaveBeenCalled()
    expect(repos.chats.setOpeningState).not.toHaveBeenCalled()
  })

  it('resumes after the last phase it recorded (a tab closed mid-outfit, reopened)', async () => {
    const repos = makeRepos({ state: 'running', phase: 'host-user-character' })
    const { narrator, said } = recordingNarrator()
    await runOpening({ repos: repos as never, chatId: CHAT, userId: 'u1', trigger: 'open', narrator, greet: jest.fn(async () => {}) })
    expect(said).toEqual(['phase:arrivals', 'phase:greeting', 'done'])
  })

  it('does not greet a chat that already has its first line', async () => {
    const greet = jest.fn()
    const repos = makeRepos({ messages: [{ type: 'message', role: 'ASSISTANT', participantId: 'p1', content: 'Hello.' }] })
    await runOpening({ repos: repos as never, chatId: CHAT, userId: 'u1', trigger: 'open', greet })
    expect(greet).not.toHaveBeenCalled()
  })

  it('gives a continuation no greeting', async () => {
    const greet = jest.fn()
    const { narrator, said } = recordingNarrator()
    await runOpening({ repos: makeRepos({ plan: { sourceChatId: 'old' } }) as never, chatId: CHAT, userId: 'u1', trigger: 'open', narrator, greet })
    expect(greet).not.toHaveBeenCalled()
    expect(said).not.toContain('phase:greeting')
  })

  it('runs one opening per chat at a time; the second caller waits for the first', async () => {
    const repos = makeRepos()
    let release!: () => void
    const greet = jest.fn(() => new Promise<void>((resolve) => { release = resolve }))
    const first = runOpening({ repos: repos as never, chatId: CHAT, userId: 'u1', trigger: 'open', greet })
    await new Promise((r) => setImmediate(r))
    let secondDone = false
    const second = runOpening({ repos: repos as never, chatId: CHAT, userId: 'u1', trigger: 'open', greet }).then(() => { secondDone = true })
    await new Promise((r) => setImmediate(r))
    expect(secondDone).toBe(false)
    release()
    await Promise.all([first, second])
    expect(greet).toHaveBeenCalledTimes(1)
  })
})

describe('Stop', () => {
  it('skips the greeting and marks the chat opened; what was dressed stays', async () => {
    const repos = makeRepos()
    const greet = jest.fn()
    ;(seatArrivals as jest.Mock).mockImplementationOnce(async () => { stopped.value = true })
    await runOpening({ repos: repos as never, chatId: CHAT, userId: 'u1', trigger: 'open', greet })
    expect(seatArrivals).toHaveBeenCalled()
    expect(greet).not.toHaveBeenCalled()
    expect(repos.chats.setOpeningState).toHaveBeenLastCalledWith(CHAT, 'done', undefined, null)
  })
})

describe('autonomous rooms', () => {
  it('start themselves once opened, when ad hoc and opened for their own sake', async () => {
    const repos = makeRepos({ chat: { chatType: 'autonomous', scheduleCron: null } })
    await runOpening({ repos: repos as never, chatId: CHAT, userId: 'u1', trigger: 'open' })
    expect(startAutonomousRoomManually).toHaveBeenCalledWith(CHAT, 'u1')
    // The room is opened before its run begins (the run start checks).
    const doneCall = repos.chats.setOpeningState.mock.invocationCallOrder[
      repos.chats.setOpeningState.mock.calls.findIndex((c) => (c as unknown[])[1] === 'done')
    ]
    expect(doneCall).toBeLessThan((startAutonomousRoomManually as jest.Mock).mock.invocationCallOrder[0])
  })

  it('do not start when scheduled, nor when the run start itself opened them', async () => {
    await runOpening({ repos: makeRepos({ chat: { chatType: 'autonomous', scheduleCron: '0 * * * *' } }) as never, chatId: CHAT, userId: 'u1', trigger: 'open' })
    await runOpening({ repos: makeRepos({ chat: { chatType: 'autonomous', scheduleCron: null } }) as never, chatId: 'chat-2', userId: 'u1', trigger: 'run-start' })
    expect(startAutonomousRoomManually).not.toHaveBeenCalled()
  })
})

describe('the phase table', () => {
  it('greets only a Salon chat and starts only an autonomous room', () => {
    const keysFor = (flavour: 'salon' | 'continuation' | 'autonomous') =>
      OPENING_PHASES.filter((p) => p.appliesTo(flavour)).map((p) => p.key)
    expect(keysFor('salon')).toEqual(['stacks', 'prospero', 'host-scenario', 'host-user-character', 'arrivals', 'greeting'])
    expect(keysFor('continuation')).toEqual(['stacks', 'prospero', 'host-scenario', 'host-user-character', 'arrivals'])
    expect(keysFor('autonomous')).toEqual(['stacks', 'prospero', 'host-scenario', 'host-user-character', 'arrivals', 'autonomous-start'])
  })
})

describe('startup', () => {
  it('returns broken-off openings to pending', async () => {
    const repos = makeRepos()
    expect(await reconcileStaleOpeningsAtStartup(repos as never)).toBe(2)
    expect(repos.chats.resetStaleOpenings).toHaveBeenCalledWith(expect.any(String))
  })
})
