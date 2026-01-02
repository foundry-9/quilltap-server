/**
 * Unit tests for All-LLM Pause Logic
 * Tests the automatic pause intervals for chats where all participants are LLM-controlled.
 *
 * The pause logic uses a logarithmic doubling sequence: 3, 6, 12, 24, 48, 96...
 * This prevents runaway API usage in all-LLM chats.
 */

import { describe, it, expect } from '@jest/globals'
import {
  INITIAL_PAUSE_INTERVAL,
  getNextPauseInterval,
  shouldPauseForAllLLM,
  getCurrentPauseThreshold,
  getNextPauseThreshold,
  getTurnsUntilNextPause,
} from '@/lib/chat/turn-manager/all-llm-pause'

describe('All-LLM Pause Logic', () => {
  describe('INITIAL_PAUSE_INTERVAL', () => {
    it('should be 3', () => {
      expect(INITIAL_PAUSE_INTERVAL).toBe(3)
    })
  })

  describe('getNextPauseInterval', () => {
    it('returns initial interval (3) when current is 0', () => {
      expect(getNextPauseInterval(0)).toBe(3)
    })

    it('doubles the current interval', () => {
      expect(getNextPauseInterval(3)).toBe(6)
      expect(getNextPauseInterval(6)).toBe(12)
      expect(getNextPauseInterval(12)).toBe(24)
      expect(getNextPauseInterval(24)).toBe(48)
      expect(getNextPauseInterval(48)).toBe(96)
      expect(getNextPauseInterval(96)).toBe(192)
    })

    it('handles non-standard values by doubling', () => {
      expect(getNextPauseInterval(5)).toBe(10)
      expect(getNextPauseInterval(100)).toBe(200)
    })
  })

  describe('shouldPauseForAllLLM', () => {
    describe('edge cases', () => {
      it('returns false for turn count 0', () => {
        expect(shouldPauseForAllLLM(0)).toBe(false)
      })

      it('returns false for negative turn counts', () => {
        expect(shouldPauseForAllLLM(-1)).toBe(false)
        expect(shouldPauseForAllLLM(-5)).toBe(false)
        expect(shouldPauseForAllLLM(-100)).toBe(false)
      })
    })

    describe('pause threshold matches', () => {
      it('returns true at first threshold (3)', () => {
        expect(shouldPauseForAllLLM(3)).toBe(true)
      })

      it('returns true at second threshold (6)', () => {
        expect(shouldPauseForAllLLM(6)).toBe(true)
      })

      it('returns true at subsequent thresholds', () => {
        expect(shouldPauseForAllLLM(12)).toBe(true)
        expect(shouldPauseForAllLLM(24)).toBe(true)
        expect(shouldPauseForAllLLM(48)).toBe(true)
        expect(shouldPauseForAllLLM(96)).toBe(true)
        expect(shouldPauseForAllLLM(192)).toBe(true)
      })
    })

    describe('non-threshold values', () => {
      it('returns false for values before first threshold', () => {
        expect(shouldPauseForAllLLM(1)).toBe(false)
        expect(shouldPauseForAllLLM(2)).toBe(false)
      })

      it('returns false for values between thresholds', () => {
        expect(shouldPauseForAllLLM(4)).toBe(false)
        expect(shouldPauseForAllLLM(5)).toBe(false)
        expect(shouldPauseForAllLLM(7)).toBe(false)
        expect(shouldPauseForAllLLM(8)).toBe(false)
        expect(shouldPauseForAllLLM(9)).toBe(false)
        expect(shouldPauseForAllLLM(10)).toBe(false)
        expect(shouldPauseForAllLLM(11)).toBe(false)
        expect(shouldPauseForAllLLM(13)).toBe(false)
        expect(shouldPauseForAllLLM(23)).toBe(false)
        expect(shouldPauseForAllLLM(25)).toBe(false)
        expect(shouldPauseForAllLLM(47)).toBe(false)
        expect(shouldPauseForAllLLM(49)).toBe(false)
      })

      it('returns false for large non-threshold values', () => {
        expect(shouldPauseForAllLLM(100)).toBe(false)
        expect(shouldPauseForAllLLM(200)).toBe(false)
        expect(shouldPauseForAllLLM(193)).toBe(false)
      })
    })

    describe('high thresholds', () => {
      it('returns true for very high thresholds', () => {
        expect(shouldPauseForAllLLM(384)).toBe(true)
        expect(shouldPauseForAllLLM(768)).toBe(true)
        expect(shouldPauseForAllLLM(1536)).toBe(true)
      })
    })
  })

  describe('getCurrentPauseThreshold', () => {
    describe('below first threshold', () => {
      it('returns 0 when turn count is 0', () => {
        expect(getCurrentPauseThreshold(0)).toBe(0)
      })

      it('returns 0 when turn count is 1', () => {
        expect(getCurrentPauseThreshold(1)).toBe(0)
      })

      it('returns 0 when turn count is 2', () => {
        expect(getCurrentPauseThreshold(2)).toBe(0)
      })
    })

    describe('at and above thresholds', () => {
      it('returns 3 at first threshold', () => {
        expect(getCurrentPauseThreshold(3)).toBe(3)
      })

      it('returns 3 when between first and second threshold', () => {
        expect(getCurrentPauseThreshold(4)).toBe(3)
        expect(getCurrentPauseThreshold(5)).toBe(3)
      })

      it('returns 6 at second threshold', () => {
        expect(getCurrentPauseThreshold(6)).toBe(6)
      })

      it('returns 6 when between second and third threshold', () => {
        expect(getCurrentPauseThreshold(7)).toBe(6)
        expect(getCurrentPauseThreshold(11)).toBe(6)
      })

      it('returns 12 at third threshold', () => {
        expect(getCurrentPauseThreshold(12)).toBe(12)
      })

      it('returns last threshold for values between thresholds', () => {
        expect(getCurrentPauseThreshold(15)).toBe(12)
        expect(getCurrentPauseThreshold(20)).toBe(12)
        expect(getCurrentPauseThreshold(23)).toBe(12)
        expect(getCurrentPauseThreshold(24)).toBe(24)
        expect(getCurrentPauseThreshold(30)).toBe(24)
        expect(getCurrentPauseThreshold(48)).toBe(48)
        expect(getCurrentPauseThreshold(50)).toBe(48)
      })
    })

    describe('high values', () => {
      it('returns correct threshold for high turn counts', () => {
        expect(getCurrentPauseThreshold(100)).toBe(96)
        expect(getCurrentPauseThreshold(192)).toBe(192)
        expect(getCurrentPauseThreshold(300)).toBe(192)
        expect(getCurrentPauseThreshold(384)).toBe(384)
      })
    })
  })

  describe('getNextPauseThreshold', () => {
    describe('below first threshold', () => {
      it('returns 3 for turn count 0', () => {
        expect(getNextPauseThreshold(0)).toBe(3)
      })

      it('returns 3 for turn count 1', () => {
        expect(getNextPauseThreshold(1)).toBe(3)
      })

      it('returns 3 for turn count 2', () => {
        expect(getNextPauseThreshold(2)).toBe(3)
      })
    })

    describe('at and above thresholds', () => {
      it('returns 6 at turn count 3', () => {
        expect(getNextPauseThreshold(3)).toBe(6)
      })

      it('returns 6 for turn counts 4-5', () => {
        expect(getNextPauseThreshold(4)).toBe(6)
        expect(getNextPauseThreshold(5)).toBe(6)
      })

      it('returns 12 at turn count 6', () => {
        expect(getNextPauseThreshold(6)).toBe(12)
      })

      it('returns 12 for turn counts 7-11', () => {
        expect(getNextPauseThreshold(7)).toBe(12)
        expect(getNextPauseThreshold(11)).toBe(12)
      })

      it('returns 24 at turn count 12', () => {
        expect(getNextPauseThreshold(12)).toBe(24)
      })

      it('returns correct next threshold for higher values', () => {
        expect(getNextPauseThreshold(24)).toBe(48)
        expect(getNextPauseThreshold(48)).toBe(96)
        expect(getNextPauseThreshold(96)).toBe(192)
      })
    })

    describe('high values', () => {
      it('returns correct next threshold for high turn counts', () => {
        expect(getNextPauseThreshold(100)).toBe(192)
        expect(getNextPauseThreshold(200)).toBe(384)
        expect(getNextPauseThreshold(400)).toBe(768)
      })
    })
  })

  describe('getTurnsUntilNextPause', () => {
    describe('from zero', () => {
      it('returns 3 when at turn 0', () => {
        expect(getTurnsUntilNextPause(0)).toBe(3)
      })

      it('returns correct count for turns before first threshold', () => {
        expect(getTurnsUntilNextPause(1)).toBe(2)
        expect(getTurnsUntilNextPause(2)).toBe(1)
      })
    })

    describe('between thresholds', () => {
      it('returns correct count after first threshold', () => {
        expect(getTurnsUntilNextPause(3)).toBe(3) // Next is 6
        expect(getTurnsUntilNextPause(4)).toBe(2) // Next is 6
        expect(getTurnsUntilNextPause(5)).toBe(1) // Next is 6
      })

      it('returns correct count after second threshold', () => {
        expect(getTurnsUntilNextPause(6)).toBe(6)  // Next is 12
        expect(getTurnsUntilNextPause(7)).toBe(5)  // Next is 12
        expect(getTurnsUntilNextPause(10)).toBe(2) // Next is 12
        expect(getTurnsUntilNextPause(11)).toBe(1) // Next is 12
      })

      it('returns correct count for larger intervals', () => {
        expect(getTurnsUntilNextPause(12)).toBe(12) // Next is 24
        expect(getTurnsUntilNextPause(20)).toBe(4)  // Next is 24
        expect(getTurnsUntilNextPause(24)).toBe(24) // Next is 48
        expect(getTurnsUntilNextPause(30)).toBe(18) // Next is 48
      })
    })

    describe('high values', () => {
      it('returns correct count for high turn counts', () => {
        expect(getTurnsUntilNextPause(96)).toBe(96)  // Next is 192
        expect(getTurnsUntilNextPause(100)).toBe(92) // Next is 192
        expect(getTurnsUntilNextPause(192)).toBe(192) // Next is 384
      })
    })
  })

  describe('integration scenarios', () => {
    it('correctly tracks a complete pause sequence from 0', () => {
      // Start at 0
      expect(getTurnsUntilNextPause(0)).toBe(3)
      expect(shouldPauseForAllLLM(0)).toBe(false)

      // Progress to first pause
      expect(shouldPauseForAllLLM(1)).toBe(false)
      expect(shouldPauseForAllLLM(2)).toBe(false)
      expect(shouldPauseForAllLLM(3)).toBe(true)

      // After first pause, check next interval
      expect(getTurnsUntilNextPause(3)).toBe(3)
      expect(getNextPauseThreshold(3)).toBe(6)

      // Progress to second pause
      expect(shouldPauseForAllLLM(4)).toBe(false)
      expect(shouldPauseForAllLLM(5)).toBe(false)
      expect(shouldPauseForAllLLM(6)).toBe(true)

      // After second pause, check next interval
      expect(getTurnsUntilNextPause(6)).toBe(6)
      expect(getNextPauseThreshold(6)).toBe(12)
    })

    it('all functions agree on threshold boundaries', () => {
      // At threshold 3
      expect(shouldPauseForAllLLM(3)).toBe(true)
      expect(getCurrentPauseThreshold(3)).toBe(3)
      expect(getNextPauseThreshold(3)).toBe(6)

      // At threshold 6
      expect(shouldPauseForAllLLM(6)).toBe(true)
      expect(getCurrentPauseThreshold(6)).toBe(6)
      expect(getNextPauseThreshold(6)).toBe(12)

      // At threshold 12
      expect(shouldPauseForAllLLM(12)).toBe(true)
      expect(getCurrentPauseThreshold(12)).toBe(12)
      expect(getNextPauseThreshold(12)).toBe(24)
    })

    it('turnCount + turnsUntilNextPause = nextThreshold', () => {
      for (const turnCount of [0, 1, 2, 3, 5, 6, 10, 12, 20, 24, 50, 96, 100]) {
        const turnsUntil = getTurnsUntilNextPause(turnCount)
        const nextThreshold = getNextPauseThreshold(turnCount)
        expect(turnCount + turnsUntil).toBe(nextThreshold)
      }
    })
  })
})
