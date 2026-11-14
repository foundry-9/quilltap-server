/**
 * The character prompt and scenario routes (refactor-character-repository-and-vault.md
 * Phase 3 — these had no tests).
 *
 * They are thin: validate, check the character exists, call the repository's
 * per-item operation, publish the `characters` realtime topic so a second tab
 * refetches. These tests pin that wiring, and that a scenario's description
 * and archived flag reach the repository.
 */

const mockCtx: any = { user: { id: 'user-1' }, repos: {} }

jest.mock('@/lib/api/middleware', () => ({
  createContextParamsHandler: (handler: (req: any, ctx: any, params: any) => Promise<any>) =>
    async (req: any, routeCtx: any) => handler(req, mockCtx, await routeCtx.params),
  exists: (entity: unknown) => entity != null,
}))

jest.mock('@/lib/api/responses', () => ({
  successResponse: (data: any) => ({ status: 200, data }),
  created: (data: any) => ({ status: 201, data }),
  notFound: (what: string) => ({ status: 404, what }),
  badRequest: (msg: string) => ({ status: 400, msg }),
  serverError: (msg: string) => ({ status: 500, msg }),
}))

jest.mock('@/lib/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}))

const publishRealtime = jest.fn()
jest.mock('@/lib/realtime/bus', () => ({ publishRealtime: (...args: unknown[]) => publishRealtime(...args) }))

import { POST as postPrompt, GET as getPrompts } from '@/app/api/v1/characters/[id]/prompts/route'
import { PUT as putPrompt, DELETE as deletePrompt } from '@/app/api/v1/characters/[id]/prompts/[promptId]/route'
import { POST as postScenario, PUT as putScenario, DELETE as deleteScenario } from '@/app/api/v1/characters/[id]/scenarios/route'

const CHAR = 'char-1'
const PROMPT_ID = '11111111-1111-4111-8111-111111111111'
const SCENARIO_ID = '22222222-2222-4222-8222-222222222222'
const params = (extra: Record<string, string> = {}) => ({ params: Promise.resolve({ id: CHAR, ...extra }) })
const req = (body?: unknown, url = 'https://x.test/') => ({ url, json: jest.fn().mockResolvedValue(body) }) as any

beforeEach(() => {
  jest.clearAllMocks()
  const prompt = { id: PROMPT_ID, name: 'Formal', content: 'x', isDefault: true, createdAt: 'n', updatedAt: 'n' }
  mockCtx.repos = {
    characters: {
      findByIdRaw: jest.fn().mockResolvedValue({ id: CHAR, defaultScenarioId: SCENARIO_ID }),
      findById: jest.fn().mockResolvedValue({ id: CHAR, systemPrompts: [prompt], scenarios: [] }),
      addSystemPrompt: jest.fn().mockResolvedValue(prompt),
      updateSystemPrompt: jest.fn().mockResolvedValue(prompt),
      deleteSystemPrompt: jest.fn().mockResolvedValue(true),
      addScenario: jest.fn().mockResolvedValue({ id: SCENARIO_ID, title: 'Harbour', content: 'Fog.' }),
      updateScenario: jest.fn().mockResolvedValue({ id: SCENARIO_ID, title: 'Harbour', content: 'Fog.' }),
      removeScenario: jest.fn().mockResolvedValue(true),
      update: jest.fn().mockResolvedValue({}),
    },
  }
})

describe('prompts', () => {
  it('POST adds through the repository, returns its prompt, and publishes', async () => {
    const res = await postPrompt(req({ name: 'Formal', content: 'x' }), params())
    expect(res.status).toBe(201)
    expect(res.data.prompt.id).toBe(PROMPT_ID)
    expect(mockCtx.repos.characters.addSystemPrompt).toHaveBeenCalledWith(CHAR, { name: 'Formal', content: 'x', isDefault: false })
    expect(publishRealtime).toHaveBeenCalledWith('characters', CHAR)
  })

  it('POST 404s a missing character without writing', async () => {
    mockCtx.repos.characters.findByIdRaw.mockResolvedValue(null)
    const res = await postPrompt(req({ name: 'Formal', content: 'x' }), params())
    expect(res.status).toBe(404)
    expect(mockCtx.repos.characters.addSystemPrompt).not.toHaveBeenCalled()
  })

  it('GET lists the hydrated prompts', async () => {
    const res = await getPrompts(req(), params())
    expect(res.data.prompts.map((p: { id: string }) => p.id)).toEqual([PROMPT_ID])
  })

  it('PUT and DELETE go to the per-item operations and publish', async () => {
    await putPrompt(req({ name: 'Ceremonial' }), params({ promptId: PROMPT_ID }))
    expect(mockCtx.repos.characters.updateSystemPrompt).toHaveBeenCalledWith(CHAR, PROMPT_ID, { name: 'Ceremonial' })
    await deletePrompt(req(), params({ promptId: PROMPT_ID }))
    expect(mockCtx.repos.characters.deleteSystemPrompt).toHaveBeenCalledWith(CHAR, PROMPT_ID)
    expect(publishRealtime).toHaveBeenCalledTimes(2)
  })
})

describe('scenarios', () => {
  it('POST carries description and archived to the repository', async () => {
    const res = await postScenario(req({ title: 'Harbour', content: 'Fog.', description: 'The first', archived: true }), params())
    expect(res.status).toBe(201)
    expect(mockCtx.repos.characters.addScenario).toHaveBeenCalledWith(CHAR, {
      title: 'Harbour', content: 'Fog.', description: 'The first', archived: true,
    })
    expect(publishRealtime).toHaveBeenCalledWith('characters', CHAR)
  })

  it('PUT updates by scenarioId and requires it', async () => {
    const missing = await putScenario(req({ title: 'X' }), params())
    expect(missing.status).toBe(400)
    await putScenario(req({ archived: true }, `https://x.test/?scenarioId=${SCENARIO_ID}`), params())
    expect(mockCtx.repos.characters.updateScenario).toHaveBeenCalledWith(CHAR, SCENARIO_ID, { archived: true })
  })

  it('DELETE clears the default scenario column with its scenario', async () => {
    await deleteScenario(req(undefined, `https://x.test/?scenarioId=${SCENARIO_ID}`), params())
    expect(mockCtx.repos.characters.removeScenario).toHaveBeenCalledWith(CHAR, SCENARIO_ID)
    expect(mockCtx.repos.characters.update).toHaveBeenCalledWith(CHAR, { defaultScenarioId: null })
  })
})
