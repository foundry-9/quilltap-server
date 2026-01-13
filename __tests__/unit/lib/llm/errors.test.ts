/**
 * Unit Tests for LLM Error Types and Recovery Detection
 * Tests lib/llm/errors.ts
 * v2.7-dev: Recovery Service Error Types
 */

import { describe, it, expect } from '@jest/globals'

// Define error class types inline
interface LLMProviderErrorType extends Error {
  provider: string
  originalError?: Error
}

interface TokenLimitErrorType extends LLMProviderErrorType {
  requestedTokens?: number
  maxTokens?: number
}

interface ContentLimitErrorType extends LLMProviderErrorType {
  limitType: string
  limitValue?: number
  maxValue?: number
}

interface RateLimitErrorType extends LLMProviderErrorType {
  retryAfter?: number
}

type ContentLimitType = 'pdf_pages' | 'image_size' | 'file_size' | 'unknown'

// Import using require
const {
  LLMProviderError,
  APIKeyError,
  RateLimitError,
  NetworkError,
  ModelNotFoundError,
  InvalidRequestError,
  TokenLimitError,
  ContentLimitError,
  isTokenLimitError,
  isContentLimitError,
  isRecoverableRequestError,
  parseTokenLimitError,
  parseContentLimitError,
  handleProviderError,
  getUserFriendlyError,
} = require('@/lib/llm/errors') as {
  LLMProviderError: new (provider: string, message: string, originalError?: Error) => LLMProviderErrorType
  APIKeyError: new (provider: string, message?: string) => LLMProviderErrorType
  RateLimitError: new (provider: string, retryAfter?: number) => RateLimitErrorType
  NetworkError: new (provider: string, message?: string) => LLMProviderErrorType
  ModelNotFoundError: new (provider: string, model: string) => LLMProviderErrorType
  InvalidRequestError: new (provider: string, message: string) => LLMProviderErrorType
  TokenLimitError: new (provider: string, requestedTokens?: number, maxTokens?: number, message?: string) => TokenLimitErrorType
  ContentLimitError: new (provider: string, limitType: ContentLimitType, limitValue?: number, maxValue?: number, message?: string) => ContentLimitErrorType
  isTokenLimitError: (error: unknown) => boolean
  isContentLimitError: (error: unknown) => boolean
  isRecoverableRequestError: (error: unknown) => boolean
  parseTokenLimitError: (error: unknown) => { requestedTokens?: number; maxTokens?: number }
  parseContentLimitError: (error: unknown) => { type: ContentLimitType; maxValue?: number; description?: string }
  handleProviderError: (provider: string, error: unknown) => LLMProviderErrorType
  getUserFriendlyError: (error: unknown) => string
}

describe('LLM Error Types', () => {
  describe('LLMProviderError', () => {
    it('creates error with provider and message', () => {
      const error = new LLMProviderError('OpenAI', 'Something went wrong')
      expect(error.name).toBe('LLMProviderError')
      expect(error.provider).toBe('OpenAI')
      expect(error.message).toBe('Something went wrong')
    })

    it('stores original error', () => {
      const originalError = new Error('Original')
      const error = new LLMProviderError('Anthropic', 'Wrapped', originalError)
      expect(error.originalError).toBe(originalError)
    })
  })

  describe('APIKeyError', () => {
    it('creates error with default message', () => {
      const error = new APIKeyError('OpenAI')
      expect(error.name).toBe('APIKeyError')
      expect(error.provider).toBe('OpenAI')
      expect(error.message).toBe('Invalid or missing API key')
    })

    it('creates error with custom message', () => {
      const error = new APIKeyError('Anthropic', 'API key expired')
      expect(error.message).toBe('API key expired')
    })
  })

  describe('RateLimitError', () => {
    it('creates error with default message', () => {
      const error = new RateLimitError('OpenAI')
      expect(error.name).toBe('RateLimitError')
      expect(error.provider).toBe('OpenAI')
      expect(error.message).toBe('Rate limit exceeded')
    })

    it('stores retryAfter value', () => {
      const error = new RateLimitError('OpenAI', 60)
      expect(error.retryAfter).toBe(60)
    })
  })

  describe('NetworkError', () => {
    it('creates error with default message', () => {
      const error = new NetworkError('OpenAI')
      expect(error.name).toBe('NetworkError')
      expect(error.message).toBe('Network error occurred')
    })

    it('creates error with custom message', () => {
      const error = new NetworkError('Anthropic', 'Connection timeout')
      expect(error.message).toBe('Connection timeout')
    })
  })

  describe('ModelNotFoundError', () => {
    it('creates error with model name', () => {
      const error = new ModelNotFoundError('OpenAI', 'gpt-5')
      expect(error.name).toBe('ModelNotFoundError')
      expect(error.message).toBe('Model "gpt-5" not found or not available')
    })
  })

  describe('InvalidRequestError', () => {
    it('creates error with message', () => {
      const error = new InvalidRequestError('OpenAI', 'Invalid temperature value')
      expect(error.name).toBe('InvalidRequestError')
      expect(error.message).toBe('Invalid temperature value')
    })
  })

  describe('TokenLimitError', () => {
    it('creates error with default message', () => {
      const error = new TokenLimitError('OpenAI')
      expect(error.name).toBe('TokenLimitError')
      expect(error.message).toBe('Prompt exceeds maximum token limit')
    })

    it('creates error with token counts in message', () => {
      const error = new TokenLimitError('OpenAI', 210000, 200000)
      expect(error.requestedTokens).toBe(210000)
      expect(error.maxTokens).toBe(200000)
      expect(error.message).toContain('210,000')
      expect(error.message).toContain('200,000')
    })

    it('creates error with custom message', () => {
      const error = new TokenLimitError('Anthropic', 150000, 100000, 'Custom message')
      expect(error.message).toBe('Custom message')
    })
  })

  describe('ContentLimitError', () => {
    it('creates error for PDF page limit', () => {
      const error = new ContentLimitError('Anthropic', 'pdf_pages', 150, 100)
      expect(error.name).toBe('ContentLimitError')
      expect(error.limitType).toBe('pdf_pages')
      expect(error.limitValue).toBe(150)
      expect(error.maxValue).toBe(100)
      expect(error.message).toContain('PDF page limit')
    })

    it('creates error for image size limit', () => {
      const error = new ContentLimitError('OpenAI', 'image_size', undefined, 20971520)
      expect(error.limitType).toBe('image_size')
      expect(error.message).toContain('image size limit')
    })

    it('creates error for file size limit', () => {
      const error = new ContentLimitError('Google', 'file_size', 52428800, 10485760)
      expect(error.limitType).toBe('file_size')
      expect(error.message).toContain('file size limit')
    })

    it('creates error with custom message', () => {
      const error = new ContentLimitError('OpenAI', 'unknown', undefined, undefined, 'Custom limit message')
      expect(error.message).toBe('Custom limit message')
    })
  })
})

describe('Error Detection Functions', () => {
  describe('isTokenLimitError', () => {
    it('returns true for TokenLimitError instance', () => {
      const error = new TokenLimitError('OpenAI', 210000, 200000)
      expect(isTokenLimitError(error)).toBe(true)
    })

    it('detects OpenAI context length exceeded pattern', () => {
      const error = new Error('context_length_exceeded: maximum context length is 128000')
      expect(isTokenLimitError(error)).toBe(true)
    })

    it('detects Anthropic prompt too long pattern', () => {
      const error = new Error('prompt is too long: 210000 tokens > 200000 maximum')
      expect(isTokenLimitError(error)).toBe(true)
    })

    it('detects Google payload size pattern', () => {
      const error = new Error('request payload size exceeds the limit')
      expect(isTokenLimitError(error)).toBe(true)
    })

    it('detects generic token limit patterns', () => {
      expect(isTokenLimitError(new Error('token limit exceeded'))).toBe(true)
      expect(isTokenLimitError(new Error('input too long for this model'))).toBe(true)
      expect(isTokenLimitError(new Error('tokens exceeds maximum allowed'))).toBe(true)
    })

    it('returns false for non-token-limit errors', () => {
      expect(isTokenLimitError(new Error('Invalid API key'))).toBe(false)
      expect(isTokenLimitError(new Error('Rate limit exceeded'))).toBe(false)
      expect(isTokenLimitError(new Error('Network error'))).toBe(false)
    })

    it('handles string input', () => {
      expect(isTokenLimitError('context_length_exceeded')).toBe(true)
      expect(isTokenLimitError('regular error message')).toBe(false)
    })
  })

  describe('isContentLimitError', () => {
    it('returns true for ContentLimitError instance', () => {
      const error = new ContentLimitError('Anthropic', 'pdf_pages', 150, 100)
      expect(isContentLimitError(error)).toBe(true)
    })

    it('detects PDF page limit patterns', () => {
      expect(isContentLimitError(new Error('maximum of 100 PDF pages'))).toBe(true)
      expect(isContentLimitError(new Error('PDF has 150 pages, maximum is 100'))).toBe(true)
      expect(isContentLimitError(new Error('too many PDF pages'))).toBe(true)
    })

    it('detects image size limit patterns', () => {
      expect(isContentLimitError(new Error('image is too large'))).toBe(true)
      expect(isContentLimitError(new Error('image exceeds maximum dimensions'))).toBe(true)
    })

    it('detects file size limit patterns', () => {
      expect(isContentLimitError(new Error('file is too large'))).toBe(true)
      expect(isContentLimitError(new Error('file exceeds maximum size'))).toBe(true)
    })

    it('returns false for non-content-limit errors', () => {
      expect(isContentLimitError(new Error('Invalid API key'))).toBe(false)
      expect(isContentLimitError(new Error('Network error'))).toBe(false)
    })
  })

  describe('isRecoverableRequestError', () => {
    it('returns true for token limit errors', () => {
      expect(isRecoverableRequestError(new TokenLimitError('OpenAI'))).toBe(true)
      expect(isRecoverableRequestError(new Error('context_length_exceeded'))).toBe(true)
    })

    it('returns true for content limit errors', () => {
      expect(isRecoverableRequestError(new ContentLimitError('Anthropic', 'pdf_pages'))).toBe(true)
      expect(isRecoverableRequestError(new Error('maximum of 100 PDF pages'))).toBe(true)
    })

    it('returns false for non-recoverable errors', () => {
      expect(isRecoverableRequestError(new APIKeyError('OpenAI'))).toBe(false)
      expect(isRecoverableRequestError(new RateLimitError('OpenAI'))).toBe(false)
      expect(isRecoverableRequestError(new NetworkError('OpenAI'))).toBe(false)
      expect(isRecoverableRequestError(new Error('Unknown error'))).toBe(false)
    })
  })
})

describe('Error Parsing Functions', () => {
  describe('parseTokenLimitError', () => {
    it('parses token counts from "X tokens > Y maximum" pattern', () => {
      const error = new Error('210311 tokens > 200000 maximum context length')
      const result = parseTokenLimitError(error)
      expect(result.requestedTokens).toBe(210311)
      expect(result.maxTokens).toBe(200000)
    })

    it('parses max tokens from "maximum X tokens" pattern', () => {
      const error = new Error('maximum context length is 128000 tokens')
      const result = parseTokenLimitError(error)
      expect(result.maxTokens).toBe(128000)
    })

    it('returns empty object for unparseable error', () => {
      const error = new Error('Some generic error')
      const result = parseTokenLimitError(error)
      expect(result.requestedTokens).toBeUndefined()
      expect(result.maxTokens).toBeUndefined()
    })

    it('handles string input', () => {
      const result = parseTokenLimitError('150000 tokens > 100000 maximum')
      expect(result.requestedTokens).toBe(150000)
      expect(result.maxTokens).toBe(100000)
    })
  })

  describe('parseContentLimitError', () => {
    it('parses PDF page limit', () => {
      const error = new Error('maximum of 100 PDF pages allowed')
      const result = parseContentLimitError(error)
      expect(result.type).toBe('pdf_pages')
      expect(result.maxValue).toBe(100)
      expect(result.description).toContain('100 pages')
    })

    it('detects image size limit type', () => {
      const error = new Error('image is too large to process')
      const result = parseContentLimitError(error)
      expect(result.type).toBe('image_size')
    })

    it('detects file size limit type', () => {
      const error = new Error('file exceeds maximum size limit')
      const result = parseContentLimitError(error)
      expect(result.type).toBe('file_size')
    })

    it('returns unknown type for unparseable error', () => {
      const error = new Error('Some random error')
      const result = parseContentLimitError(error)
      expect(result.type).toBe('unknown')
    })
  })
})

describe('handleProviderError', () => {
  it('returns existing LLMProviderError unchanged', () => {
    const original = new TokenLimitError('OpenAI', 150000, 100000)
    const result = handleProviderError('OpenAI', original)
    expect(result).toBe(original)
  })

  it('converts unauthorized error to APIKeyError', () => {
    const error = new Error('Unauthorized: Invalid API key')
    const result = handleProviderError('OpenAI', error)
    expect(result).toBeInstanceOf(APIKeyError)
    expect(result.provider).toBe('OpenAI')
  })

  it('converts 401 error to APIKeyError', () => {
    const error = new Error('HTTP 401 Authentication failed')
    const result = handleProviderError('Anthropic', error)
    expect(result).toBeInstanceOf(APIKeyError)
  })

  it('converts rate limit error to RateLimitError', () => {
    const error = new Error('Rate limit exceeded, please retry')
    const result = handleProviderError('OpenAI', error)
    expect(result).toBeInstanceOf(RateLimitError)
  })

  it('converts 429 error to RateLimitError', () => {
    const error = new Error('HTTP 429 Too many requests')
    const result = handleProviderError('OpenAI', error)
    expect(result).toBeInstanceOf(RateLimitError)
  })

  it('converts network error to NetworkError', () => {
    const error = new Error('ECONNREFUSED: Connection refused')
    const result = handleProviderError('OpenAI', error)
    expect(result).toBeInstanceOf(NetworkError)
  })

  it('converts timeout error to NetworkError', () => {
    const error = new Error('Request timeout after 30000ms')
    const result = handleProviderError('OpenAI', error)
    expect(result).toBeInstanceOf(NetworkError)
  })

  it('converts model not found error to ModelNotFoundError', () => {
    const error = new Error('model gpt-5 not found')
    const result = handleProviderError('OpenAI', error)
    expect(result).toBeInstanceOf(ModelNotFoundError)
  })

  it('converts token limit error to TokenLimitError', () => {
    const error = new Error('context_length_exceeded: 210000 tokens > 200000 maximum')
    const result = handleProviderError('OpenAI', error)
    expect(result).toBeInstanceOf(TokenLimitError)
  })

  it('converts invalid request to InvalidRequestError', () => {
    const error = new Error('Invalid temperature: must be between 0 and 2')
    const result = handleProviderError('OpenAI', error)
    expect(result).toBeInstanceOf(InvalidRequestError)
  })

  it('wraps unknown error in LLMProviderError', () => {
    const error = new Error('Some obscure error')
    const result = handleProviderError('OpenAI', error)
    expect(result).toBeInstanceOf(LLMProviderError)
    expect(result.message).toBe('Some obscure error')
  })

  it('handles non-Error input', () => {
    const result = handleProviderError('OpenAI', 'string error')
    expect(result).toBeInstanceOf(LLMProviderError)
    expect(result.message).toBe('An unknown error occurred')
  })
})

describe('getUserFriendlyError', () => {
  it('returns friendly message for APIKeyError', () => {
    const error = new APIKeyError('OpenAI')
    const message = getUserFriendlyError(error)
    expect(message).toContain('Invalid or expired API key')
    expect(message).toContain('OpenAI')
  })

  it('returns friendly message for RateLimitError with retryAfter', () => {
    const error = new RateLimitError('OpenAI', 60)
    const message = getUserFriendlyError(error)
    expect(message).toContain('Rate limit exceeded')
    expect(message).toContain('60 seconds')
  })

  it('returns friendly message for RateLimitError without retryAfter', () => {
    const error = new RateLimitError('OpenAI')
    const message = getUserFriendlyError(error)
    expect(message).toContain('Rate limit exceeded')
    expect(message).toContain('try again later')
  })

  it('returns friendly message for NetworkError', () => {
    const error = new NetworkError('OpenAI')
    const message = getUserFriendlyError(error)
    expect(message).toContain('Unable to connect')
    expect(message).toContain('internet connection')
  })

  it('returns friendly message for ModelNotFoundError', () => {
    const error = new ModelNotFoundError('OpenAI', 'gpt-5')
    const message = getUserFriendlyError(error)
    expect(message).toContain('not found')
    expect(message).toContain('select a different model')
  })

  it('returns friendly message for TokenLimitError with counts', () => {
    const error = new TokenLimitError('OpenAI', 210000, 200000)
    const message = getUserFriendlyError(error)
    expect(message).toContain('token limit')
    expect(message).toContain('210,000')
    expect(message).toContain('200,000')
  })

  it('returns friendly message for generic LLMProviderError', () => {
    const error = new LLMProviderError('OpenAI', 'Something went wrong')
    const message = getUserFriendlyError(error)
    expect(message).toContain('OpenAI')
    expect(message).toContain('Something went wrong')
  })

  it('returns message for regular Error', () => {
    const error = new Error('Generic error')
    const message = getUserFriendlyError(error)
    expect(message).toBe('Generic error')
  })

  it('returns generic message for non-Error', () => {
    const message = getUserFriendlyError('string error')
    expect(message).toContain('unexpected error')
  })
})
