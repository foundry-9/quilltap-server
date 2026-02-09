/**
 * Unit tests for rng-pattern-detector.service.ts
 * Tests RNG pattern detection including ReDoS safety
 */

import {
  detectRngPatterns,
  convertPatternsToToolCalls,
  detectAndConvertRngPatterns,
} from '@/lib/services/chat-message/rng-pattern-detector.service'

jest.mock('@/lib/logging/create-logger', () => ({
  createServiceLogger: jest.fn(() => ({
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  })),
}))

describe('RNG Pattern Detector Service', () => {
  describe('detectRngPatterns', () => {
    describe('dice patterns', () => {
      it('should detect simple dice notation', () => {
        const patterns = detectRngPatterns('roll d6')
        expect(patterns).toHaveLength(1)
        expect(patterns[0]).toMatchObject({
          type: 'dice',
          sides: 6,
          count: 1,
          matchText: 'd6',
        })
      })

      it('should detect multi-dice notation', () => {
        const patterns = detectRngPatterns('roll 2d20')
        expect(patterns).toHaveLength(1)
        expect(patterns[0]).toMatchObject({
          type: 'dice',
          sides: 20,
          count: 2,
        })
      })

      it('should detect multiple dice rolls', () => {
        const patterns = detectRngPatterns('roll d6 and 2d10')
        expect(patterns).toHaveLength(2)
      })

      it('should reject invalid dice (1 side)', () => {
        const patterns = detectRngPatterns('roll d1')
        expect(patterns).toHaveLength(0)
      })

      it('should reject excessive roll counts', () => {
        const patterns = detectRngPatterns('roll 200d6')
        expect(patterns).toHaveLength(0)
      })
    })

    describe('coin flip patterns', () => {
      it('should detect "flip a coin"', () => {
        const patterns = detectRngPatterns('flip a coin')
        expect(patterns).toHaveLength(1)
        expect(patterns[0]).toMatchObject({
          type: 'flip_coin',
          count: 1,
        })
      })

      it('should NOT detect "flip the coin" (too many chars between flip and coin)', () => {
        // Pattern allows only 1-3 chars between "flip" and "coin"
        // "the " = 4 chars, so this should not match
        const patterns = detectRngPatterns('Let\'s flip the coin!')
        expect(patterns).toHaveLength(0)
      })
    })

    describe('spin the bottle patterns', () => {
      it('should detect "spin the bottle"', () => {
        const patterns = detectRngPatterns('spin the bottle')
        expect(patterns).toHaveLength(1)
        expect(patterns[0]).toMatchObject({
          type: 'spin_the_bottle',
          count: 1,
        })
      })

      it('should detect "spin a bottle"', () => {
        const patterns = detectRngPatterns('let\'s spin a bottle')
        expect(patterns).toHaveLength(1)
      })

      it('should detect with moderate text between spin and bottle', () => {
        const patterns = detectRngPatterns('spin the magic bottle')
        expect(patterns).toHaveLength(1)
      })

      it('should NOT match when spin and bottle are too far apart (ReDoS protection)', () => {
        // The bounded regex .{0,50} prevents matching when there's too much text between
        const longFiller = 'x'.repeat(60)
        const patterns = detectRngPatterns(`spin ${longFiller} bottle`)
        expect(patterns).toHaveLength(0)
      })

      it('should complete quickly on adversarial input (ReDoS resistance)', () => {
        // This tests that the bounded regex doesn't cause catastrophic backtracking
        const adversarialInput = 'spin ' + ' '.repeat(10000)
        const start = Date.now()
        detectRngPatterns(adversarialInput)
        const elapsed = Date.now() - start
        // Should complete in well under a second (unbounded .* could hang)
        expect(elapsed).toBeLessThan(100)
      })
    })

    describe('no patterns', () => {
      it('should return empty array for plain text', () => {
        const patterns = detectRngPatterns('Hello, how are you?')
        expect(patterns).toHaveLength(0)
      })

      it('should return empty array for empty string', () => {
        const patterns = detectRngPatterns('')
        expect(patterns).toHaveLength(0)
      })
    })
  })

  describe('convertPatternsToToolCalls', () => {
    it('should convert dice patterns to tool calls', () => {
      const patterns = detectRngPatterns('roll 2d6')
      const calls = convertPatternsToToolCalls(patterns)
      expect(calls).toHaveLength(1)
      expect(calls[0]).toMatchObject({
        type: 6,
        rolls: 2,
        matchText: '2d6',
      })
    })

    it('should convert coin flip patterns to tool calls', () => {
      const patterns = detectRngPatterns('flip a coin')
      const calls = convertPatternsToToolCalls(patterns)
      expect(calls).toHaveLength(1)
      expect(calls[0]).toMatchObject({
        type: 'flip_coin',
        rolls: 1,
      })
    })

    it('should convert spin bottle patterns to tool calls', () => {
      const patterns = detectRngPatterns('spin the bottle')
      const calls = convertPatternsToToolCalls(patterns)
      expect(calls).toHaveLength(1)
      expect(calls[0]).toMatchObject({
        type: 'spin_the_bottle',
        rolls: 1,
      })
    })
  })

  describe('detectAndConvertRngPatterns', () => {
    it('should detect and convert in one call', () => {
      const calls = detectAndConvertRngPatterns('roll d20 and flip a coin')
      expect(calls).toHaveLength(2)
    })

    it('should return empty for no matches', () => {
      const calls = detectAndConvertRngPatterns('nothing special here')
      expect(calls).toHaveLength(0)
    })
  })
})
