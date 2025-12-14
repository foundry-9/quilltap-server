/**
 * Mock for @anthropic-ai/sdk
 * Used in unit tests to avoid loading the actual Anthropic SDK module
 */

const mockMessagesCreate = jest.fn()
const mockMessagesStream = jest.fn()

export class Anthropic {
  apiKey: string

  constructor(config?: { apiKey?: string }) {
    this.apiKey = config?.apiKey || ''
  }

  messages = {
    create: mockMessagesCreate,
    stream: mockMessagesStream,
  }
}

export default Anthropic
