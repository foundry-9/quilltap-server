/**
 * Unit tests for streaming.service.ts
 * Tests SSE encoding functions and stream utilities
 */

import {
  encodeDebugInfo,
  encodeFallbackInfo,
  encodeContentChunk,
  encodeDoneEvent,
  encodeErrorEvent,
  encodeKeepAlive,
  safeEnqueue,
  safeClose,
  createStreamingResult,
} from '@/lib/services/chat-message/streaming.service'

jest.mock('@/lib/logging/create-logger', () => ({
  createServiceLogger: jest.fn(() => ({
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  })),
  createLogger: jest.fn(() => ({
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  })),
}))

describe('streaming.service', () => {
  let encoder: TextEncoder

  beforeEach(() => {
    encoder = new TextEncoder()
  })

  describe('encodeDebugInfo', () => {
    it('should encode debug info as SSE data event', () => {
      const debugInfo = {
        builtContext: {
          tokenUsage: { total: 100, systemPrompt: 20, summary: 10, memories: 30, messages: 40 },
          budget: { totalLimit: 1000, responseReserve: 500 },
          memoriesIncluded: 5,
          messagesIncluded: 10,
          messagesTruncated: 0,
          includedSummary: false,
          debugMemories: [],
          debugSummary: null,
          debugSystemPrompt: '',
        },
        connectionProfile: {
          id: 'profile-1',
          userId: 'user-1',
          provider: 'OPENAI',
          modelName: 'gpt-4',
          apiKey: 'key',
          createdAt: '2024-01-01',
          updatedAt: '2024-01-01',
        },
        modelParams: { temperature: 0.7, maxTokens: 1000 },
        messages: [
          { role: 'USER', contentLength: 100, hasAttachments: false },
        ],
        tools: [],
      }

      const result = encodeDebugInfo(encoder, debugInfo)
      const decoded = new TextDecoder().decode(result)

      expect(decoded).toContain('data: ')
      expect(decoded).toContain('debugLLMRequest')
      expect(decoded).toContain('gpt-4')
      expect(decoded).toContain('OPENAI')
      expect(decoded).toContain('"temperature":0.7')
      expect(decoded).toMatch(/\n\n$/)
    })

    it('should include tool info when tools are present', () => {
      const debugInfo = {
        builtContext: {
          tokenUsage: { total: 100, systemPrompt: 20, summary: 10, memories: 30, messages: 40 },
          budget: { totalLimit: 1000, responseReserve: 500 },
          memoriesIncluded: 0,
          messagesIncluded: 1,
          messagesTruncated: 0,
          includedSummary: false,
          debugMemories: [],
          debugSummary: null,
          debugSystemPrompt: '',
        },
        connectionProfile: {
          id: 'profile-1',
          userId: 'user-1',
          provider: 'OPENAI',
          modelName: 'gpt-4',
          apiKey: 'key',
          createdAt: '2024-01-01',
          updatedAt: '2024-01-01',
        },
        modelParams: {},
        messages: [],
        tools: [{ name: 'search_web' }, { name: 'generate_image' }],
      }

      const result = encodeDebugInfo(encoder, debugInfo)
      const decoded = new TextDecoder().decode(result)

      expect(decoded).toContain('hasTools')
      expect(decoded).toContain('search_web')
      expect(decoded).toContain('generate_image')
    })
  })

  describe('encodeFallbackInfo', () => {
    it('should encode fallback results as SSE data event', () => {
      const fallbackResults = [
        {
          type: 'text' as const,
          content: 'File content here',
          processingMetadata: {
            originalFilename: 'document.pdf',
            usedImageDescriptionLLM: false,
          },
        },
      ]

      const result = encodeFallbackInfo(encoder, fallbackResults)
      const decoded = new TextDecoder().decode(result)

      expect(decoded).toContain('data: ')
      expect(decoded).toContain('fileProcessing')
      expect(decoded).toContain('document.pdf')
      expect(decoded).toContain('"type":"text"')
      expect(decoded).toMatch(/\n\n$/)
    })

    it('should include LLM usage flag for image descriptions', () => {
      const fallbackResults = [
        {
          type: 'image_description' as const,
          content: 'A photo of mountains',
          processingMetadata: {
            originalFilename: 'photo.jpg',
            usedImageDescriptionLLM: true,
          },
        },
      ]

      const result = encodeFallbackInfo(encoder, fallbackResults)
      const decoded = new TextDecoder().decode(result)

      expect(decoded).toContain('usedImageDescriptionLLM')
      expect(decoded).toContain('true')
    })

    it('should handle fallback errors', () => {
      const fallbackResults = [
        {
          type: 'error' as const,
          content: '',
          error: 'Failed to process file',
          processingMetadata: {
            originalFilename: 'broken.bin',
            usedImageDescriptionLLM: false,
          },
        },
      ]

      const result = encodeFallbackInfo(encoder, fallbackResults)
      const decoded = new TextDecoder().decode(result)

      expect(decoded).toContain('error')
      expect(decoded).toContain('Failed to process file')
    })

    it('should handle multiple fallback results', () => {
      const fallbackResults = [
        {
          type: 'text' as const,
          content: 'First file',
          processingMetadata: {
            originalFilename: 'file1.txt',
            usedImageDescriptionLLM: false,
          },
        },
        {
          type: 'image_description' as const,
          content: 'Second file',
          processingMetadata: {
            originalFilename: 'file2.jpg',
            usedImageDescriptionLLM: true,
          },
        },
      ]

      const result = encodeFallbackInfo(encoder, fallbackResults)
      const decoded = new TextDecoder().decode(result)

      expect(decoded).toContain('file1.txt')
      expect(decoded).toContain('file2.jpg')
    })
  })

  describe('encodeContentChunk', () => {
    it('should encode text content as SSE data event', () => {
      const result = encodeContentChunk(encoder, 'Hello, world!')
      const decoded = new TextDecoder().decode(result)

      expect(decoded).toBe('data: {"content":"Hello, world!"}\n\n')
    })

    it('should handle empty content', () => {
      const result = encodeContentChunk(encoder, '')
      const decoded = new TextDecoder().decode(result)

      expect(decoded).toBe('data: {"content":""}\n\n')
    })

    it('should handle content with special characters', () => {
      const content = 'Line 1\nLine 2\t"quoted"'
      const result = encodeContentChunk(encoder, content)
      const decoded = new TextDecoder().decode(result)

      expect(decoded).toContain('Line 1')
      expect(decoded).toContain('Line 2')
      expect(decoded).toMatch(/\n\n$/)
    })

    it('should handle unicode content', () => {
      const content = '你好世界 🌍'
      const result = encodeContentChunk(encoder, content)
      const decoded = new TextDecoder().decode(result)

      expect(decoded).toContain('你好世界')
      expect(decoded).toContain('🌍')
    })

    it('should handle very long content', () => {
      const content = 'a'.repeat(10000)
      const result = encodeContentChunk(encoder, content)
      const decoded = new TextDecoder().decode(result)

      expect(decoded).toContain('data: ')
      expect(decoded).toMatch(/\n\n$/)
      expect(decoded.length).toBeGreaterThan(10000)
    })
  })

  describe('encodeDoneEvent', () => {
    it('should encode done event with message ID', () => {
      const result = encodeDoneEvent(encoder, {
        messageId: 'msg-123',
        usage: null,
        cacheUsage: null,
        attachmentResults: null,
        toolsExecuted: false,
      })
      const decoded = new TextDecoder().decode(result)

      expect(decoded).toContain('data: ')
      expect(decoded).toContain('"done":true')
      expect(decoded).toContain('"messageId":"msg-123"')
      expect(decoded).toMatch(/\n\n$/)
    })

    it('should include usage stats when provided', () => {
      const result = encodeDoneEvent(encoder, {
        messageId: 'msg-123',
        usage: {
          promptTokens: 100,
          completionTokens: 50,
          totalTokens: 150,
        },
        cacheUsage: null,
        attachmentResults: null,
        toolsExecuted: false,
      })
      const decoded = new TextDecoder().decode(result)

      expect(decoded).toContain('"promptTokens":100')
      expect(decoded).toContain('"completionTokens":50')
      expect(decoded).toContain('"totalTokens":150')
    })

    it('should include cache usage stats', () => {
      const result = encodeDoneEvent(encoder, {
        messageId: 'msg-123',
        usage: null,
        cacheUsage: {
          cacheCreationInputTokens: 200,
          cacheReadInputTokens: 100,
        },
        attachmentResults: null,
        toolsExecuted: false,
      })
      const decoded = new TextDecoder().decode(result)

      expect(decoded).toContain('"cacheCreationInputTokens":200')
      expect(decoded).toContain('"cacheReadInputTokens":100')
    })

    it('should include attachment results', () => {
      const result = encodeDoneEvent(encoder, {
        messageId: 'msg-123',
        usage: null,
        cacheUsage: null,
        attachmentResults: {
          sent: ['file-1', 'file-2'],
          failed: [{ id: 'file-3', error: 'Too large' }],
        },
        toolsExecuted: false,
      })
      const decoded = new TextDecoder().decode(result)

      expect(decoded).toContain('"sent":["file-1","file-2"]')
      expect(decoded).toContain('"failed"')
      expect(decoded).toContain('Too large')
    })

    it('should indicate tools were executed', () => {
      const result = encodeDoneEvent(encoder, {
        messageId: 'msg-123',
        usage: null,
        cacheUsage: null,
        attachmentResults: null,
        toolsExecuted: true,
      })
      const decoded = new TextDecoder().decode(result)

      expect(decoded).toContain('"toolsExecuted":true')
    })

    it('should include turn information for multi-character chats', () => {
      const result = encodeDoneEvent(encoder, {
        messageId: 'msg-123',
        usage: null,
        cacheUsage: null,
        attachmentResults: null,
        toolsExecuted: false,
        turn: {
          nextSpeakerId: 'char-2',
          reason: 'natural progression',
          cycleComplete: false,
          isUsersTurn: false,
        },
      })
      const decoded = new TextDecoder().decode(result)

      expect(decoded).toContain('"turn"')
      expect(decoded).toContain('"nextSpeakerId":"char-2"')
      expect(decoded).toContain('natural progression')
    })

    it('should handle empty response scenario', () => {
      const result = encodeDoneEvent(encoder, {
        messageId: null,
        usage: null,
        cacheUsage: null,
        attachmentResults: null,
        toolsExecuted: false,
        emptyResponse: true,
        emptyResponseReason: 'Safety filter triggered',
      })
      const decoded = new TextDecoder().decode(result)

      expect(decoded).toContain('"emptyResponse":true')
      expect(decoded).toContain('Safety filter triggered')
    })
  })

  describe('encodeErrorEvent', () => {
    it('should encode error event as SSE data', () => {
      const result = encodeErrorEvent(
        encoder,
        'API request failed',
        'API_ERROR',
        'Rate limit exceeded'
      )
      const decoded = new TextDecoder().decode(result)

      expect(decoded).toContain('data: ')
      expect(decoded).toContain('"error":"API request failed"')
      expect(decoded).toContain('"errorType":"API_ERROR"')
      expect(decoded).toContain('"details":"Rate limit exceeded"')
      expect(decoded).toMatch(/\n\n$/)
    })

    it('should handle different error types', () => {
      const result = encodeErrorEvent(
        encoder,
        'Invalid input',
        'VALIDATION_ERROR',
        'Message too long'
      )
      const decoded = new TextDecoder().decode(result)

      expect(decoded).toContain('VALIDATION_ERROR')
      expect(decoded).toContain('Invalid input')
    })
  })

  describe('encodeKeepAlive', () => {
    it('should encode SSE comment as keep-alive', () => {
      const result = encodeKeepAlive(encoder)
      const decoded = new TextDecoder().decode(result)

      expect(decoded).toBe(': keep-alive\n\n')
    })
  })

  describe('safeEnqueue', () => {
    it('should successfully enqueue data to controller', () => {
      const controller = {
        enqueue: jest.fn(),
      } as unknown as ReadableStreamDefaultController<Uint8Array>

      const data = encoder.encode('test')
      const result = safeEnqueue(controller, data)

      expect(result).toBe(true)
      expect(controller.enqueue).toHaveBeenCalledWith(data)
    })

    it('should return false when controller is closed', () => {
      const controller = {
        enqueue: jest.fn(() => {
          throw new Error('Controller is already closed')
        }),
      } as unknown as ReadableStreamDefaultController<Uint8Array>

      const data = encoder.encode('test')
      const result = safeEnqueue(controller, data)

      expect(result).toBe(false)
    })

    it('should handle TypeError from closed controller', () => {
      const controller = {
        enqueue: jest.fn(() => {
          throw new TypeError('Cannot enqueue a chunk into a closed stream')
        }),
      } as unknown as ReadableStreamDefaultController<Uint8Array>

      const data = encoder.encode('test')
      const result = safeEnqueue(controller, data)

      expect(result).toBe(false)
    })
  })

  describe('safeClose', () => {
    it('should successfully close controller', () => {
      const controller = {
        close: jest.fn(),
      } as unknown as ReadableStreamDefaultController<Uint8Array>

      safeClose(controller)

      expect(controller.close).toHaveBeenCalled()
    })

    it('should handle error when controller is already closed', () => {
      const controller = {
        close: jest.fn(() => {
          throw new Error('Controller is already closed')
        }),
      } as unknown as ReadableStreamDefaultController<Uint8Array>

      // Should not throw
      expect(() => safeClose(controller)).not.toThrow()
    })

    it('should handle TypeError from closed controller', () => {
      const controller = {
        close: jest.fn(() => {
          throw new TypeError('Cannot close a closed stream')
        }),
      } as unknown as ReadableStreamDefaultController<Uint8Array>

      expect(() => safeClose(controller)).not.toThrow()
    })
  })

  describe('createStreamingResult', () => {
    it('should create result object with all fields', () => {
      const result = createStreamingResult(
        'Full response text',
        { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
        { cacheCreationInputTokens: 200, cacheReadInputTokens: 100 },
        { sent: ['file-1'], failed: [] },
        { raw: 'data' },
        'thought-sig-123'
      )

      expect(result).toEqual({
        fullResponse: 'Full response text',
        usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
        cacheUsage: { cacheCreationInputTokens: 200, cacheReadInputTokens: 100 },
        attachmentResults: { sent: ['file-1'], failed: [] },
        rawResponse: { raw: 'data' },
        thoughtSignature: 'thought-sig-123',
      })
    })

    it('should handle null values', () => {
      const result = createStreamingResult(
        '',
        null,
        null,
        null,
        null
      )

      expect(result).toEqual({
        fullResponse: '',
        usage: null,
        cacheUsage: null,
        attachmentResults: null,
        rawResponse: null,
        thoughtSignature: undefined,
      })
    })

    it('should handle empty attachment results', () => {
      const result = createStreamingResult(
        'Response',
        null,
        null,
        { sent: [], failed: [] },
        null
      )

      expect(result.attachmentResults).toEqual({ sent: [], failed: [] })
    })
  })
})
