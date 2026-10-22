/**
 * Operator intervention — the hold (spec Part 2): the registry, and the run
 * service holding an intervenable run between the deal and the effects.
 *
 * The execution core and the registry stay real; the cascade, the applier and
 * the writer are mocked so what was applied and posted can be observed.
 */

jest.mock('@/lib/logger', () => {
  const makeLogger = (): any => ({
    debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(),
    child: jest.fn(() => makeLogger()),
  })
  return { logger: makeLogger() }
})

jest.mock('@/lib/repositories/factory')
jest.mock('@/lib/realtime/bus', () => ({ publishRealtime: jest.fn() }))
jest.mock('@/lib/state/state-cascade', () => ({ resolveStateCascade: jest.fn() }))
jest.mock('@/lib/pascal/side-effects', () => ({ applyCustomToolEffects: jest.fn() }))
jest.mock('@/lib/services/pascal/writer', () => ({
  buildPascalResultContent: jest.fn(({ toolTitle, message }: any) => ({
    content: `${toolTitle} — ${message}`,
    opaqueContent: `${toolTitle} — ${message}`,
  })),
  postPascalResult: jest.fn(),
}))

import { runCustomTool, type RunCustomToolParams } from '@/lib/pascal/run-service'
import { QtapCustomToolSchema } from '@/lib/pascal/custom-tool.types'
import type { DiscoveredCustomTool } from '@/lib/pascal/custom-tools'
import {
  hold,
  interventionStatus,
  listInterventions,
  resetInterventionRegistryForTests,
  settleIntervention,
  type PendingIntervention,
} from '@/lib/pascal/intervention/registry'
import { recomputeRun } from '@/lib/pascal/intervention/recompute'
import { runWithTurnControl, stopActiveTurns } from '@/lib/chat/turn-control'
import { publishRealtime } from '@/lib/realtime/bus'
import { resolveStateCascade } from '@/lib/state/state-cascade'
import { applyCustomToolEffects } from '@/lib/pascal/side-effects'
import { postPascalResult } from '@/lib/services/pascal/writer'

const getRepositoriesMock = jest.requireMock('@/lib/repositories/factory').getRepositories as jest.Mock
const publishMock = publishRealtime as jest.Mock
const applyMock = applyCustomToolEffects as jest.Mock
const postMock = postPascalResult as jest.Mock

const CHAT_ID = 'chat-1'

const DEFINITION = QtapCustomToolSchema.parse({
  name: 'pick',
  description: 'Pick the lock.',
  intervention: { enabled: true },
  roll: { min: 0.2, max: 0.2 },
  outcomes: [
    { when: { gte: 0.5 }, message: 'It opens.', state: 'success' },
    { when: true, message: 'Still locked.', state: 'failure' },
  ],
  effects: [{ target: 'state.tries', value: 1 }],
})

const entryOf = (definition = DEFINITION): DiscoveredCustomTool =>
  ({ definition, tier: 'project', mountPointId: 'mp-1', mountName: 'Store', definitionPath: 'Tools/pick.tool.json' }) as DiscoveredCustomTool

function params(overrides: Partial<RunCustomToolParams> = {}): RunCustomToolParams {
  return {
    userId: 'user-1',
    chatId: CHAT_ID,
    chat: { id: CHAT_ID, chatType: 'salon' } as never,
    entry: entryOf(),
    parameters: null,
    private: undefined,
    characterId: null,
    metadata: {},
    whisperTargetIds: null,
    invokedBy: 'llm',
    mayHold: true,
    callerParticipantId: null,
    ...overrides,
  }
}

let settings: Record<string, unknown>

/** Wait until the run is held, and return it. */
async function heldRun(): Promise<PendingIntervention> {
  for (let i = 0; i < 50; i++) {
    const [pending] = listInterventions(CHAT_ID)
    if (pending) return pending
    await new Promise((resolve) => setImmediate(resolve))
  }
  throw new Error('the run was never held')
}

beforeEach(() => {
  jest.clearAllMocks()
  resetInterventionRegistryForTests()
  settings = { customTools: true, customToolIntervention: true }
  getRepositoriesMock.mockReturnValue({
    chatSettings: { findByUserId: jest.fn(async () => settings) },
    chats: { findById: jest.fn(async () => ({ id: CHAT_ID, chatType: 'salon' })) },
  })
  ;(resolveStateCascade as jest.Mock).mockResolvedValue({ merged: {}, chatState: {}, projectState: {}, groupState: {}, generalState: {} })
  applyMock.mockResolvedValue([{ target: 'state.tries', next: 1, tier: 'chat' }])
  postMock.mockResolvedValue({ id: 'pascal-msg' })
})

afterEach(() => {
  delete process.env.QUILLTAP_JOB_CHILD
})

describe('the registry', () => {
  const pendingOf = (): Omit<PendingIntervention, 'id' | 'createdAt'> => ({
    chatId: CHAT_ID,
    userId: 'user-1',
    entrance: 'llm',
    characterId: null,
    characterName: null,
    definition: DEFINITION,
    definitionTier: 'project',
    definitionMountId: 'mp-1',
    snapshot: { params: null, private: undefined, metadata: {}, progress: {}, now: 0, character: null, state: {}, inventory: null },
    draw: { form: 'range', unit: 0 },
    baseline: {} as never,
    consults: [],
  })

  it('resolves first-wins and forgets the hold on settle', async () => {
    const { id, decision } = hold(pendingOf())
    expect(listInterventions(CHAT_ID)).toHaveLength(1)
    expect(settleIntervention(id, { kind: 'as-rolled' })).toBe('resolved')
    expect(settleIntervention(id, { kind: 'veto', cause: 'dialog' })).toBe('settled')
    await expect(decision).resolves.toEqual({ kind: 'as-rolled' })
    expect(listInterventions(CHAT_ID)).toHaveLength(0)
    expect(interventionStatus(id)).toBe('settled')
    expect(interventionStatus('nope')).toBe('unknown')
  })

  it('publishes the topic on add and on removal', () => {
    const { id } = hold(pendingOf())
    expect(publishMock).toHaveBeenCalledWith('customToolInterventions', CHAT_ID)
    publishMock.mockClear()
    settleIntervention(id, { kind: 'as-rolled' })
    expect(publishMock).toHaveBeenCalledWith('customToolInterventions', CHAT_ID)
  })

  it('resolves as a veto when the turn is stopped', async () => {
    const controller = new AbortController()
    const { decision } = hold(pendingOf(), { signal: controller.signal })
    controller.abort()
    await expect(decision).resolves.toEqual({ kind: 'veto', cause: 'stop' })
    expect(listInterventions(CHAT_ID)).toHaveLength(0)
  })
})

describe('runCustomTool — when a run is not held', () => {
  const cases: Array<[string, () => Partial<RunCustomToolParams>]> = [
    ['the popup (mayHold false)', () => ({ mayHold: false })],
    ['an autonomous room', () => ({ chat: { id: CHAT_ID, chatType: 'autonomous' } as never })],
    ['a definition that is not intervenable', () => ({ entry: entryOf(QtapCustomToolSchema.parse({ ...DEFINITION, intervention: { enabled: false } })) })],
    ['the setting switched off', () => { settings = { customTools: true, customToolIntervention: false }; return {} }],
    ['custom tools switched off', () => { settings = { customTools: false, customToolIntervention: true }; return {} }],
    ['the job child', () => { process.env.QUILLTAP_JOB_CHILD = '1'; return {} }],
  ]

  it.each(cases)('%s goes ahead as rolled', async (_label, setUp) => {
    const outcome = await runCustomTool(params(setUp()))
    expect(outcome.ok).toBe(true)
    expect(listInterventions(CHAT_ID)).toHaveLength(0)
    expect(postMock.mock.calls[0][0].pascalMeta.intervention).toBeUndefined()
  })
})

describe('runCustomTool — a held run', () => {
  it('posts nothing and applies nothing until the operator answers', async () => {
    const running = runCustomTool(params())
    const pending = await heldRun()
    expect(applyMock).not.toHaveBeenCalled()
    expect(postMock).not.toHaveBeenCalled()
    settleIntervention(pending.id, { kind: 'as-rolled' })
    await running
    expect(applyMock).toHaveBeenCalled()
    expect(postMock).toHaveBeenCalled()
  })

  it('deals the operator\'s run and records what changed', async () => {
    const running = runCustomTool(params())
    const pending = await heldRun()
    const overrides = { outcomeIndex: 0 }
    const run = await recomputeRun({ definition: pending.definition, snapshot: pending.snapshot, draw: pending.draw, overrides })
    settleIntervention(pending.id, { kind: 'deal', overrides, run, reasks: 0 })
    const outcome = await running
    expect(outcome.ok).toBe(true)
    const meta = postMock.mock.calls[0][0].pascalMeta
    expect(meta.state).toBe('success')
    expect(meta.outcomeIndex).toBe(0)
    expect(meta.intervention).toMatchObject({ decision: 'deal', dealt: { outcomeIndex: 1, state: 'failure', message: 'Still locked.' } })
    expect(meta.intervention.changed).toEqual(expect.arrayContaining(['outcome', 'state', 'message']))
    expect(postMock.mock.calls[0][0].content).toContain('It opens.')
  })

  it('records nothing for an as-rolled decision', async () => {
    const running = runCustomTool(params())
    settleIntervention((await heldRun()).id, { kind: 'as-rolled' })
    await running
    expect(postMock.mock.calls[0][0].pascalMeta.intervention).toBeUndefined()
  })

  it('records nothing for a deal that changed nothing', async () => {
    const running = runCustomTool(params())
    const pending = await heldRun()
    const run = await recomputeRun({ definition: pending.definition, snapshot: pending.snapshot, draw: pending.draw, overrides: {} })
    settleIntervention(pending.id, { kind: 'deal', overrides: {}, run, reasks: 0 })
    await running
    expect(postMock.mock.calls[0][0].pascalMeta.intervention).toBeUndefined()
  })

  it('a veto posts nothing and applies no effects', async () => {
    const running = runCustomTool(params())
    settleIntervention((await heldRun()).id, { kind: 'veto', cause: 'dialog' })
    await expect(running).resolves.toEqual({ ok: 'vetoed' })
    expect(applyMock).not.toHaveBeenCalled()
    expect(postMock).not.toHaveBeenCalled()
  })

  it('Stop resolves the hold as a veto', async () => {
    let outcome: unknown
    const turn = runWithTurnControl(CHAT_ID, async () => {
      outcome = await runCustomTool(params())
    })
    await heldRun()
    await stopActiveTurns(CHAT_ID)
    await turn
    expect(outcome).toEqual({ ok: 'vetoed' })
    expect(postMock).not.toHaveBeenCalled()
  })
})
