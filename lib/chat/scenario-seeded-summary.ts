/**
 * The one predicate for "this chat's summary is really its own scenario".
 *
 * Until bug 158, creating a chat wrote the chosen scenario into `contextSummary`
 * as well as `scenarioText` — a leftover from before `add-chat-scenario-text-field-v1`
 * (4.1.0) gave the scenario a column of its own. Every reader of `contextSummary`
 * therefore believed a brand-new chat had already been summarized, and the
 * greeting's "Recent Conversations" block handed the next character a stage
 * direction to open from.
 *
 * Chat creation no longer does this and `clear-scenario-seeded-chat-summaries-v1`
 * cleared the rows on disk, but neither reaches a chat that *arrives* — a `.qtap`
 * import or a backup restore carries whatever the source instance stored, and the
 * migration has already run by then. Every ingest path runs its rows through
 * `stripScenarioSeededSummary` so a pre-fix export cannot reopen the bug in a
 * fixed instance.
 *
 * Byte equality is the whole test, and it is safe for the same reason the
 * migration's is: a real summary is written only by the fold in
 * `lib/chat/context-summary.ts`, which replaces the column outright. Measured
 * against a live instance, **zero** of the 369 chats that had been folded at
 * least once matched this predicate, while 186 never-summarized chats did.
 *
 * The migration states the same rule in SQL (it lives in `migrations/`, which is
 * deliberately isolated from `lib/`). The two must agree — change both or
 * neither.
 */

/** A chat row as the ingest paths see it: both columns, both optional. */
export interface ScenarioSeededSummaryFields {
  contextSummary?: string | null;
  scenarioText?: string | null;
}

/**
 * True when `contextSummary` is byte-identical to the row's own non-empty
 * `scenarioText` — the shape chat creation used to produce.
 */
export function isScenarioSeededSummary(chat: ScenarioSeededSummaryFields): boolean {
  const scenario = chat.scenarioText;
  if (typeof scenario !== 'string' || scenario.length === 0) return false;
  return chat.contextSummary === scenario;
}

/**
 * Return the row with a scenario-seeded `contextSummary` nulled out, or the row
 * unchanged. Never touches `scenarioText`: the scenario is not the problem, its
 * second home was.
 */
export function stripScenarioSeededSummary<T extends ScenarioSeededSummaryFields>(chat: T): T {
  if (!isScenarioSeededSummary(chat)) return chat;
  return { ...chat, contextSummary: null };
}
