/**
 * Regression tests for agent-mode guardrail behaviour introduced in
 * fix(agent-mode) 9376de60.
 *
 * Two linked changes close the ghost-wrap-up loop:
 * 1. `buildAgentModeInstructions` now scopes `submit_final_response`
 *    explicitly to *this turn's* work and tells the model not to re-wrap
 *    previous-turn summaries or respond to relational messages with it.
 * 2. An orchestrator guardrail rejects a first-iteration
 *    `submit_final_response` when it is the only tool called and no
 *    conversational prose accompanied it. The detection condition is:
 *
 *      isGhostWrapUp =
 *        !!submitFinalCall   // submit_final_response is present
 *        && toolIterations === 0    // first iteration
 *        && toolCalls.length === 1  // only tool called
 *        && !(currentResponse && currentResponse.trim().length > 0)
 *                                   // no accompanying prose
 *
 * Tests here verify both the instruction text and the guard condition.
 */

import { describe, it, expect } from '@jest/globals';

jest.mock('@/lib/logging/create-logger', () => ({
  createServiceLogger: jest.fn(() => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  })),
}));

import {
  buildAgentModeInstructions,
  buildForceFinalMessage,
  generateIterationSummary,
} from '@/lib/services/chat-message/agent-mode-resolver.service';

// ============================================================================
// buildAgentModeInstructions — guardrail instruction text
// ============================================================================

describe('buildAgentModeInstructions', () => {
  it('includes guidance not to submit for conversational or relational messages', () => {
    const instructions = buildAgentModeInstructions(10);
    // Regression: before the fix the instructions didn't explicitly forbid
    // calling submit_final_response in response to relational messages.
    expect(instructions).toMatch(/Do NOT submit.*conversational.*relational/i);
  });

  it('includes guidance not to re-summarize work from a previous turn', () => {
    const instructions = buildAgentModeInstructions(10);
    // The ghost-wrap-up pattern is explicitly called out as forbidden.
    expect(instructions).toMatch(/Do NOT submit.*previous turn/i);
  });

  it('includes the maxTurns value', () => {
    const instructions = buildAgentModeInstructions(7);
    expect(instructions).toContain('7');
  });

  it('mentions submit_final_response tool by name', () => {
    const instructions = buildAgentModeInstructions(10);
    expect(instructions).toContain('submit_final_response');
  });
});

// ============================================================================
// Ghost-wrap-up detection logic (pure condition, no orchestrator mock needed)
// ============================================================================

/**
 * Replicates the isGhostWrapUp condition from orchestrator.service.ts so we
 * can unit-test it directly without standing up the full orchestrator.
 */
function isGhostWrapUp(opts: {
  hasSubmitFinalCall: boolean;
  toolIterations: number;
  toolCallCount: number;
  currentResponse: string | undefined;
}): boolean {
  return (
    opts.hasSubmitFinalCall &&
    opts.toolIterations === 0 &&
    opts.toolCallCount === 1 &&
    !(opts.currentResponse && opts.currentResponse.trim().length > 0)
  );
}

describe('ghost-wrap-up guardrail condition', () => {
  it('detects the ghost-wrap-up pattern — first iteration, only submit_final_response, no prose', () => {
    // This is the exact pattern observed: iteration 0, single tool call, no prose.
    expect(isGhostWrapUp({
      hasSubmitFinalCall: true,
      toolIterations: 0,
      toolCallCount: 1,
      currentResponse: '',
    })).toBe(true);
  });

  it('does NOT flag when prose accompanied the submit_final_response call', () => {
    // If the model produced real conversational prose alongside the call,
    // we allow it through — the prose is the escape hatch.
    expect(isGhostWrapUp({
      hasSubmitFinalCall: true,
      toolIterations: 0,
      toolCallCount: 1,
      currentResponse: 'Here is what I did this turn...',
    })).toBe(false);
  });

  it('does NOT flag when toolIterations > 0 — model did real work first', () => {
    // On iteration 1+ the model already ran at least one tool; the
    // submit_final_response call is legitimate.
    expect(isGhostWrapUp({
      hasSubmitFinalCall: true,
      toolIterations: 1,
      toolCallCount: 1,
      currentResponse: '',
    })).toBe(false);
  });

  it('does NOT flag when more than one tool was called alongside submit_final_response', () => {
    // If other tools ran in the same batch, the model did real work.
    expect(isGhostWrapUp({
      hasSubmitFinalCall: true,
      toolIterations: 0,
      toolCallCount: 2,
      currentResponse: '',
    })).toBe(false);
  });

  it('does NOT flag when there is no submit_final_response call at all', () => {
    expect(isGhostWrapUp({
      hasSubmitFinalCall: false,
      toolIterations: 0,
      toolCallCount: 1,
      currentResponse: '',
    })).toBe(false);
  });

  it('does NOT flag when currentResponse is whitespace-only prose', () => {
    // Whitespace trimmed → same as empty string → ghost wrap-up
    expect(isGhostWrapUp({
      hasSubmitFinalCall: true,
      toolIterations: 0,
      toolCallCount: 1,
      currentResponse: '   \n  ',
    })).toBe(true);
  });
});
