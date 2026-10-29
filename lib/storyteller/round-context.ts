/**
 * Storyteller round AsyncLocalStorage context.
 *
 * Every LLM call made for a storyteller round — each bid, and each speaking
 * turn the round runs — is stamped with the round's id in `llm_logs`
 * (`storytellerRoundId`), so the inspector can show a round as one group.
 * The round service wraps bids and speaking turns in
 * {@link runWithStorytellerRoundId}; the LLM-logging service reads
 * {@link getStorytellerRoundId} at insert time. Same pattern as
 * `lib/background-jobs/autonomous-run-context.ts`.
 */

import { AsyncLocalStorage } from 'node:async_hooks';

const storytellerRoundStore = new AsyncLocalStorage<string>();

/** Run `fn` with `roundId` as the ambient storyteller round. */
export function runWithStorytellerRoundId<T>(roundId: string, fn: () => Promise<T>): Promise<T> {
  return storytellerRoundStore.run(roundId, fn);
}

/** The current storyteller round id, or null outside a round. */
export function getStorytellerRoundId(): string | null {
  return storytellerRoundStore.getStore() ?? null;
}
