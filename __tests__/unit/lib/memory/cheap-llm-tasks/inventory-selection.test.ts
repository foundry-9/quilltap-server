/**
 * Unit tests for `chooseLLMInventory`: the listing the model sees and the
 * parser that decides which of its picks survive. `core-execution` is mocked
 * to capture the prompt and the `parseResponse` callback.
 */

jest.mock('@/lib/logger', () => {
  const makeLogger = (): any => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), child: jest.fn(() => makeLogger()) })
  return { logger: makeLogger() }
})

jest.mock('@/lib/memory/cheap-llm-tasks/core-execution', () => ({
  executeCheapLLMTask: jest.fn(),
}))

const { chooseLLMInventory } = require('@/lib/memory/cheap-llm-tasks/inventory-selection')
const { executeCheapLLMTask } = require('@/lib/memory/cheap-llm-tasks/core-execution')

const mockExecute = executeCheapLLMTask as jest.Mock

function obj(id: string, fields: Record<string, unknown> = {}) {
  return { id, kind: 'item', name: id, title: null, description: null, equippedByDefault: false, isArchetype: false, itemIds: [], archivedAt: null, ...fields }
}

const ITEMS = [
  obj('notebook', { description: 'A battered notebook.' }),
  obj('ring', { name: 'ring', title: 'The Signet', equippedByDefault: true }),
  obj('kit', { kind: 'kit', name: 'picnic set', itemIds: ['notebook', 'elsewhere'] }),
]

async function run(items = ITEMS, extra: Record<string, unknown> = {}) {
  mockExecute.mockResolvedValue({ success: true, result: { ids: [] } })
  await chooseLLMInventory({
    characterName: 'Bertie',
    characterDescription: null,
    characterPersonality: 'cheerful',
    characterManifesto: null,
    items,
    scenarioText: 'A picnic by the river.',
    selection: { provider: 'test' },
    userId: 'user-1',
    chatId: 'chat-1',
    characterId: 'c-1',
    random: () => 0,
    ...extra,
  })
  const call = mockExecute.mock.calls.at(-1)!
  return { messages: call[1] as Array<{ role: string; content: string }>, parse: call[3] as (content: string) => { ids: string[] }, taskType: call[4] }
}

beforeEach(() => mockExecute.mockReset())

describe('chooseLLMInventory', () => {
  it('does not call the model with nothing to choose from', async () => {
    const result = await chooseLLMInventory({ characterName: 'B', characterDescription: null, characterPersonality: null, characterManifesto: null, items: [], scenarioText: null, selection: {}, userId: 'u' })
    expect(result).toEqual({ success: true, result: { ids: [] } })
    expect(mockExecute).not.toHaveBeenCalled()
  })

  it('lists each object with its markers, the scenario and what is worn', async () => {
    const { messages, taskType } = await run(ITEMS, { wearing: ['Linen suit'] })
    const user = messages[1].content
    expect(taskType).toBe('inventory-selection')
    expect(user).toContain('Scenario: A picnic by the river.')
    expect(user).toContain('Wearing: Linen suit')
    expect(user).toContain('ID: notebook | "notebook" — A battered notebook.')
    expect(user).toContain('ID: ring | "The Signet (ring)" [usually carried]')
    expect(user).toContain('[kit — "notebook", 1 other object]')
  })

  it('keeps offered ids once each, in order, and drops the rest', async () => {
    const { parse } = await run()
    expect(parse('{"carry": ["ring", "nope", "ring", 7, "notebook"]}')).toEqual({ ids: ['ring', 'notebook'] })
    expect(parse('```json\n{"carry": []}\n```')).toEqual({ ids: [] })
  })

  it('treats an answer without a carry array as a failure', async () => {
    const { parse } = await run()
    expect(() => parse('{"take": ["ring"]}')).toThrow()
    expect(() => parse('["ring"]')).toThrow()
  })
})
