/**
 * The research kit's four soft guards (docs/developer/features/research-kit.md §8):
 * each one's trigger, its wording by variant, and its fire-once rule.
 *
 * @jest-environment node
 */

import {
  CHECKPOINT_AFTER_MODEL_CALL,
  ResearchLoopGuard,
  declaresSufficiency,
  isEmptyToolResult,
  nearIdenticalTargets,
  researchGuardFor,
} from '@/lib/services/console-engine/loop-guard'

function guard(variant: 'inquiry' | 'drafting' = 'inquiry', maxAgentTurns = 20) {
  return new ResearchLoopGuard({ variant, maxAgentTurns, surface: 'test' })
}

/** Run n model calls with nothing else happening, returning every nudge seen. */
function callModel(g: ResearchLoopGuard, n: number): Array<string | null> {
  const nudges: Array<string | null> = []
  for (let i = 0; i < n; i++) {
    nudges.push(g.takeNudge())
    g.afterModelCall()
  }
  return nudges
}

const miss = (text: string) => ({
  toolName: 'find_documents',
  success: true,
  content: 'No file matches.',
  arguments: { text },
})

describe('researchGuardFor', () => {
  it('runs the guards only for the research kinds', () => {
    expect(researchGuardFor('inquiry', { maxAgentTurns: 10, surface: 's' })).toBeInstanceOf(ResearchLoopGuard)
    expect(researchGuardFor('drafting', { maxAgentTurns: 10, surface: 's' })).toBeInstanceOf(ResearchLoopGuard)
    expect(researchGuardFor('writing', { maxAgentTurns: 10, surface: 's' })).toBeInstanceOf(ResearchLoopGuard)
    expect(researchGuardFor('research', { maxAgentTurns: 10, surface: 's' })).toBeNull()
  })
})

describe('the checkpoint', () => {
  it('fires after the sixth model call and again at 60% of the budget, once each', () => {
    const g = guard('inquiry', 20)
    const nudges = callModel(g, 20)
    const fired = nudges.map((n, i) => (n ? i : -1)).filter((i) => i >= 0)
    expect(fired).toEqual([CHECKPOINT_AFTER_MODEL_CALL, 12])
    expect(nudges[CHECKPOINT_AFTER_MODEL_CALL]).toMatch(/^Checkpoint: you have made 0 tool calls\. If you can answer, answer now\./)
    expect(g.history).toEqual(['checkpoint', 'checkpoint'])
  })

  it('fires once when 60% of the budget falls before the sixth call', () => {
    const g = guard('drafting', 8)
    const nudges = callModel(g, 8)
    expect(nudges.filter(Boolean)).toHaveLength(1)
    expect(nudges[CHECKPOINT_AFTER_MODEL_CALL]).toContain('If you can write the piece, deliver it now.')
  })

  it('counts the tool calls made so far', () => {
    const g = guard()
    for (let i = 0; i < CHECKPOINT_AFTER_MODEL_CALL; i++) {
      g.takeNudge()
      g.afterModelCall()
      g.afterToolStep({ thinking: '', callCount: 2, results: [] })
    }
    expect(g.takeNudge()).toContain('you have made 12 tool calls')
  })
})

describe('declared sufficiency', () => {
  it('recognises the phrases, curly quotes included', () => {
    expect(declaresSufficiency('OK, I’ve got enough to answer.')).toBe(true)
    expect(declaresSufficiency('I have plenty here')).toBe(true)
    expect(declaresSufficiency('I need more.')).toBe(false)
  })

  it('fires on the second tool step that declares it, and only once', () => {
    const g = guard('drafting')
    g.afterToolStep({ thinking: 'I have enough.', callCount: 1, results: [] })
    expect(g.takeNudge()).toBeNull()
    g.afterToolStep({ thinking: 'I have enough, but one more look.', callCount: 1, results: [] })
    expect(g.takeNudge()).toBe('You have said twice that you have enough. Do not call any more tools. Deliver the piece now.')
    g.afterToolStep({ thinking: 'I have enough.', callCount: 1, results: [] })
    expect(g.takeNudge()).toBeNull()
  })

  it('does not count a declaration in a step that called no tools', () => {
    const g = guard()
    g.afterToolStep({ thinking: 'I have enough.', callCount: 0, results: [] })
    g.afterToolStep({ thinking: 'I have enough.', callCount: 1, results: [] })
    expect(g.takeNudge()).toBeNull()
  })
})

describe('the repeated miss', () => {
  it('reads empty results, not-found errors and empty JSON lists as misses', () => {
    expect(isEmptyToolResult({ success: true, content: 'No files found in the stores.' })).toBe(true)
    expect(isEmptyToolResult({ success: false, content: 'No character matches "Nobody".' })).toBe(true)
    expect(isEmptyToolResult({ success: true, content: '{"hits":[]}' })).toBe(true)
    expect(isEmptyToolResult({ success: true, content: '{"total":0}' })).toBe(true)
    expect(isEmptyToolResult({ success: false, content: 'SQL error: no such column' })).toBe(true)
    expect(isEmptyToolResult({ success: false, content: 'SQL error: syntax error' })).toBe(false)
    expect(isEmptyToolResult({ success: true, content: 'Atlas/Harbour.md — 3 matches' })).toBe(false)
  })

  it('treats a word added, dropped or misspelt as the same target', () => {
    expect(nearIdenticalTargets(['harbour'], ['harbor'])).toBe(true)
    expect(nearIdenticalTargets(['old', 'harbour'], ['harbour', 'old', 'the'])).toBe(true)
    expect(nearIdenticalTargets(['harbour'], ['lighthouse'])).toBe(false)
  })

  it('fires when the same tool misses on a near-identical target, once', () => {
    const g = guard()
    g.afterToolStep({ thinking: '', callCount: 1, results: [miss('Old Harbour')] })
    expect(g.takeNudge()).toBeNull()
    g.afterToolStep({ thinking: '', callCount: 1, results: [miss('old harbor')] })
    expect(g.takeNudge()).toMatch(/searched for twice and is not there/)
    g.afterToolStep({ thinking: '', callCount: 1, results: [miss('Old Harbour')] })
    expect(g.takeNudge()).toBeNull()
    expect(g.history).toEqual(['repeated-miss'])
  })

  it('does not fire for different targets or different tools', () => {
    const g = guard()
    g.afterToolStep({ thinking: '', callCount: 1, results: [miss('harbour')] })
    g.afterToolStep({ thinking: '', callCount: 1, results: [miss('lighthouse')] })
    g.afterToolStep({ thinking: '', callCount: 1, results: [{ ...miss('harbour'), toolName: 'list_documents' }] })
    expect(g.takeNudge()).toBeNull()
  })
})

describe('the repeated error', () => {
  const failure = (id: string) => ({
    toolName: 'run_sql',
    success: false,
    content: `SQL error: syntax error near "FROM" in row 1b4e28ba-2fa1-11d2-883f-0016d3cca42${id}`,
  })

  it('fires on the same error twice from the same tool, naming an alternative, once', () => {
    const g = guard('inquiry')
    g.afterToolStep({ thinking: '', callCount: 1, results: [failure('7')] })
    expect(g.takeNudge()).toBeNull()
    // Ids are normalised away: the same failure on another row is the same error.
    g.afterToolStep({ thinking: '', callCount: 1, results: [failure('8')] })
    const nudge = g.takeNudge()
    expect(nudge).toContain('`run_sql` has failed twice with the same error')
    expect(nudge).toContain('lookup_character')
    expect(nudge).toContain('answer from what you have')
    g.afterToolStep({ thinking: '', callCount: 1, results: [failure('9'), failure('9')] })
    expect(g.takeNudge()).toBeNull()
  })

  it('does not fire for two different errors', () => {
    const g = guard()
    g.afterToolStep({ thinking: '', callCount: 1, results: [{ toolName: 'run_sql', success: false, content: 'SQL error: a' }] })
    g.afterToolStep({ thinking: '', callCount: 1, results: [{ toolName: 'run_sql', success: false, content: 'SQL error: b' }] })
    expect(g.takeNudge()).toBeNull()
  })
})

describe('several guards at once', () => {
  it('joins every pending nudge into one message and clears the queue', () => {
    const g = guard()
    g.afterToolStep({ thinking: 'I have enough.', callCount: 1, results: [miss('harbour')] })
    g.afterToolStep({ thinking: 'I have enough.', callCount: 1, results: [miss('harbour')] })
    const nudge = g.takeNudge()
    expect(nudge?.split('\n\n')).toHaveLength(2)
    expect(g.takeNudge()).toBeNull()
  })
})
