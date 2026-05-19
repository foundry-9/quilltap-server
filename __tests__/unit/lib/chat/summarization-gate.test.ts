import {
  evaluateSummarizationGate,
  FOLD_TURN_BATCH,
  FOLD_TAIL_FLOOR,
  FOLD_TRIGGER_DELTA,
  T_HARD_TURN_THRESHOLD,
  type SummarizationGateInputs,
} from '@/lib/chat/context-summary'

function inputs(overrides: Partial<SummarizationGateInputs> = {}): SummarizationGateInputs {
  return {
    currentTurn: 1,
    lastFoldedTurn: 0,
    lastFullRebuildTurn: 0,
    ...overrides,
  }
}

describe('evaluateSummarizationGate (rolling-window fold)', () => {
  it('skips when within the trigger delta', () => {
    expect(evaluateSummarizationGate(inputs({ currentTurn: 1 }))).toBe('skip')
    expect(evaluateSummarizationGate(inputs({ currentTurn: FOLD_TRIGGER_DELTA }))).toBe('skip')
  })

  it('fires the first fold when currentTurn exceeds FOLD_TRIGGER_DELTA', () => {
    expect(evaluateSummarizationGate(inputs({
      currentTurn: FOLD_TRIGGER_DELTA + 1,
      lastFoldedTurn: 0,
    }))).toBe('fold')
  })

  it('skips between folds (only fires every FOLD_TURN_BATCH turns)', () => {
    // After folding through turn 5, the next 5 turns should not refold.
    for (let t = FOLD_TRIGGER_DELTA - 1; t <= FOLD_TRIGGER_DELTA + FOLD_TURN_BATCH - 1; t++) {
      expect(evaluateSummarizationGate(inputs({
        currentTurn: t,
        lastFoldedTurn: FOLD_TURN_BATCH,
      }))).toBe('skip')
    }
  })

  it('fires the next fold once the buffer has refilled', () => {
    expect(evaluateSummarizationGate(inputs({
      currentTurn: FOLD_TURN_BATCH + FOLD_TRIGGER_DELTA + 1,
      lastFoldedTurn: FOLD_TURN_BATCH,
    }))).toBe('fold')
  })

  it('hard-rebuilds at the T_HARD threshold', () => {
    expect(evaluateSummarizationGate(inputs({
      currentTurn: T_HARD_TURN_THRESHOLD,
      lastFoldedTurn: 45,
      lastFullRebuildTurn: 0,
    }))).toBe('hard')
  })

  it('prefers hard over fold when both would fire', () => {
    expect(evaluateSummarizationGate(inputs({
      currentTurn: T_HARD_TURN_THRESHOLD + 5,
      lastFoldedTurn: 30,
      lastFullRebuildTurn: 0,
    }))).toBe('hard')
  })

  describe('cadence over a 30-turn chat', () => {
    it('fires at turns 11, 16, 21, 26 with no T_hard', () => {
      let lastFoldedTurn = 0
      const lastFullRebuildTurn = 0
      const folds: number[] = []
      const hards: number[] = []

      for (let turn = 1; turn <= 30; turn++) {
        const decision = evaluateSummarizationGate({
          currentTurn: turn,
          lastFoldedTurn,
          lastFullRebuildTurn,
        })
        if (decision === 'fold') {
          folds.push(turn)
          lastFoldedTurn = lastFoldedTurn + FOLD_TURN_BATCH
        } else if (decision === 'hard') {
          hards.push(turn)
        }
      }

      expect(folds).toEqual([11, 16, 21, 26])
      expect(hards).toHaveLength(0)
    })

    it('over a 60-turn chat the T_hard fires near turn 50', () => {
      let lastFoldedTurn = 0
      let lastFullRebuildTurn = 0
      let foldFires = 0
      let hardFires = 0

      for (let turn = 1; turn <= 60; turn++) {
        const decision = evaluateSummarizationGate({
          currentTurn: turn,
          lastFoldedTurn,
          lastFullRebuildTurn,
        })
        if (decision === 'fold') {
          foldFires++
          lastFoldedTurn = lastFoldedTurn + FOLD_TURN_BATCH
        } else if (decision === 'hard') {
          hardFires++
          lastFoldedTurn = Math.max(0, turn - FOLD_TAIL_FLOOR)
          lastFullRebuildTurn = turn
        }
      }

      expect(hardFires).toBeGreaterThanOrEqual(1)
      // Without T_hard a 60-turn chat would fire ~10 folds; with one T_hard
      // intervening the count is still >= a couple.
      expect(foldFires).toBeGreaterThanOrEqual(2)
    })
  })
})
