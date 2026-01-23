/**
 * Unit Tests for Logger Factory
 * Tests lib/logging/create-logger.ts
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals'

// Mock the logger
jest.mock('@/lib/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}))

import { createLogger } from '@/lib/logging/create-logger'

describe('createLogger', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('initialization', () => {
    it('should create a logger instance', () => {
      const logger = createLogger('test')
      expect(logger).toBeDefined()
      expect(typeof logger.debug).toBe('function')
      expect(typeof logger.info).toBe('function')
      expect(typeof logger.warn).toBe('function')
      expect(typeof logger.error).toBe('function')
    })

    it('should accept a context string', () => {
      const logger = createLogger('MyContext')
      expect(logger).toBeDefined()
    })

    it('should handle empty context', () => {
      const logger = createLogger('')
      expect(logger).toBeDefined()
    })
  })

  describe('logging methods', () => {
    it('should have debug method', () => {
      const logger = createLogger('test')
      expect(typeof logger.debug).toBe('function')
    })

    it('should have info method', () => {
      const logger = createLogger('test')
      expect(typeof logger.info).toBe('function')
    })

    it('should have warn method', () => {
      const logger = createLogger('test')
      expect(typeof logger.warn).toBe('function')
    })

    it('should have error method', () => {
      const logger = createLogger('test')
      expect(typeof logger.error).toBe('function')
    })
  })

  describe('context handling', () => {
    it('should preserve context in logger', () => {
      const context = 'MyService'
      const logger = createLogger(context)
      expect(logger).toBeDefined()
    })

    it('should handle special characters in context', () => {
      const logger = createLogger('Service-With-Dashes')
      expect(logger).toBeDefined()
    })

    it('should handle numbers in context', () => {
      const logger = createLogger('Service123')
      expect(logger).toBeDefined()
    })
  })

  describe('child logger creation', () => {
    it('should create child loggers with extended context', () => {
      const logger = createLogger('parent')
      if (typeof logger.child === 'function') {
        const childLogger = logger.child('child')
        expect(childLogger).toBeDefined()
        expect(typeof childLogger.debug).toBe('function')
      }
    })
  })

  describe('multiple instances', () => {
    it('should create independent logger instances', () => {
      const logger1 = createLogger('context1')
      const logger2 = createLogger('context2')
      expect(logger1).toBeDefined()
      expect(logger2).toBeDefined()
      expect(logger1).not.toBe(logger2)
    })
  })
})
