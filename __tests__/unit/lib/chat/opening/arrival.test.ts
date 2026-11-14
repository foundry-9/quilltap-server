/**
 * @jest-environment node
 *
 * One arrival (`lib/chat/opening/arrival.ts`, D4 of the opening spec): every
 * door — a chat's opening, a seat added mid-chat, a merge — dresses with the
 * same default rule, and every arriving seat is announced (Aurora's
 * opening-outfit whisper) and drawn (the avatar refresh, gated by the chat's
 * own setting) the way an opener is.
 */

jest.mock('@/lib/logger', () => {
  const logger: Record<string, unknown> = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }
  logger.child = () => logger
  return { logger }
})
jest.mock('@/lib/wardrobe/apply-outfit-selections', () => ({
  applyOutfitSelections: jest.fn(async () => {}),
}))
jest.mock('@/lib/inventory/apply-defaults', () => ({
  applyInventoryDefaults: jest.fn(async () => {}),
}))
jest.mock('@/lib/services/system-prompt-compiler/compiler', () => ({
  compileIdentityStackForParticipant: jest.fn(async () => {}),
}))
jest.mock('@/lib/services/host-notifications/writer', () => ({
  postHostAddAnnouncement: jest.fn(async () => null),
}))
jest.mock('@/lib/services/aurora-notifications/writer', () => ({
  postOpeningOutfitWhisper: jest.fn(async () => null),
}))
jest.mock('@/lib/mount-index/tiered-mount-pool', () => ({
  resolveProjectMountPointIds: jest.fn(async () => []),
}))
jest.mock('@/lib/wardrobe/pool', () => ({
  loadWearablePool: jest.fn(async () => ({ getMany: () => [{ id: 'shirt-1', title: 'Linen shirt' }] })),
}))
jest.mock('@/lib/background-jobs/queue-service', () => ({
  enqueueCharacterAvatarGeneration: jest.fn(async () => 'job-1'),
  enqueueWardrobeOutfitAnnouncement: jest.fn(async () => 'job-2'),
}))
jest.mock('@/lib/image-gen/profile-resolution', () => ({
  resolveAvatarImageProfile: jest.fn(async () => ({ id: 'img-profile-1' })),
}))

import { defaultOutfitMode, seatArrival, seatArrivals } from '@/lib/chat/opening/arrival'
import { applyOutfitSelections } from '@/lib/wardrobe/apply-outfit-selections'
import { applyInventoryDefaults } from '@/lib/inventory/apply-defaults'
import { postHostAddAnnouncement } from '@/lib/services/host-notifications/writer'
import { postOpeningOutfitWhisper } from '@/lib/services/aurora-notifications/writer'
import { enqueueCharacterAvatarGeneration } from '@/lib/background-jobs/queue-service'

const CHAT = 'chat-1'
const SOURCE = 'chat-source'
const CHOOSER = 'char-chooser'
const PLAIN = 'char-plain'

function makeRepos(opts: { avatarGenerationEnabled?: boolean; sourceOutfitFor?: string[] } = {}) {
  const chat = {
    id: CHAT,
    projectId: null,
    scenarioText: 'A drawing room.',
    avatarGenerationEnabled: opts.avatarGenerationEnabled ?? false,
    equippedOutfit: {},
    participants: [
      { id: 'p-chooser', type: 'CHARACTER', characterId: CHOOSER, controlledBy: 'llm', status: 'active' },
      { id: 'p-plain', type: 'CHARACTER', characterId: PLAIN, controlledBy: 'llm', status: 'active' },
    ],
  }
  const source = {
    id: SOURCE,
    participants: [],
    equippedOutfit: Object.fromEntries((opts.sourceOutfitFor ?? []).map((id) => [id, { top: ['x'] }])),
  }
  const characters: Record<string, unknown> = {
    [CHOOSER]: { id: CHOOSER, name: 'Bertie', canChooseOutfit: true },
    [PLAIN]: { id: PLAIN, name: 'Jeeves', canChooseOutfit: false },
  }
  return {
    chats: {
      findById: jest.fn(async (id: string) => (id === CHAT ? chat : id === SOURCE ? source : null)),
      getEquippedOutfitForCharacter: jest.fn(async () => ({ top: ['shirt-1'], bottom: [], footwear: [], accessories: [], hair: [] })),
    },
    characters: { findById: jest.fn(async (id: string) => characters[id] ?? null) },
    chatSettings: { findByUserId: jest.fn(async () => null) },
  } as never
}

const modesSent = () =>
  (applyOutfitSelections as jest.Mock).mock.calls.flatMap(([, selections]) =>
    (selections as Array<{ characterId: string; mode: string }>).map((s) => [s.characterId, s.mode]),
  )

describe('defaultOutfitMode — the one rule', () => {
  it('carries a source chat\'s outfit forward first', () => {
    expect(defaultOutfitMode({ canChooseOutfit: true, userControlled: false, sourceHasOutfit: true })).toBe('previous_chat')
  })
  it('lets an LLM-controlled character who may choose, choose', () => {
    expect(defaultOutfitMode({ canChooseOutfit: true, userControlled: false, sourceHasOutfit: false })).toBe('llm_choose')
  })
  it('never lets the operator\'s own seat dress itself', () => {
    expect(defaultOutfitMode({ canChooseOutfit: true, userControlled: true, sourceHasOutfit: false })).toBe('default')
  })
  it('falls back to the defaults', () => {
    expect(defaultOutfitMode({ canChooseOutfit: false, userControlled: false, sourceHasOutfit: false })).toBe('default')
  })
})

describe('every door asks a canChooseOutfit character to dress themselves when nothing was chosen', () => {
  beforeEach(() => jest.clearAllMocks())

  it('chat start', async () => {
    await seatArrivals(makeRepos(), CHAT, [{ characterId: CHOOSER }, { characterId: PLAIN }], { source: 'chat-start', userId: 'u1' })
    expect(modesSent()).toEqual([[CHOOSER, 'llm_choose'], [PLAIN, 'default']])
    // …and the chooser packs for themselves as well.
    expect((applyInventoryDefaults as jest.Mock).mock.calls[0][3].choose.characterIds).toEqual([CHOOSER])
  })

  it('a seat added mid-chat', async () => {
    await seatArrival(makeRepos(), CHAT, { characterId: CHOOSER, redress: true }, { source: 'participant-added', userId: 'u1' })
    expect(modesSent()).toEqual([[CHOOSER, 'llm_choose']])
  })

  it('a merge, when the merged chat has no outfit on file for them', async () => {
    await seatArrival(makeRepos(), CHAT, { characterId: CHOOSER, redress: true }, { source: 'merge', userId: 'u1', sourceChatId: SOURCE })
    expect(modesSent()).toEqual([[CHOOSER, 'llm_choose']])
  })

  it('a merge carries the merged chat\'s outfit forward when there is one', async () => {
    await seatArrival(makeRepos({ sourceOutfitFor: [CHOOSER] }), CHAT, { characterId: CHOOSER, redress: true }, { source: 'merge', userId: 'u1', sourceChatId: SOURCE })
    expect(modesSent()).toEqual([[CHOOSER, 'previous_chat']])
  })

  it('an explicit choice wins', async () => {
    await seatArrival(makeRepos(), CHAT, {
      characterId: CHOOSER,
      outfitSelection: { characterId: CHOOSER, mode: 'none' },
      redress: true,
    }, { source: 'participant-added', userId: 'u1' })
    expect(modesSent()).toEqual([[CHOOSER, 'none']])
  })
})

describe('every arrival is announced and drawn', () => {
  beforeEach(() => jest.clearAllMocks())

  it('a join with avatar generation on: one opening-outfit whisper, one avatar refresh', async () => {
    await seatArrival(makeRepos({ avatarGenerationEnabled: true }), CHAT, { characterId: PLAIN, redress: true }, { source: 'participant-added', userId: 'u1' })
    expect(postOpeningOutfitWhisper).toHaveBeenCalledTimes(1)
    expect(postOpeningOutfitWhisper).toHaveBeenCalledWith(expect.objectContaining({ chatId: CHAT, characterName: 'Jeeves' }))
    expect(enqueueCharacterAvatarGeneration).toHaveBeenCalledTimes(1)
    expect(postHostAddAnnouncement).toHaveBeenCalledTimes(1)
  })

  it('a join with avatar generation off: the whisper alone', async () => {
    await seatArrival(makeRepos({ avatarGenerationEnabled: false }), CHAT, { characterId: PLAIN, redress: true }, { source: 'participant-added', userId: 'u1' })
    expect(postOpeningOutfitWhisper).toHaveBeenCalledTimes(1)
    expect(enqueueCharacterAvatarGeneration).not.toHaveBeenCalled()
  })

  it('runs the steps in the one order: outfit, inventory, then the announcements', async () => {
    await seatArrival(makeRepos(), CHAT, { characterId: PLAIN, redress: true }, { source: 'merge', userId: 'u1' })
    const order = [
      (applyOutfitSelections as jest.Mock).mock.invocationCallOrder[0],
      (applyInventoryDefaults as jest.Mock).mock.invocationCallOrder[0],
      (postHostAddAnnouncement as jest.Mock).mock.invocationCallOrder[0],
      (postOpeningOutfitWhisper as jest.Mock).mock.invocationCallOrder[0],
    ]
    expect([...order].sort((a, b) => a - b)).toEqual(order)
  })

  it('a seat already dressed keeps its outfit unless asked to change', async () => {
    const repos = makeRepos() as unknown as { chats: { findById: jest.Mock } }
    const dressed = { ...(await repos.chats.findById(CHAT)), equippedOutfit: { [PLAIN]: { top: ['shirt-1'] } } }
    repos.chats.findById.mockImplementation(async (id: string) => (id === CHAT ? dressed : null))
    await seatArrival(repos as never, CHAT, { characterId: PLAIN }, { source: 'participant-added', userId: 'u1' })
    expect(applyOutfitSelections).not.toHaveBeenCalled()
    expect(postOpeningOutfitWhisper).toHaveBeenCalledTimes(1)
  })

  it('at a chat\'s opening, the Host introduces the cast only when there is more than one LLM seat', async () => {
    await seatArrivals(makeRepos(), CHAT, [{ characterId: CHOOSER }, { characterId: PLAIN }], { source: 'chat-start', userId: 'u1' })
    expect(postHostAddAnnouncement).toHaveBeenCalledTimes(2)
    // Every Host welcome lands before the first Aurora whisper, as a new chat's transcript always has.
    const lastWelcome = Math.max(...(postHostAddAnnouncement as jest.Mock).mock.invocationCallOrder)
    const firstWhisper = Math.min(...(postOpeningOutfitWhisper as jest.Mock).mock.invocationCallOrder)
    expect(lastWelcome).toBeLessThan(firstWhisper)
  })
})
