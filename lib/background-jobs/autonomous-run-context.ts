/**
 * Autonomous-run AsyncLocalStorage context.
 *
 * The autonomous-room turn handler drives one character turn through the
 * ordinary `handleSendMessage` pipeline. Every LLM call made inside that
 * pipeline — the turn itself plus any agent-mode tool sub-calls — is logged to
 * `llm_logs`. To attribute that spend to the specific autonomous run (so the
 * per-run token budget can be summed by run id instead of by a fragile
 * timestamp window over the whole chat), the handler wraps the turn in
 * {@link runWithAutonomousRunId}, and the LLM-logging service stamps the
 * current id onto each row via {@link getAutonomousRunId} at insert time.
 * Outside an autonomous turn the store is empty and the id is `null`.
 *
 * Scope note: only work that runs synchronously within the wrapped call
 * inherits the context. Fire-and-forget auxiliary jobs (memory extraction,
 * scene-state tracking, danger classification, title/summary generation) run
 * in their own job scopes and are therefore intentionally NOT counted against
 * the room's per-turn token budget — the budget tracks conversational turn
 * spend, not housekeeping overhead.
 */

import { AsyncLocalStorage } from 'node:async_hooks';

const autonomousRunStore = new AsyncLocalStorage<string>();

/**
 * Run `fn` with `runId` established as the ambient autonomous-run id. Any
 * `llm_logs` row created while `fn` is on the stack will be tagged with it.
 */
export function runWithAutonomousRunId<T>(runId: string, fn: () => Promise<T>): Promise<T> {
  return autonomousRunStore.run(runId, fn);
}

/**
 * The current autonomous-run id, or `null` when not inside an autonomous turn.
 */
export function getAutonomousRunId(): string | null {
  return autonomousRunStore.getStore() ?? null;
}
