import { describe, it, expect, jest, beforeEach } from '@jest/globals'
import { generateGreetingMessage } from '@/lib/chat/initial-greeting'
import { createLLMProvider } from '@/lib/llm'
import type { LLMProvider } from '@/lib/llm/base'

jest.mock('@/lib/llm/plugin-factory')

const mockCreateProvider = jest.mocked(createLLMProvider)

type GreetingChunk = {
  content?: string
  done?: boolean
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number }
}

function mockStream(chunks: GreetingChunk[]): AsyncGenerator<any> {
  async function* gen() {
    for (const chunk of chunks) {
      yield {
        content: chunk.content ?? '',
        done: chunk.done ?? false,
        usage: chunk.usage,
      }
    }
  }
  return gen()
}

const mockProvider = {
  supportsFileAttachments: false,
  supportedMimeTypes: [],
  supportsImageGeneration: false,
  sendMessage: jest.fn(),
  streamMessage: jest.fn(),
  validateApiKey: jest.fn(),
  getAvailableModels: jest.fn(),
  generateImage: jest.fn(),
} as unknown as jest.Mocked<LLMProvider>

describe('generateGreetingMessage', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockProvider.streamMessage.mockImplementation(() =>
      mockStream([
        { content: ' Hi ' },
        { content: 'there! ', done: true, usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } },
      ])
    )
    mockCreateProvider.mockReturnValue(mockProvider)
  })

  it('requests a greeting from the provider and trims the concatenated chunks', async () => {
    const result = await generateGreetingMessage({
      systemPrompt: 'System instructions',
      characterName: 'Avery',
      provider: 'OPENAI',
      modelName: 'gpt-test',
      apiKey: 'api-key',
      temperature: 0.5,
      maxTokens: 120,
      topP: 0.9,
    })

    expect(result.content).toBe('Hi there!')
    expect(result.contentFilterDetected).toBe(false)
    expect(mockCreateProvider).toHaveBeenCalledWith('OPENAI', undefined)

    const call = mockProvider.streamMessage.mock.calls[0] as [any, string]
    const payload = call[0] as {
      model: string
      temperature?: number
      maxTokens?: number
      topP?: number
      messages: Array<{ role: string; content: string }>
    }

    expect(payload.model).toBe('gpt-test')
    expect(payload.temperature).toBe(0.5)
    expect(payload.maxTokens).toBe(120)
    expect(payload.topP).toBe(0.9)
    expect(payload.messages[0].role).toBe('system')
    expect(payload.messages[0].content).toContain('brand new conversation')
    expect(payload.messages[1].content).toContain('Greet the user')

    expect(call[1]).toBe('api-key')
  })

  it('leaves maxTokens undefined when caller omits it', async () => {
    mockProvider.streamMessage.mockImplementationOnce(() =>
      mockStream([
        { content: 'Hello there', done: true, usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } },
      ])
    )

    const result = await generateGreetingMessage({
      systemPrompt: 'System instructions',
      characterName: 'Rin',
      provider: 'OLLAMA',
      modelName: 'llama3',
      baseUrl: 'http://localhost:11434',
    })

    const call = mockProvider.streamMessage.mock.calls[0] as [any, string]
    const payload = call[0] as { maxTokens?: number }

    expect(payload.maxTokens).toBeUndefined()
    expect(call[1]).toBe('')
    expect(result.content).toBe('Hello there')
    expect(result.contentFilterDetected).toBe(false)
  })

  it('detects content filter when tokens consumed but streamed content is empty', async () => {
    mockProvider.streamMessage.mockImplementationOnce(() =>
      mockStream([
        { content: '', done: true, usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 } },
      ])
    )

    const result = await generateGreetingMessage({
      systemPrompt: 'System instructions',
      characterName: 'Friday',
      provider: 'OPENROUTER',
      modelName: 'some-model',
      apiKey: 'key',
    })

    expect(result.content).toBe('')
    expect(result.contentFilterDetected).toBe(true)
  })

  it('does not flag content filter when no completion tokens were consumed', async () => {
    mockProvider.streamMessage.mockImplementationOnce(() =>
      mockStream([
        { content: '', done: true, usage: { promptTokens: 100, completionTokens: 0, totalTokens: 100 } },
      ])
    )

    const result = await generateGreetingMessage({
      systemPrompt: 'System instructions',
      characterName: 'Friday',
      provider: 'OPENROUTER',
      modelName: 'some-model',
      apiKey: 'key',
    })

    expect(result.content).toBe('')
    expect(result.contentFilterDetected).toBe(false)
  })

  // ====================================================================
  // Regression: content filter / uncensored fallback
  // ====================================================================

  describe('content filter detection regression', () => {
    it('returns a result (does not throw) when content filter is detected', async () => {
      mockProvider.streamMessage.mockImplementationOnce(() =>
        mockStream([
          { content: '', done: true, usage: { promptTokens: 200, completionTokens: 30, totalTokens: 230 } },
        ])
      )

      // Must not throw — the caller uses the flag to decide fallback behavior
      const result = await generateGreetingMessage({
        systemPrompt: 'System instructions',
        characterName: 'Dangerous Dan',
        provider: 'OPENAI',
        modelName: 'gpt-4',
        apiKey: 'key',
      })

      expect(result).toBeDefined()
      expect(result.content).toBe('')
      expect(result.contentFilterDetected).toBe(true)
    })

    it('detects content filter when streamed content is whitespace-only but tokens were consumed', async () => {
      mockProvider.streamMessage.mockImplementationOnce(() =>
        mockStream([
          { content: '   \n\t  ', done: true, usage: { promptTokens: 150, completionTokens: 10, totalTokens: 160 } },
        ])
      )

      const result = await generateGreetingMessage({
        systemPrompt: 'System instructions',
        characterName: 'Edgy Character',
        provider: 'OPENROUTER',
        modelName: 'some-model',
        apiKey: 'key',
      })

      // After trimming, content is empty, and completionTokens > 0 → filter detected
      expect(result.content).toBe('')
      expect(result.contentFilterDetected).toBe(true)
    })

    it('allows caller to use contentFilterDetected to trigger fallback', async () => {
      mockProvider.streamMessage.mockImplementationOnce(() =>
        mockStream([
          { content: '', done: true, usage: { promptTokens: 100, completionTokens: 42, totalTokens: 142 } },
        ])
      )

      const result = await generateGreetingMessage({
        systemPrompt: 'System instructions',
        characterName: 'Blocked Character',
        provider: 'OPENAI',
        modelName: 'gpt-4',
        apiKey: 'key',
      })

      // Simulate caller fallback logic
      let greeting: string
      if (result.contentFilterDetected) {
        greeting = `*${result.content || 'The character appears, ready to speak.'}*`
      } else {
        greeting = result.content
      }

      expect(result.contentFilterDetected).toBe(true)
      expect(greeting).toBe('*The character appears, ready to speak.*')
    })

    it('does not flag content filter when stream has actual content even with tokens consumed', async () => {
      mockProvider.streamMessage.mockImplementationOnce(() =>
        mockStream([
          { content: 'Greetings, ' },
          { content: 'traveler.', done: true, usage: { promptTokens: 100, completionTokens: 5, totalTokens: 105 } },
        ])
      )

      const result = await generateGreetingMessage({
        systemPrompt: 'System instructions',
        characterName: 'Normal Character',
        provider: 'OPENAI',
        modelName: 'gpt-4',
        apiKey: 'key',
      })

      expect(result.content).toBe('Greetings, traveler.')
      expect(result.contentFilterDetected).toBe(false)
    })

    it('does not flag content filter when usage data is missing', async () => {
      mockProvider.streamMessage.mockImplementationOnce(() =>
        mockStream([
          { content: '', done: true },
        ])
      )

      const result = await generateGreetingMessage({
        systemPrompt: 'System instructions',
        characterName: 'Unknown Character',
        provider: 'OLLAMA',
        modelName: 'llama3',
      })

      // No usage data → can't confirm tokens were consumed → not a content filter
      expect(result.content).toBe('')
      expect(result.contentFilterDetected).toBe(false)
    })
  })
})
