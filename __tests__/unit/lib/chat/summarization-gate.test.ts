import {
  evaluateSummarizationGate,
  T_SOFT_TOKEN_THRESHOLD,
  T_SOFT_TURN_THRESHOLD,
  T_HARD_TURN_THRESHOLD,
  type SummarizationGateInputs,
} from '@/lib/chat/context-summary'

function inputs(overrides: Partial<SummarizationGateInputs> = {}): SummarizationGateInputs {
  return {
    currentTurn: 1,
    currentTokens: 0,
    lastSummaryTurn: 0,
    lastSummaryTokens: 0,
    lastFullRebuildTurn: 0,
    hasExistingSummary: false,
    ...overrides,
  }
}

describe('evaluateSummarizationGate', () => {
  it('skips when conversation is too short', () => {
    expect(evaluateSummarizationGate(inputs({ currentTurn: 1 }))).toBe('skip')
    expect(evaluateSummarizationGate(inputs({ currentTurn: 0 }))).toBe('skip')
  })

  describe('first-time generation (no existing summary)', () => {
    it('skips below soft thresholds', () => {
      expect(evaluateSummarizationGate(inputs({
        currentTurn: 5,
        currentTokens: 5000,
        hasExistingSummary: false,
      }))).toBe('skip')
    })

    it('soft-fires when turn threshold met', () => {
      expect(evaluateSummarizationGate(inputs({
        currentTurn: T_SOFT_TURN_THRESHOLD,
        currentTokens: 1000,
        hasExistingSummary: false,
      }))).toBe('soft')
    })

    it('soft-fires when token threshold met', () => {
      expect(evaluateSummarizationGate(inputs({
        currentTurn: 3,
        currentTokens: T_SOFT_TOKEN_THRESHOLD,
        hasExistingSummary: false,
      }))).toBe('soft')
    })
  })

  describe('with existing summary', () => {
    it('skips when nothing has changed since last refresh', () => {
      expect(evaluateSummarizationGate(inputs({
        currentTurn: 10,
        currentTokens: 5000,
        lastSummaryTurn: 10,
        lastSummaryTokens: 5000,
        hasExistingSummary: true,
      }))).toBe('skip')
    })

    it('skips when only a few new turns/tokens have arrived', () => {
      expect(evaluateSummarizationGate(inputs({
        currentTurn: 12,
        currentTokens: 6000,
        lastSummaryTurn: 10,
        lastSummaryTokens: 5000,
        hasExistingSummary: true,
      }))).toBe('skip')
    })

    it('soft-fires when 8+ turns have passed since last refresh', () => {
      expect(evaluateSummarizationGate(inputs({
        currentTurn: 18,
        currentTokens: 6000,
        lastSummaryTurn: 10,
        lastSummaryTokens: 5000,
        hasExistingSummary: true,
      }))).toBe('soft')
    })

    it('soft-fires when 8K+ tokens have been added since last refresh', () => {
      expect(evaluateSummarizationGate(inputs({
        currentTurn: 12,
        currentTokens: 5000 + T_SOFT_TOKEN_THRESHOLD,
        lastSummaryTurn: 10,
        lastSummaryTokens: 5000,
        hasExistingSummary: true,
      }))).toBe('soft')
    })

    it('hard-fires when 50+ turns have passed since last full rebuild', () => {
      expect(evaluateSummarizationGate(inputs({
        currentTurn: T_HARD_TURN_THRESHOLD,
        currentTokens: 30_000,
        lastSummaryTurn: 48,
        lastSummaryTokens: 28_000,
        lastFullRebuildTurn: 0,
        hasExistingSummary: true,
      }))).toBe('hard')
    })

    it('prefers hard over soft when both fire', () => {
      // Turn 60: 50+ turns since full rebuild AND 8+ since last soft refresh
      expect(evaluateSummarizationGate(inputs({
        currentTurn: 60,
        currentTokens: 50_000,
        lastSummaryTurn: 50,
        lastSummaryTokens: 40_000,
        lastFullRebuildTurn: 0,
        hasExistingSummary: true,
      }))).toBe('hard')
    })
  })

  describe('call-count reduction', () => {
    it('over a 50-turn fixture, soft fires only every ~8 turns and hard once', () => {
      // Simulate: turn N, ~1000 tokens per turn, gate state advancing.
      let lastSummaryTurn = 0
      let lastSummaryTokens = 0
      let lastFullRebuildTurn = 0
      let fires = 0
      let hardFires = 0
      let hasExistingSummary = false

      for (let turn = 2; turn <= 50; turn++) {
        const decision = evaluateSummarizationGate({
          currentTurn: turn,
          currentTokens: turn * 1000,
          lastSummaryTurn,
          lastSummaryTokens,
          lastFullRebuildTurn,
          hasExistingSummary,
        })
        if (decision === 'soft') {
          fires++
          lastSummaryTurn = turn
          lastSummaryTokens = turn * 1000
          hasExistingSummary = true
        } else if (decision === 'hard') {
          fires++
          hardFires++
          lastSummaryTurn = turn
          lastSummaryTokens = turn * 1000
          lastFullRebuildTurn = turn
          hasExistingSummary = true
        }
      }

      // Previous behaviour fires at interchange checkpoints 2,3,5,7,10,20,30,40,50 = 9 fires.
      // Triple-gate fires every 8 turns + one at first soft threshold; should be ~6-7 fires.
      expect(fires).toBeGreaterThanOrEqual(5)
      expect(fires).toBeLessThanOrEqual(8)
      // Hard fire should occur at turn 50 (50 turns since lastFullRebuildTurn=0)
      expect(hardFires).toBeGreaterThanOrEqual(1)
    })
  })
})
