/**
 * The scene tracker reads prose only, so it must report each character's
 * action as a telling attributed to whoever told it — never as accomplished
 * fact. A narrated "she puts the candle away" without the tool call was being
 * handed back to the character as present truth by `## Current State`.
 *
 * Strategy: mock `./core-execution` and read the system prompt of each branch.
 */

jest.mock('@/lib/logger', () => {
  const makeLogger = (): unknown => ({
    debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(),
    child: jest.fn(() => makeLogger()),
  })
  return { logger: makeLogger() }
})

jest.mock('@/lib/memory/cheap-llm-tasks/core-execution', () => ({
  executeCheapLLMTask: jest.fn(),
}))

const { updateSceneState, SCENE_ACTION_RULE } = require('@/lib/memory/cheap-llm-tasks/image-scene-tasks')
const { executeCheapLLMTask } = require('@/lib/memory/cheap-llm-tasks/core-execution')

const mockExecute = executeCheapLLMTask as jest.Mock
const SELECTION = { provider: 'openai', modelName: 'm', connectionProfileId: 'p1', isLocal: false }

function input(previousSceneState: unknown) {
  return {
    previousSceneState,
    characters: [{ characterId: 'c1', characterName: 'Riya', physicalDescription: 'A woman', clothingDescription: 'Jeans' }],
    recentMessages: [{ role: 'assistant', content: 'She puts the candle away in the drawer.' }],
    messageCount: 4,
  }
}

function systemPrompt(): string {
  return mockExecute.mock.calls[0][1][0].content as string
}

beforeEach(() => {
  mockExecute.mockReset()
  mockExecute.mockResolvedValue({ success: true, result: {} })
})

describe('scene tracker action rule', () => {
  it('asks for an attributed telling on the first turn', async () => {
    await updateSceneState(input(null), SELECTION, 'user-1')
    expect(systemPrompt()).toContain(SCENE_ACTION_RULE)
    expect(systemPrompt()).not.toContain('${SCENE_ACTION_RULE}')
  })

  it('asks for an attributed telling on updates, and rewrites carried-forward facts', async () => {
    const prev = { location: 'Study', characters: [{ characterId: 'c1', characterName: 'Riya', action: 'Has put the candle away.' }] }
    await updateSceneState(input(prev), SELECTION, 'user-1')
    expect(systemPrompt()).toContain(SCENE_ACTION_RULE)
    expect(systemPrompt()).toMatch(/carried forward from the previous state that is phrased as fact must be rewritten as a telling/)
  })

  it('names no real-looking character in its examples', () => {
    expect(SCENE_ACTION_RULE).toMatch(/never as accomplished fact/)
    expect(SCENE_ACTION_RULE).toContain('<name> says')
    expect(SCENE_ACTION_RULE).not.toMatch(/Riya|Lorian|Charlie/)
  })
})
