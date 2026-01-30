/**
 * Mock for @openrouter/sdk v0.4.0
 * Used in unit tests to avoid loading the actual ESM module
 */

const mockChatSend = jest.fn()
const mockModelsList = jest.fn()

// Mock for callModel() which returns a ModelResult with streaming methods
const mockGetTextStream = jest.fn().mockImplementation(async function* () {
  yield 'Hello'
  yield ' World'
})

const mockGetResponse = jest.fn().mockResolvedValue({
  status: 'completed',
  output: [
    { type: 'message', content: [{ type: 'output_text', text: 'Hello World' }] },
  ],
  usage: {
    inputTokens: 10,
    outputTokens: 5,
  },
})

const mockGetToolCalls = jest.fn().mockResolvedValue([])

const mockCallModel = jest.fn().mockReturnValue({
  getTextStream: mockGetTextStream,
  getResponse: mockGetResponse,
  getToolCalls: mockGetToolCalls,
  getText: jest.fn().mockResolvedValue('Hello World'),
  getItemsStream: jest.fn().mockImplementation(async function* () {}),
  getReasoningStream: jest.fn().mockImplementation(async function* () {}),
  getToolCallsStream: jest.fn().mockImplementation(async function* () {}),
  cancel: jest.fn().mockResolvedValue(undefined),
})

export const OpenRouter = jest.fn().mockImplementation(() => ({
  chat: {
    send: mockChatSend,
  },
  models: {
    list: mockModelsList,
  },
  callModel: mockCallModel,
}))

// Mock fromChatMessages helper
export const fromChatMessages = jest.fn().mockImplementation((messages: any[]) => {
  // Convert chat messages to OpenResponses input format (simplified mock)
  return messages.map(m => ({
    type: m.role === 'system' ? 'system' : m.role === 'user' ? 'message' : 'message',
    role: m.role,
    content: typeof m.content === 'string' ? [{ type: 'input_text', text: m.content }] : m.content,
  }))
})

// Export mock references for test assertions
export const __mocks__ = {
  mockChatSend,
  mockModelsList,
  mockCallModel,
  mockGetTextStream,
  mockGetResponse,
  mockGetToolCalls,
}

export default OpenRouter
