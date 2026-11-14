/**
 * Room for reasoning on top of the answer a call wants.
 *
 * Models that think by default (Anthropic's Haiku 5.5, Sonnet 5.x, Opus 5.x
 * and others) count their thinking against `max_tokens`. A cap sized for the
 * answer alone — 300 or 500 tokens for a short classification or cleanup —
 * can be spent on thinking before any answer is written, which comes back as
 * an empty reply with finish reason `max_tokens`. The cap is a ceiling, not a
 * charge, so the headroom costs nothing on a model that does not think.
 */

/** Tokens added to an answer budget for a model's own reasoning. */
export const REASONING_HEADROOM_TOKENS = 4000

/** The `maxTokens` to send for a call whose answer needs `answerTokens`. */
export function withReasoningHeadroom(answerTokens: number): number {
  return answerTokens + REASONING_HEADROOM_TOKENS
}
