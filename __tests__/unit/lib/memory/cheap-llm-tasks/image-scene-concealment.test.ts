/**
 * The story-background crafter and the Concierge's appearance pass must agree
 * on what happens to an undressed character bound for a moderated provider.
 *
 * The appearance pass used to re-dress them ("wearing nothing" → "casual
 * clothes") before the crafter — whose concealed guidance forbids exactly that
 * substitution — ever saw them. In `conceal` mode it now keeps the state and
 * reports `undressed`; the crafter's concealed guidance names the marker the
 * handler appends for it. The candid (uncensored) guidance has no marker to
 * honour, because the sanitizer never runs for a scene bound there.
 *
 * Strategy: mock `./core-execution` and read the messages / drive the parser.
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

const {
  CONCEALMENT_MARKER,
  craftStoryBackgroundPrompt,
  sanitizeAppearance,
} = require('@/lib/memory/cheap-llm-tasks/image-scene-tasks')
const { executeCheapLLMTask } = require('@/lib/memory/cheap-llm-tasks/core-execution')

const mockExecute = executeCheapLLMTask as jest.Mock

const SELECTION = { provider: 'openai', modelName: 'm', connectionProfileId: 'p1', isLocal: false }
const INPUT = [{ characterId: 'char-1', appearanceText: 'A woman. Wearing nothing' }]

beforeEach(() => {
  mockExecute.mockReset()
  mockExecute.mockResolvedValue({ success: true, result: 'ok' })
})

function systemPrompt(): string {
  return mockExecute.mock.calls[0][1][0].content as string
}

function parser(): (content: string) => unknown {
  return mockExecute.mock.calls[0][3]
}

describe('story-background crafter concealment guidance', () => {
  const context = {
    sceneContext: 'the morning after',
    characters: [{ name: 'Amy', description: 'A woman' }],
    provider: 'openai',
  }

  it('names the concealment marker and a per-character rule when bound for a moderated provider', async () => {
    await craftStoryBackgroundPrompt({ ...context, uncensoredImageTarget: false }, SELECTION, 'user-1')

    expect(systemPrompt()).toContain('PER-CHARACTER REQUIREMENT')
    expect(systemPrompt()).toContain(CONCEALMENT_MARKER)
  })

  it('carries neither when bound for an uncensored provider', async () => {
    await craftStoryBackgroundPrompt({ ...context, uncensoredImageTarget: true }, SELECTION, 'user-1')

    expect(systemPrompt()).not.toContain('PER-CHARACTER REQUIREMENT')
    expect(systemPrompt()).not.toContain(CONCEALMENT_MARKER)
  })
})

describe('sanitizeAppearance modes', () => {
  it('re-dresses by default and reports no undressed flag', async () => {
    await sanitizeAppearance(INPUT, SELECTION, 'user-1')

    expect(systemPrompt()).toContain('"wearing nothing" → "wearing casual clothes"')
    expect(parser()(JSON.stringify([
      { characterId: 'char-1', appearanceText: 'A woman in casual clothes', undressed: true },
    ]))).toEqual([{ characterId: 'char-1', appearanceText: 'A woman in casual clothes' }])
  })

  it('in conceal mode forbids invented clothing and parses the undressed flag', async () => {
    await sanitizeAppearance(INPUT, SELECTION, 'user-1', 'chat-1', 'conceal')

    expect(systemPrompt()).toContain('Do NOT invent clothing')
    expect(systemPrompt()).not.toContain('wearing casual clothes')
    expect(parser()(JSON.stringify([
      { characterId: 'char-1', appearanceText: 'A woman, unclothed', undressed: true },
      { characterId: 'char-2', appearanceText: 'A man in a coat' },
    ]))).toEqual([
      { characterId: 'char-1', appearanceText: 'A woman, unclothed', undressed: true },
      { characterId: 'char-2', appearanceText: 'A man in a coat', undressed: false },
    ])
  })
})
