/**
 * Mock for openai SDK
 * Used in unit tests to avoid loading the actual OpenAI SDK module
 */

const mockChatCompletionsCreate = jest.fn()
const mockModelsList = jest.fn()
const mockImagesGenerate = jest.fn()

export class OpenAI {
  apiKey: string

  constructor(config?: { apiKey?: string }) {
    this.apiKey = config?.apiKey || ''
  }

  chat = {
    completions: {
      create: mockChatCompletionsCreate,
    },
  }

  models = {
    list: mockModelsList,
  }

  images = {
    generate: mockImagesGenerate,
  }
}

export default OpenAI
