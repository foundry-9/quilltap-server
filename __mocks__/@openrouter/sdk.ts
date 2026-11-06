/**
 * Mock for @openrouter/sdk (1.5.x), mapped in jest.config.ts.
 *
 * The OpenRouter plugin uses the SDK only for its generated OpenAPI surface:
 * `chat.send` (text-only non-streaming sends), `models.list` and
 * `embeddings.*`. Streaming and image sends go through a direct fetch, so
 * there is nothing else to mock. Used to avoid loading the real ESM module.
 */

const mockChatSend = jest.fn()
const mockModelsList = jest.fn()
const mockEmbeddingsGenerate = jest.fn()
const mockEmbeddingsListModels = jest.fn()

export const OpenRouter = jest.fn().mockImplementation(() => ({
  chat: {
    send: mockChatSend,
  },
  models: {
    list: mockModelsList,
  },
  embeddings: {
    generate: mockEmbeddingsGenerate,
    listModels: mockEmbeddingsListModels,
  },
}))

// Export mock references for test assertions
export const __mocks__ = {
  mockChatSend,
  mockModelsList,
  mockEmbeddingsGenerate,
  mockEmbeddingsListModels,
}

export default OpenRouter
